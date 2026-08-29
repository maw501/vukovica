/**
 * Typed helpers over supabase-js. This is the whole data layer: every call here
 * is a direct PostgREST request made as the signed-in user, protected by RLS.
 *
 * Later tasks extend this file (queue, reviews, deck CRUD, drills, chat).
 */

import { parseGeneratedCard, trimCardInput, type CardInput } from '@/lib/cardInput';
import { callEdgeFunction } from '@/lib/edge';
import { gradeCard, newUserCard, type ReviewGrade } from '@/lib/fsrs';
import { buildQueue } from '@/lib/queue';
import {
  collectLocalDays,
  computeStreak,
  startOfLocalDay,
  streakFromLocalDays,
} from '@/lib/streak';
import { supabase } from '@/lib/supabase';
import type { CardRow, SettingsRow, UserCardRow } from '@/lib/types';

// `settings.new_per_day` is nullable in the row type (a `select` can return
// null for it), so every consumer needs a default. One definition, here.
export const DEFAULT_NEW_PER_DAY = 10;

export { computeStreak };

/** Postgres unique-violation. Thrown when two tabs race to create the settings row. */
const UNIQUE_VIOLATION = '23505';

/**
 * The signed-in user's id, read from the locally cached session (no network
 * round-trip). It is only used to scope queries and to fill `user_id` on
 * insert -- RLS, not this value, is what actually protects the data.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const userId = data.session?.user.id;
  if (!userId) throw new Error('Not signed in.');
  return userId;
}

/** The user's settings row, creating it with the schema defaults if absent. */
async function getSettings(): Promise<SettingsRow> {
  const userId = await requireUserId();

  const existing = await supabase
    .from('settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle<SettingsRow>();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  // Insert bare: every other column has a database default (show_latin true,
  // new_per_day 10, tts_enabled true), so the defaults live in exactly one place.
  const created = await supabase
    .from('settings')
    .insert({ user_id: userId })
    .select()
    .single<SettingsRow>();
  if (!created.error) return created.data;

  // Lost a race with another tab -- the row exists now, so read it back.
  if (created.error.code === UNIQUE_VIOLATION) {
    const reread = await supabase
      .from('settings')
      .select('*')
      .eq('user_id', userId)
      .single<SettingsRow>();
    if (reread.error) throw reread.error;
    return reread.data;
  }
  throw created.error;
}

/** Persist a partial settings change and return the updated row. */
async function updateSettings(
  patch: Partial<Omit<SettingsRow, 'user_id'>>,
): Promise<SettingsRow> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('settings')
    .update(patch)
    .eq('user_id', userId)
    .select()
    .single<SettingsRow>();
  if (error) throw error;
  return data;
}

export interface DashboardStats {
  /** Already-studied `user_cards` rows whose `due` has passed (excludes `new`). */
  dueCount: number;
  /** Cards the user has never studied -- no `user_cards` row yet. */
  newAvailable: number;
  /** New cards already introduced today (local day), for the daily allowance. */
  newDoneToday: number;
  /** Consecutive local days with at least one review, ending today or yesterday. */
  streakDays: number;
}

/**
 * PostgREST caps a response at `max_rows` (1000 in `supabase/config.toml`), so
 * the streak walks back a page at a time. It stops as soon as the fetched
 * window is known to contain the gap that ends the streak -- which, for a daily
 * learner, is the very first page.
 */
const STREAK_PAGE_SIZE = 1000;
const STREAK_MAX_PAGES = 10;

async function fetchStreakDays(userId: string, now: Date): Promise<number> {
  const days = new Set<string>();
  let streak = 0;

  for (let page = 0; page < STREAK_MAX_PAGES; page += 1) {
    const from = page * STREAK_PAGE_SIZE;
    const { data, error } = await supabase
      .from('review_logs')
      .select('reviewed_at')
      // Redundant under RLS, but it is what lets the planner use
      // `review_logs_user_reviewed_idx`.
      .eq('user_id', userId)
      .order('reviewed_at', { ascending: false })
      .range(from, from + STREAK_PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    collectLocalDays(
      data.map((row) => row.reviewed_at),
      days,
    );
    streak = streakFromLocalDays(days, now);

    // Fewer rows than asked for means we have the full history.
    if (data.length < STREAK_PAGE_SIZE) break;
    // If some fetched day is *not* part of the streak, the gap that ends the
    // streak is already inside this window and older rows cannot extend it.
    if (days.size > streak) break;
  }

  return streak;
}

/**
 * New cards introduced today, on the *local* calendar day.
 *
 * A card leaves the `new` state exactly once and that transition is logged, so
 * counting `review_logs` with `state_before = 'new'` is a faithful proxy — and
 * it works without a `user_cards` row existing before the first grade.
 *
 * This is the single definition of the daily allowance's denominator: the
 * dashboard's "new today" figure and `getQueue`'s new-card budget both call it,
 * so the two can never drift apart.
 */
async function countNewDoneToday(userId: string, now: Date): Promise<number> {
  const { count, error } = await supabase
    .from('review_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('state_before', 'new')
    .gte('reviewed_at', startOfLocalDay(now).toISOString());
  if (error) throw error;
  return count ?? 0;
}

/** Everything the home dashboard shows, in one call. */
async function getDashboard(now: Date = new Date()): Promise<DashboardStats> {
  const userId = await requireUserId();
  const nowIso = now.toISOString();

  // The streak paginates, so it runs alongside the head counts rather than
  // after them. One `Promise.all` over all of it, so nothing can reject unobserved.
  const [[due, totalCards, studiedCards], newDoneToday, streakDays] = await Promise.all([
    Promise.all([
      // `state = 'new'` is excluded deliberately: a freshly introduced card gets
      // a `user_cards` row defaulting to due = now(), so counting it here would
      // show it as Due *and* against the new allowance. New cards belong to the
      // allowance only.
      supabase
        .from('user_cards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .neq('state', 'new')
        .lte('due', nowIso),
      supabase.from('cards').select('*', { count: 'exact', head: true }),
      // Every `user_cards` row references a card (FK), one row per card, so
      // "cards with no user_cards row" is just the difference of two counts.
      supabase
        .from('user_cards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]),
    countNewDoneToday(userId, now),
    fetchStreakDays(userId, now),
  ]);

  for (const result of [due, totalCards, studiedCards]) {
    if (result.error) throw result.error;
  }

  return {
    dueCount: due.count ?? 0,
    newAvailable: Math.max(0, (totalCards.count ?? 0) - (studiedCards.count ?? 0)),
    newDoneToday,
    streakDays,
  };
}

// ---------------------------------------------------------------------------
// Review session
// ---------------------------------------------------------------------------

/** One card in a study session, with whatever scheduling state it already has. */
export interface QueueEntry {
  cardId: string;
  /** True when the card has never been graded — there is no `user_cards` row. */
  isNew: boolean;
  card: CardRow;
  /** null exactly when `isNew`; the row is created by the first grade. */
  userCard: UserCardRow | null;
}

/**
 * PostgREST caps a response at `max_rows` (1000). Both the studied-ids read and
 * the new-card candidate read stay well inside that for a ~700-card deck; if the
 * deck ever outgrows it, they need paginating (the counts would silently
 * under-report otherwise).
 */
const MAX_ROWS = 1000;

/** A due `user_cards` row with its card embedded. */
interface DueJoinRow extends UserCardRow {
  /**
   * `user_cards.card_id` is a plain FK, so PostgREST embeds a single object.
   * Typed defensively anyway — a schema change that made the relationship
   * ambiguous would otherwise fail silently at runtime.
   */
  cards: CardRow | CardRow[] | null;
}

function embeddedCard(row: DueJoinRow): CardRow | null {
  if (!row.cards) return null;
  return Array.isArray(row.cards) ? (row.cards[0] ?? null) : row.cards;
}

/**
 * Cards the user has never studied, in deck order, capped at `allowance`.
 *
 * "Never studied" is "has no `user_cards` row", which PostgREST cannot express
 * as a join predicate. Instead: read the ids the user *has* studied, then take
 * the first `studied + allowance` cards in deck order — of which at most
 * `studied` can be filtered out, so the allowance is always filled while the
 * deck still has unseen cards.
 */
async function fetchNewCards(userId: string, allowance: number): Promise<CardRow[]> {
  if (allowance <= 0) return [];

  const studied = await supabase.from('user_cards').select('card_id').eq('user_id', userId);
  if (studied.error) throw studied.error;
  const seen = new Set((studied.data ?? []).map((row) => row.card_id as string));

  const candidates = await supabase
    .from('cards')
    .select('*')
    // Words the user added come first (`created_by` is null for seed rows):
    // someone who has just typed in a word wants it in today's session, not in
    // two months' time once the seed deck has been worked through.
    .order('created_by', { ascending: false, nullsFirst: false })
    // Then seed order -- the deck file is grouped by domain, easiest first, and
    // each seeding batch shares a `created_at`. `id` only breaks ties inside a
    // batch, so the order within one is arbitrary but stable.
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(Math.min(seen.size + allowance, MAX_ROWS))
    .returns<CardRow[]>();
  if (candidates.error) throw candidates.error;

  return (candidates.data ?? []).filter((card) => !seen.has(card.id)).slice(0, allowance);
}

/**
 * The cards to study right now: everything due, oldest first, then new cards up
 * to what is left of today's budget.
 *
 * New cards deliberately arrive with `userCard: null` — no row is written until
 * the card is actually graded, so an introduced-but-unanswered card stays out of
 * both the due count and the daily allowance.
 */
async function getQueue(now: Date = new Date()): Promise<QueueEntry[]> {
  const userId = await requireUserId();

  const [settings, newDoneToday, dueResult] = await Promise.all([
    getSettings(),
    countNewDoneToday(userId, now),
    supabase
      .from('user_cards')
      .select('*, cards(*)')
      .eq('user_id', userId)
      // Matches the dashboard's `dueCount`. Under lazy insertion a `new` row
      // cannot exist, but if one ever did, counting it here and not there would
      // make "Due 0" open a session with cards in it.
      .neq('state', 'new')
      .lte('due', now.toISOString())
      .order('due', { ascending: true })
      .limit(MAX_ROWS)
      .returns<DueJoinRow[]>(),
  ]);
  if (dueResult.error) throw dueResult.error;

  const newPerDay = settings.new_per_day ?? DEFAULT_NEW_PER_DAY;

  // Index the due rows by card id before handing the bare rows to `buildQueue`,
  // which orders ids and knows nothing about card content.
  const dueCards: UserCardRow[] = [];
  const byId = new Map<string, QueueEntry>();
  for (const row of dueResult.data ?? []) {
    const card = embeddedCard(row);
    if (!card) continue; // Should be unreachable: the FK guarantees a card.
    const { cards: _embedded, ...userCard } = row;
    dueCards.push(userCard);
    byId.set(card.id, { cardId: card.id, isNew: false, card, userCard });
  }

  const newCards = await fetchNewCards(userId, Math.max(0, newPerDay - newDoneToday));
  for (const card of newCards) {
    byId.set(card.id, { cardId: card.id, isNew: true, card, userCard: null });
  }

  return buildQueue({ dueCards, newCards, newPerDay, newDoneToday })
    .map((item) => byId.get(item.cardId))
    .filter((entry): entry is QueueEntry => entry !== undefined);
}

export interface SubmitReviewArgs {
  cardId: string;
  grade: ReviewGrade;
  /**
   * The card's current row, or null for a card that has never been graded. The
   * caller must pass the row it last saw — grading twice from the same starting
   * row would log `state_before = 'new'` twice and burn two of the day's new-card
   * budget for one card.
   */
  userCard: UserCardRow | null;
  now?: Date;
}

const VALID_GRADES: readonly number[] = [1, 2, 3, 4];

/**
 * Persist one answer: reschedule the card with FSRS, write (or create) its
 * `user_cards` row, and append the `review_logs` entry that powers the streak
 * and the daily new-card count.
 *
 * The upsert is what "lazily insert on first grade" means — a new card gets its
 * row here and nowhere else, so it is never `state = 'new'` in the database.
 */
async function submitReview({
  cardId,
  grade,
  userCard,
  now = new Date(),
}: SubmitReviewArgs): Promise<UserCardRow> {
  if (!VALID_GRADES.includes(grade)) {
    throw new Error(`Invalid grade: ${String(grade)}. Expected 1, 2, 3 or 4.`);
  }
  const userId = await requireUserId();
  const current = userCard ?? newUserCard(userId, cardId, now);
  const { next, log } = gradeCard(current, grade, now);

  // Scheduling first, log second. If the log write fails the card is still
  // scheduled correctly; the reverse would count a new card against the day's
  // budget without actually scheduling it, and the card would come back as new.
  const saved = await supabase
    .from('user_cards')
    .upsert(next, { onConflict: 'user_id,card_id' })
    .select()
    .single<UserCardRow>();
  if (saved.error) throw saved.error;

  const logged = await supabase.from('review_logs').insert(log);
  if (logged.error) throw logged.error;

  return saved.data;
}

// ---------------------------------------------------------------------------
// Deck management
// ---------------------------------------------------------------------------

/**
 * The whole deck, alphabetically.
 *
 * Deviation from the brief, which specified `listCards(search)`: searching is
 * done in memory by `filterCards` instead, because a card's Latin form is
 * derived by `cyrToLat` rather than stored, so "mama" could never match "мама"
 * in SQL. One fetch of a few hundred rows beats a round trip per keystroke.
 */
async function listCards(): Promise<CardRow[]> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .order('sr_cyr', { ascending: true })
    .limit(MAX_ROWS)
    .returns<CardRow[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Add a card to the shared deck.
 *
 * No `user_cards` row is created: a card with no row *is* a new card, so this
 * one enters the next session's new-card allowance on its own. Creating a row
 * here would make it due-but-`new` and count against nothing.
 */
async function addCard(input: CardInput): Promise<CardRow> {
  const userId = await requireUserId();
  const card = trimCardInput(input);
  const { data, error } = await supabase
    .from('cards')
    // `created_by` is not decoration: the `cards_insert_own` policy checks it.
    .insert({ ...card, created_by: userId })
    .select()
    .single<CardRow>();
  if (error) throw duplicateHeadword(error, card.sr_cyr);
  return data;
}

/** Edit an existing card. Scheduling state is untouched. */
async function updateCard(id: string, input: CardInput): Promise<CardRow> {
  const card = trimCardInput(input);
  const { data, error } = await supabase
    .from('cards')
    .update(card)
    .eq('id', id)
    .select()
    .single<CardRow>();
  if (error) throw duplicateHeadword(error, card.sr_cyr);
  return data;
}

/**
 * `cards.sr_cyr` is unique, so adding a word the deck already has comes back as
 * a bare "duplicate key value violates unique constraint" — true, but no use to
 * someone who just wants to know why their card would not save.
 */
function duplicateHeadword(error: { code?: string }, srCyr: string): unknown {
  if (error.code !== UNIQUE_VIOLATION) return error;
  return new Error(`“${srCyr}” is already in the deck. Search for it and edit that card instead.`);
}

/**
 * Remove a card from the deck. The `on delete cascade` on `user_cards` and
 * `review_logs` takes its scheduling state and its history with it, so this
 * needs confirming in the UI.
 */
async function deleteCard(id: string): Promise<void> {
  const { error } = await supabase.from('cards').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Ask the `generate` Edge Function to draft a card for `input` (either script).
 * The result is shown in an editable preview, never saved straight through.
 */
async function generateCard(input: string): Promise<CardInput> {
  const body = await callEdgeFunction<unknown>('generate', { mode: 'new_card', input });
  return parseGeneratedCard(body);
}

export const api = {
  getSettings,
  updateSettings,
  getDashboard,
  getQueue,
  submitReview,
  listCards,
  addCard,
  updateCard,
  deleteCard,
  generateCard,
};
