/**
 * Typed helpers over supabase-js. This is the whole data layer: every call here
 * is a direct PostgREST request made as the signed-in user, protected by RLS.
 *
 * Later tasks extend this file (queue, reviews, deck CRUD, drills, chat).
 */

import { parseGeneratedCard, trimCardInput, type CardInput } from '@/lib/cardInput';
import { formatLearnerState, LEARNER_STATE_WORDS, type LapsedCard } from '@/lib/chat';
import {
  BUMP_DRILL_STATS_FN,
  bumpDrillStatsParams,
  type LetterDelta,
} from '@/lib/drills';
import { callEdgeFunction } from '@/lib/edge';
import { gradeCard, newUserCard, type ReviewGrade } from '@/lib/fsrs';
import { buildQueue } from '@/lib/queue';
import { parseGloss, type Gloss, type StoryLevel } from '@/lib/reader';
import { SUBMIT_REVIEW_FN, submitReviewParams } from '@/lib/reviewRpc';
import { computeProgress, type Progress } from '@/lib/stages';
import {
  collectLocalDays,
  computeStreak,
  startOfLocalDay,
  streakFromLocalDays,
} from '@/lib/streak';
import { supabase } from '@/lib/supabase';
import type {
  CardRow,
  ChatMessageRow,
  ChatRole,
  DrillStatRow,
  SettingsRow,
  StoryRow,
  UserCardRow,
} from '@/lib/types';

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
 * Both writes go through the `submit_review` Postgres function, in one
 * transaction. Done as two PostgREST calls they could half-succeed, and the
 * half that goes missing is load-bearing: `newDoneToday` counts logs with
 * `state_before = 'new'`, so an advanced card with no log under-spends the daily
 * allowance *and* stops being new, which nothing later can put right.
 *
 * The upsert inside that function is what "lazily insert on first grade" means —
 * a new card gets its row there and nowhere else, so it is never `state = 'new'`
 * in the database.
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

  const { data, error } = await supabase
    // The function returns `public.user_cards`, i.e. one row rather than a set,
    // so PostgREST answers with a bare object -- `.single()` is what tells
    // supabase-js to type it as one.
    .rpc(SUBMIT_REVIEW_FN, submitReviewParams(next, log))
    .single<UserCardRow>();
  if (error) throw error;

  // The caller feeds this straight back in as the starting row for the card's
  // next grade, so a response that is not a row would corrupt the following
  // answer rather than fail loudly. Check it once, here.
  if (!data || typeof data.card_id !== 'string') {
    throw new Error('The server did not return the saved card. The answer may not be recorded.');
  }
  return data;
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

// ---------------------------------------------------------------------------
// Cyrillic trainer
// ---------------------------------------------------------------------------

/**
 * The user's per-letter drill accuracy — thirty rows at the very most, so no
 * paging worries. `pickDrillWords` turns it into the bias for the next round.
 */
async function listDrillStats(): Promise<DrillStatRow[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('drill_stats')
    .select('*')
    // Redundant under RLS, but it is what makes this a primary-key lookup.
    .eq('user_id', userId)
    .returns<DrillStatRow[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Add one drilled word's (or round's) marks to the per-letter counters.
 *
 * Through `bump_drill_stats` rather than an upsert, because PostgREST's upsert
 * *replaces* the counts and this has to add to them. One request per answered
 * word — never one per keystroke — and the returned rows are the new totals.
 */
async function recordDrillAttempts(deltas: readonly LetterDelta[]): Promise<DrillStatRow[]> {
  if (deltas.length === 0) return [];
  const { data, error } = await supabase.rpc(BUMP_DRILL_STATS_FN, bumpDrillStatsParams(deltas));
  if (error) throw error;
  // The project has no generated `Database` types, so an RPC's result type is
  // whatever the caller says it is. The function returns `setof drill_stats`.
  return (data ?? []) as DrillStatRow[];
}

/**
 * Ask the `generate` Edge Function to draft a card for `input` (either script).
 * The result is shown in an editable preview, never saved straight through.
 */
async function generateCard(input: string): Promise<CardInput> {
  const body = await callEdgeFunction<unknown>('generate', { mode: 'new_card', input });
  return parseGeneratedCard(body);
}

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

/**
 * Postgres's "relation does not exist" and PostgREST's schema-cache equivalent
 * (raised before the statement is ever sent, when the table is absent from the
 * cached schema).
 */
const MISSING_RELATION = new Set(['42P01', 'PGRST205']);

/**
 * Relation-shaped failure messages, as a backstop for a PostgREST version that
 * reports a missing table under some other code.
 *
 * Deliberately narrow. A looser "mentions stories and does not exist" test also
 * matches *column* errors — 42703 "column stories.finished_at does not exist"
 * and PGRST204 "Could not find the 'finished_at' column of 'stories' in the
 * schema cache" — and swallowing those would hide a column-name mismatch when
 * the reader migration lands, silently reporting 0 stories forever.
 */
const MISSING_RELATION_MESSAGE = /relation .*stories.* does not exist|could not find the table/i;

/**
 * True when the failure is "there is no `stories` table", rather than a real
 * error worth surfacing.
 */
export function isMissingStoriesTable(error: { code?: string; message?: string }): boolean {
  if (error.code && MISSING_RELATION.has(error.code)) return true;
  return MISSING_RELATION_MESSAGE.test(error.message ?? '');
}

/**
 * Stories the user has finished — the Читање ladder's numerator.
 *
 * Defensive on purpose: the `stories` table is created by the graded-reader
 * task later in this phase, so until that migration lands this query fails with
 * a missing relation. Progress is still meaningful without it (no stories read
 * is exactly what zero means), so that one failure reads as 0 and every other
 * error still throws. Nothing here needs removing once the table exists.
 */
async function countStoriesFinished(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true })
    // Redundant under RLS, but it keeps this a user-scoped index lookup.
    .eq('user_id', userId)
    .not('finished_at', 'is', null);
  if (!error) return count ?? 0;
  if (isMissingStoriesTable(error)) return 0;
  throw error;
}

/**
 * Where the learner is on the staged path, in one batch of reads.
 *
 * The three inputs are independent, so they go out together; `computeProgress`
 * turns them into the stage and goal without any further I/O. `listDrillStats`
 * reaches for the session again, which is a local read, not a round trip.
 */
async function getProgress(): Promise<Progress> {
  const userId = await requireUserId();

  const [drillStats, known, storiesRead] = await Promise.all([
    listDrillStats(),
    // "Known" is a word that has graduated out of learning: `state = 'review'`.
    // 'relearning' is deliberately excluded — a lapsed word is one he no longer
    // knows, and counting it would make the milestone ladder go backwards
    // silently rather than honestly.
    supabase
      .from('user_cards')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('state', 'review'),
    countStoriesFinished(userId),
  ]);
  if (known.error) throw known.error;

  return computeProgress({ drillStats, knownWords: known.count ?? 0, storiesRead });
}

// ---------------------------------------------------------------------------
// Graded reader
// ---------------------------------------------------------------------------

/**
 * The library, newest first. Unread and finished stories come back together —
 * the reader screen splits them, so re-reading a finished story costs no extra
 * round trip and the two sections can never disagree about a row.
 */
async function listStories(): Promise<StoryRow[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    // Redundant under RLS, but it is what lets the planner use
    // `stories_user_created_idx`.
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)
    .returns<StoryRow[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Ask the `story` Edge Function for a new story.
 *
 * The function inserts the row itself with the service role (the client has no
 * business writing a story it did not generate), so this is one round trip and
 * the response *is* the saved row — minus `user_id`, which is always the caller.
 */
async function createStory(level: StoryLevel, topic?: string): Promise<Omit<StoryRow, 'user_id'>> {
  const trimmed = topic?.trim();
  // Sent only when there is one: the function treats a blank topic as no topic,
  // and this keeps the wire body honest about what was asked for.
  const body = trimmed ? { level, topic: trimmed } : { level };
  const story = await callEdgeFunction<Omit<StoryRow, 'user_id'>>('story', body);

  // The caller navigates straight to `story.id`, so a response that is not a
  // row would strand the reader on an empty screen rather than fail loudly.
  if (!story || typeof story.id !== 'string' || typeof story.body_cyr !== 'string') {
    throw new Error('The story was generated but came back unreadable. Pull to refresh.');
  }
  return story;
}

/**
 * Mark a story read. The Читање ladder counts exactly this column.
 *
 * Unconditional by design: the reading view only offers the button on a story
 * whose `finished_at` is null, and re-stamping the date on one that is already
 * finished would change nothing that is counted anywhere.
 */
async function finishStory(id: string, now: Date = new Date()): Promise<StoryRow> {
  const { data, error } = await supabase
    .from('stories')
    .update({ finished_at: now.toISOString() })
    .eq('id', id)
    .select()
    .single<StoryRow>();
  if (error) throw error;
  return data;
}

/**
 * Explain one tapped word in its sentence, via `generate` mode `gloss`.
 *
 * Two different 502s can come back and they mean opposite things to the user —
 * see `describeGlossError`, which is the only place that wording lives.
 */
async function glossWord(word: string, sentence: string): Promise<Gloss> {
  const body = await callEdgeFunction<unknown>('generate', { mode: 'gloss', word, sentence });
  return parseGloss(body);
}

/**
 * The deck's card for `word`, matched case-insensitively on `sr_cyr`, or null.
 *
 * `ilike` gets the case-insensitivity, and the exact re-check in JS is what
 * makes it a *match* rather than a pattern: `%` and `_` are wildcards to
 * PostgREST, and although `tokenize` can only ever hand this letters and
 * hyphens, a near-miss card silently shown as "the word you tapped" would be a
 * quiet lie rather than a visible bug.
 */
async function findCardByWord(word: string): Promise<CardRow | null> {
  const needle = word.trim();
  if (!needle) return null;

  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .ilike('sr_cyr', needle)
    .limit(5)
    .returns<CardRow[]>();
  if (error) throw error;

  const lowered = needle.toLowerCase();
  return (data ?? []).find((card) => card.sr_cyr.trim().toLowerCase() === lowered) ?? null;
}

// ---------------------------------------------------------------------------
// Tutor chat
// ---------------------------------------------------------------------------

/** How much history the chat screen loads. Context sent is a subset (Task 10). */
export const CHAT_HISTORY_LIMIT = 50;

/**
 * The most recent messages, oldest first.
 *
 * Read newest-first and reversed, because "the last 50" is what a chat screen
 * wants and PostgREST has no `offset from the end`. Ordered by `created_at`
 * (the indexed column) with `id` breaking ties: two messages written inside the
 * same clock tick would otherwise come back in an arbitrary order, and a
 * question after its answer reads as nonsense.
 */
async function listChatMessages(limit: number = CHAT_HISTORY_LIMIT): Promise<ChatMessageRow[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    // Redundant under RLS, but it is what lets the planner use
    // `chat_messages_user_created_idx`.
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
    .returns<ChatMessageRow[]>();
  if (error) throw error;
  return (data ?? []).reverse();
}

/**
 * Append one message to the history and return the saved row.
 *
 * The user's message is written *before* the stream starts, so a failed reply
 * leaves what he typed on screen and in the database rather than losing it. The
 * assistant's is written after the stream completes, with the DODAJ lines still
 * in it — the raw text is what the tutor said, and the chips are re-derived at
 * render, so the convention can change without rewriting history.
 */
async function appendChatMessage(role: ChatRole, content: string): Promise<ChatMessageRow> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ user_id: userId, role, content })
    .select()
    .single<ChatMessageRow>();
  if (error) throw error;
  return data;
}

/** A `user_cards` row with just enough of its card to name the word. */
interface LapsedJoinRow {
  lapses: number | null;
  cards: Pick<CardRow, 'sr_cyr' | 'en'> | Pick<CardRow, 'sr_cyr' | 'en'>[] | null;
}

/**
 * The learner-state block appended to the tutor's system prompt: the dashboard
 * figures plus the handful of cards that keep coming back.
 *
 * Best effort by design. It is context, not content — if either query fails the
 * conversation should still happen, just without the personalisation, so the
 * caller gets `undefined` rather than an exception.
 */
async function getLearnerState(now: Date = new Date()): Promise<string | undefined> {
  try {
    const userId = await requireUserId();
    const [stats, lapsedResult] = await Promise.all([
      getDashboard(now),
      supabase
        .from('user_cards')
        .select('lapses, cards(sr_cyr, en)')
        .eq('user_id', userId)
        .gt('lapses', 0)
        .order('lapses', { ascending: false })
        .limit(LEARNER_STATE_WORDS)
        .returns<LapsedJoinRow[]>(),
    ]);
    if (lapsedResult.error) throw lapsedResult.error;

    const lapsed: LapsedCard[] = [];
    for (const row of lapsedResult.data ?? []) {
      const card = Array.isArray(row.cards) ? row.cards[0] : row.cards;
      if (!card) continue; // Should be unreachable: the FK guarantees a card.
      lapsed.push({ sr_cyr: card.sr_cyr, en: card.en, lapses: row.lapses ?? 0 });
    }

    return formatLearnerState({ stats, lapsed });
  } catch (error) {
    console.warn('[chat] learner state unavailable', error);
    return undefined;
  }
}

/** The signed-in user's access token, for the streaming `tutor` call. */
async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return token;
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
  listDrillStats,
  recordDrillAttempts,
  getProgress,
  listStories,
  createStory,
  finishStory,
  glossWord,
  findCardByWord,
  listChatMessages,
  appendChatMessage,
  getLearnerState,
  getAccessToken,
};
