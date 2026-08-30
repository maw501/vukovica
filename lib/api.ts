/**
 * Typed helpers over supabase-js. This is the whole data layer: every call here
 * is a direct PostgREST request made as the signed-in user, protected by RLS.
 * There is no server of our own left to call — phase 3 deleted the Edge
 * Functions, so PostgREST and storage are the only two things this talks to.
 */

import { trimCardInput, type CardInput } from '@/lib/cardInput';
import {
  BUMP_DRILL_STATS_FN,
  bumpDrillStatsParams,
  type LetterDelta,
} from '@/lib/drills';
import { gradeCard, newUserCard, type ReviewGrade } from '@/lib/fsrs';
import { BUMP_GRAMMAR_STATS_FN, bumpGrammarStatsParams } from '@/lib/grammar';
import {
  buildQueue,
  cardsInDeck,
  deckAllowance,
  deckKind,
  DEFAULT_DECK,
  type Deck,
} from '@/lib/queue';
import { SUBMIT_REVIEW_FN, submitReviewParams } from '@/lib/reviewRpc';
import { computeProgress, type Progress } from '@/lib/stages';
import {
  collectLocalDays,
  computeStreak,
  longestStreakFromLocalDays,
  startOfLocalDay,
  streakFromLocalDays,
} from '@/lib/streak';
import { supabase } from '@/lib/supabase';
import type {
  CardRow,
  DrillStatRow,
  GrammarItemRow,
  GrammarStatRow,
  GrammarTopicRow,
  RequestRow,
  RequestSource,
  SettingsRow,
  StoryRow,
  UserCardRow,
  XpKind,
} from '@/lib/types';
import { levelFor, todayXp, XP_AWARDS, type XpAmountAt } from '@/lib/xp';

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

/**
 * One deck's numbers. Words and letters are counted separately all the way
 * through (spec §4): a letter answered today must not spend the word deck's
 * daily allowance, and "Due 3" on the Letters tile has to mean three letters.
 */
export interface DeckStats {
  /** Already-studied `user_cards` rows whose `due` has passed (excludes `new`). */
  dueCount: number;
  /** Cards of this deck the user has never studied -- no `user_cards` row yet. */
  newAvailable: number;
  /** New cards of this deck already introduced today (local day). */
  newDoneToday: number;
}

export interface DashboardStats extends DeckStats {
  /**
   * Consecutive local days with at least one review, ending today or yesterday.
   * Deck-independent on purpose -- the streak is the habit, not the deck.
   */
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

/** One page of `reviewed_at` values, newest first. */
async function fetchReviewedAtPage(userId: string, page: number): Promise<(string | null)[]> {
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
  return (data ?? []).map((row) => row.reviewed_at as string | null);
}

async function fetchStreakDays(userId: string, now: Date): Promise<number> {
  const days = new Set<string>();
  let streak = 0;

  for (let page = 0; page < STREAK_MAX_PAGES; page += 1) {
    const reviewedAt = await fetchReviewedAtPage(userId, page);
    if (reviewedAt.length === 0) break;

    collectLocalDays(reviewedAt, days);
    streak = streakFromLocalDays(days, now);

    // Fewer rows than asked for means we have the full history.
    if (reviewedAt.length < STREAK_PAGE_SIZE) break;
    // If some fetched day is *not* part of the streak, the gap that ends the
    // streak is already inside this window and older rows cannot extend it.
    if (days.size > streak) break;
  }

  return streak;
}

/**
 * Every local day the user has ever reviewed on.
 *
 * The whole history, with none of `fetchStreakDays`'s early exit: the *longest*
 * streak can be anywhere in it, so there is no window that settles the answer.
 * That is why only the progress screen — opened deliberately, not painted on
 * every dashboard visit — asks for this.
 */
async function fetchAllReviewDays(userId: string): Promise<Set<string>> {
  const days = new Set<string>();
  for (let page = 0; page < STREAK_MAX_PAGES; page += 1) {
    const reviewedAt = await fetchReviewedAtPage(userId, page);
    collectLocalDays(reviewedAt, days);
    if (reviewedAt.length < STREAK_PAGE_SIZE) break;
  }
  return days;
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
 *
 * Scoped to one deck through an inner join on `cards`. The join drops nothing
 * the unfiltered count used to include because `submit_review` always writes
 * `card_id` — every log this app creates has a card. (The cascade on the FK is a
 * separate guarantee: it stops a *deleted* card leaving a dangling reference,
 * which is not the same thing as the column never being null.)
 */
async function countNewDoneToday(userId: string, now: Date, deck: Deck): Promise<number> {
  const { count, error } = await supabase
    .from('review_logs')
    .select('*, cards!inner(kind)', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('state_before', 'new')
    .eq('cards.kind', deckKind(deck))
    .gte('reviewed_at', startOfLocalDay(now).toISOString());
  if (error) throw error;
  return count ?? 0;
}

/**
 * One deck's due / new figures.
 *
 * Every count is filtered by `cards.kind`, through an inner join where the row
 * being counted is a `user_cards` row. The FK makes that join total, so for the
 * word deck these are exactly the counts the dashboard has always shown.
 *
 * The daily allowance is deliberately *not* fetched here. It is a pure function
 * of the deck and `settings.new_per_day` (`deckAllowance`), and every caller
 * already holds the settings row in its own `['settings']` query — reading it
 * again here would put a second, racing `getSettings()` on the dashboard's
 * first paint for the sake of arithmetic the caller can do itself.
 */
async function getDeckStats(deck: Deck = DEFAULT_DECK, now: Date = new Date()): Promise<DeckStats> {
  const userId = await requireUserId();
  return deckStatsFor(userId, deck, now);
}

async function deckStatsFor(userId: string, deck: Deck, now: Date): Promise<DeckStats> {
  const nowIso = now.toISOString();
  const kind = deckKind(deck);

  const [due, totalCards, studiedCards, newDoneToday] = await Promise.all([
    // `state = 'new'` is excluded deliberately: a freshly introduced card gets
    // a `user_cards` row defaulting to due = now(), so counting it here would
    // show it as Due *and* against the new allowance. New cards belong to the
    // allowance only.
    supabase
      .from('user_cards')
      .select('*, cards!inner(kind)', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('cards.kind', kind)
      .neq('state', 'new')
      .lte('due', nowIso),
    supabase.from('cards').select('*', { count: 'exact', head: true }).eq('kind', kind),
    // Every `user_cards` row references a card (FK), one row per card, so
    // "cards of this deck with no user_cards row" is the difference of two counts.
    supabase
      .from('user_cards')
      .select('*, cards!inner(kind)', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('cards.kind', kind),
    countNewDoneToday(userId, now, deck),
  ]);

  for (const result of [due, totalCards, studiedCards]) {
    if (result.error) throw result.error;
  }

  return {
    dueCount: due.count ?? 0,
    newAvailable: Math.max(0, (totalCards.count ?? 0) - (studiedCards.count ?? 0)),
    newDoneToday,
  };
}

/**
 * Everything the home dashboard's habit card shows: the word deck's numbers
 * plus the streak. The Letters tile asks for its own deck separately, and the
 * streak is not repeated there — it counts reviews of either deck.
 */
async function getDashboard(now: Date = new Date()): Promise<DashboardStats> {
  const userId = await requireUserId();

  // The streak paginates, so it runs alongside the deck counts rather than
  // after them. One `Promise.all` over both, so nothing can reject unobserved.
  const [stats, streakDays] = await Promise.all([
    deckStatsFor(userId, DEFAULT_DECK, now),
    fetchStreakDays(userId, now),
  ]);

  return { ...stats, streakDays };
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
async function fetchNewCards(
  userId: string,
  allowance: number,
  deck: Deck,
): Promise<CardRow[]> {
  if (allowance <= 0) return [];

  const studied = await supabase.from('user_cards').select('card_id').eq('user_id', userId);
  if (studied.error) throw studied.error;
  const seen = new Set((studied.data ?? []).map((row) => row.card_id as string));

  const candidates = await supabase
    .from('cards')
    .select('*')
    // The deck filter. Without it the letters would queue themselves as word
    // cards the moment they were seeded.
    .eq('kind', deckKind(deck))
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
async function getQueue(deck: Deck = DEFAULT_DECK, now: Date = new Date()): Promise<QueueEntry[]> {
  const userId = await requireUserId();
  const kind = deckKind(deck);

  const [settings, newDoneToday, dueResult] = await Promise.all([
    getSettings(),
    countNewDoneToday(userId, now, deck),
    supabase
      .from('user_cards')
      // `!inner` rather than a plain embed so the deck filter below can apply to
      // the joined card. The FK is `not null`, so the join drops nothing.
      .select('*, cards!inner(*)')
      .eq('user_id', userId)
      .eq('cards.kind', kind)
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

  const newPerDay = deckAllowance(deck, settings.new_per_day ?? DEFAULT_NEW_PER_DAY);

  // Index the due rows by card id before handing the bare rows to `buildQueue`,
  // which orders ids and knows nothing about card content.
  const dueCards: UserCardRow[] = [];
  const byId = new Map<string, QueueEntry>();
  for (const row of dueResult.data ?? []) {
    const card = embeddedCard(row);
    if (!card) continue; // Should be unreachable: the FK guarantees a card.
    // The two decks never mix in one session (spec §4). PostgREST has already
    // filtered by kind; this is the belt to that braces, because a card of the
    // wrong deck reaching the screen would be shown with the wrong layout.
    if (card.kind !== kind) continue;
    const { cards: _embedded, ...userCard } = row;
    dueCards.push(userCard);
    byId.set(card.id, { cardId: card.id, isNew: false, card, userCard });
  }

  const newCards = cardsInDeck(
    await fetchNewCards(userId, Math.max(0, newPerDay - newDoneToday), deck),
    deck,
  );
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
 * The word deck, alphabetically.
 *
 * Deviation from the brief, which specified `listCards(search)`: searching is
 * done in memory by `filterCards` instead, because a card's Latin form is
 * derived by `cyrToLat` rather than stored, so "mama" could never match "мама"
 * in SQL. One fetch of a few hundred rows beats a round trip per keystroke.
 *
 * Words only. Both callers -- the deck browser and the trainer's drill pool --
 * want vocabulary: a letter card's `sr_cyr` is a *pair* ("Б б"), which is not
 * a word to browse, edit or type as a transliteration drill.
 */
async function listCards(): Promise<CardRow[]> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('kind', deckKind('words'))
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
 * Stories the user has finished — the Reading ladder's numerator.
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
 * The four inputs are independent, so they go out together; `computeProgress`
 * turns them into the stage and goal without any further I/O. `listDrillStats`
 * reaches for the session again, which is a local read, not a round trip.
 *
 * The books count needs none of `countStoriesFinished`'s defensiveness: `books`
 * ships in the same migration as everything else phase 3 reads, so a failure
 * here is a real failure and says so.
 */
async function getProgress(): Promise<Progress> {
  const userId = await requireUserId();

  const [drillStats, known, storiesRead, booksFinished] = await Promise.all([
    listDrillStats(),
    // "Known" is a word that has graduated out of learning: `state = 'review'`.
    // 'relearning' is deliberately excluded — a lapsed word is one he no longer
    // knows, and counting it would make the milestone ladder go backwards
    // silently rather than honestly.
    //
    // Words only: letter cards share this table, and letter *mastery* is the
    // trainer's `drill_stats`, not FSRS (spec §4). Counting a graduated letter
    // as a known word would inflate the Words ladder by up to thirty.
    supabase
      .from('user_cards')
      .select('*, cards!inner(kind)', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('cards.kind', deckKind('words'))
      .eq('state', 'review'),
    countStoriesFinished(userId),
    supabase
      .from('books')
      .select('*', { count: 'exact', head: true })
      // Redundant under RLS, but it keeps this a user-scoped index lookup.
      .eq('user_id', userId)
      .not('finished_at', 'is', null),
  ]);
  if (known.error) throw known.error;
  if (booksFinished.error) throw booksFinished.error;

  return computeProgress({
    drillStats,
    knownWords: known.count ?? 0,
    storiesRead,
    booksFinished: booksFinished.count ?? 0,
  });
}

// ---------------------------------------------------------------------------
// XP
// ---------------------------------------------------------------------------

/**
 * Record one piece of work in the XP ledger.
 *
 * A plain client insert, protected by `xp_events_insert_own` — there is no RPC
 * to hang it off, because the two writes that *do* have one (`submit_review`,
 * `bump_drill_stats`) are the ones whose halves must not come apart. XP is not
 * like that: it is a garnish on work that is already saved, so an award that
 * fails costs its own points and nothing else. Callers award after the real
 * write has landed, and swallow the failure.
 *
 * `amount` defaults to the kind's tariff and is only ever passed explicitly by a
 * caller with a reason to differ. A non-positive award writes no row at all: a
 * zero-XP event is a row that means nothing, and `book_page` and `request` are
 * worth exactly nothing (see `XP_AWARDS`).
 */
async function awardXp(kind: XpKind, amount: number = XP_AWARDS[kind]): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const userId = await requireUserId();
  const { error } = await supabase
    .from('xp_events')
    // `user_id` is not decoration: the `xp_events_insert_own` policy checks it.
    .insert({ user_id: userId, amount: Math.round(amount), kind });
  if (error) throw error;
}

/** The three numbers the dashboard ring and the progress screen show. */
export interface XpSummary {
  /** Lifetime XP: the sum of the whole ledger. */
  total: number;
  /** 1 + floor(total / 150). */
  level: number;
  /** XP earned on the device's local day, the ring's numerator. */
  today: number;
}

/**
 * PostgREST caps a response at `max_rows` (1000), and aggregate functions are
 * off (`PGRST123` locally and on a default-configured hosted project), so the
 * lifetime total is summed client-side a page at a time.
 *
 * 20 pages is twenty thousand events — years of daily study at a couple of
 * dozen awards a day. Past that the total would quietly stop growing, so if this
 * app is ever still in use at that point the fix is a `sum(amount)` in Postgres
 * (an RPC, like `submit_review`), not a bigger number here.
 */
const XP_PAGE_SIZE = 1000;
const XP_MAX_PAGES = 20;

async function fetchXpTotal(userId: string): Promise<number> {
  let total = 0;
  for (let page = 0; page < XP_MAX_PAGES; page += 1) {
    const from = page * XP_PAGE_SIZE;
    const { data, error } = await supabase
      .from('xp_events')
      .select('amount')
      // Redundant under RLS, but it is what lets the planner use
      // `xp_events_user_created_idx`.
      .eq('user_id', userId)
      // A `range` without an order is not pagination: Postgres may return the
      // rows in a different order for each page, which would double-count some
      // events and drop others. `id` breaks ties within one instant.
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + XP_PAGE_SIZE - 1)
      .returns<{ amount: number | null }[]>();
    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) total += row.amount ?? 0;
    if (rows.length < XP_PAGE_SIZE) break;
  }
  return total;
}

/**
 * Lifetime XP, the level it buys, and today's ring.
 *
 * Today's events are fetched separately rather than sliced out of the total's
 * pages: the day boundary is built exactly as `countNewDoneToday` builds it, so
 * one bounded read answers it however long the ledger has grown. `todayXp` then
 * re-checks the local day, which is what keeps a future-dated row (a clock that
 * has run backwards) out of a ring that is meant to mean *today*.
 */
async function getXpSummary(now: Date = new Date()): Promise<XpSummary> {
  const userId = await requireUserId();

  const [total, todayRows] = await Promise.all([
    fetchXpTotal(userId),
    supabase
      .from('xp_events')
      .select('amount, created_at')
      .eq('user_id', userId)
      .gte('created_at', startOfLocalDay(now).toISOString())
      .limit(MAX_ROWS)
      .returns<XpAmountAt[]>(),
  ]);
  if (todayRows.error) throw todayRows.error;

  return { total, level: levelFor(total), today: todayXp(todayRows.data ?? [], now) };
}

/**
 * The progress screen's own numbers — the ones no other screen needs.
 *
 * Everything else it shows already has a query: `getProgress` for the ladders
 * and letter mastery, `getXpSummary` for XP. This adds the two that do not: the
 * streak record, and how many capture requests have been answered.
 */
export interface ProgressReport {
  /** Consecutive local days ending today or yesterday. Same figure as the dashboard's. */
  streakDays: number;
  /** The best run in the whole history, which may be long over. */
  longestStreakDays: number;
  /** `requests` rows that have been fulfilled with a card. */
  requestsFulfilled: number;
}

async function getProgressReport(now: Date = new Date()): Promise<ProgressReport> {
  const userId = await requireUserId();

  const [days, fulfilled] = await Promise.all([
    fetchAllReviewDays(userId),
    supabase
      .from('requests')
      .select('*', { count: 'exact', head: true })
      // Redundant under RLS, but it keeps this a user-scoped index lookup.
      .eq('user_id', userId)
      .eq('status', 'done'),
  ]);
  if (fulfilled.error) throw fulfilled.error;

  // Both streaks off the one day set: fetching the history twice to answer two
  // questions about it would be a round trip for arithmetic.
  return {
    streakDays: streakFromLocalDays(days, now),
    longestStreakDays: longestStreakFromLocalDays(days),
    requestsFulfilled: fulfilled.count ?? 0,
  };
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
 * Mark a story read. The Reading ladder counts exactly this column.
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
 * The deck's card for `word`, matched case-insensitively on `sr_cyr`, or null.
 *
 * `ilike` gets the case-insensitivity, and the exact re-check in JS is what
 * makes it a *match* rather than a pattern: `%` and `_` are wildcards to
 * PostgREST, and although `tokenize` can only ever hand this letters and
 * hyphens, a near-miss card silently shown as "the word you tapped" would be a
 * quiet lie rather than a visible bug.
 *
 * Words only, by construction. A letter card's `sr_cyr` is a pair ("Б б"), which
 * no tapped token can equal today — but partitioning the lookup here means a
 * later change to how letter cards are stored cannot turn a tap in a story into
 * a flashcard for a letter.
 */
async function findCardByWord(word: string): Promise<CardRow | null> {
  const needle = word.trim();
  if (!needle) return null;

  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('kind', deckKind('words'))
    .ilike('sr_cyr', needle)
    .limit(5)
    .returns<CardRow[]>();
  if (error) throw error;

  const lowered = needle.toLowerCase();
  return (data ?? []).find((card) => card.sr_cyr.trim().toLowerCase() === lowered) ?? null;
}

// ---------------------------------------------------------------------------
// Capture queue
// ---------------------------------------------------------------------------

/**
 * The card columns a fulfilled request shows. Deliberately not the whole row:
 * the queue is a list of answers, and the answer to "how do I say this?" is the
 * Serbian and its gloss — the rest of the card is what the deck screen is for.
 */
export type RequestCard = Pick<CardRow, 'sr_cyr' | 'en'>;

/** A `requests` row together with the card that answered it, if one has. */
export interface RequestEntry extends RequestRow {
  /** null while pending, and for a fulfilled request whose card was deleted. */
  card: RequestCard | null;
}

/**
 * The embed as PostgREST returns it. `requests.card_id` is a plain nullable FK,
 * so the answer is a single object or null — typed defensively against an array
 * anyway, exactly as `DueJoinRow` is, because a schema change that made the
 * relationship ambiguous would otherwise fail silently at runtime.
 */
interface RequestJoinRow extends RequestRow {
  card: RequestCard | RequestCard[] | null;
}

function embeddedRequestCard(row: RequestJoinRow): RequestCard | null {
  if (!row.card) return null;
  return Array.isArray(row.card) ? (row.card[0] ?? null) : row.card;
}

/**
 * The capture queue, newest first, with each answered request's card alongside.
 *
 * One read rather than a list plus a card lookup per done row: the join is a
 * left join (`card_id` is nullable), so a pending request comes back with
 * `card: null` and nothing has to be stitched together on the client.
 */
async function listRequests(): Promise<RequestEntry[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('requests')
    // Aliased to `card` because it is one card, not the table.
    .select('*, card:cards(sr_cyr, en)')
    // Redundant under RLS, but it is what lets the planner use
    // `requests_user_created_idx`.
    .eq('user_id', userId)
    // `nullsFirst: false` because the column is nullable: Postgres sorts nulls
    // first in a descending order, so a row whose `created_at` somehow ended up
    // null would pin itself to the top of the queue for ever.
    .order('created_at', { ascending: false, nullsFirst: false })
    // `created_at` defaults to now() and two requests filed in the same instant
    // would otherwise come back in an arbitrary order that changed per fetch.
    .order('id', { ascending: true })
    .limit(MAX_ROWS)
    .returns<RequestJoinRow[]>();
  if (error) throw error;

  return (data ?? []).map((row) => {
    const { card: _embedded, ...rest } = row;
    return { ...rest, card: embeddedRequestCard(row) };
  });
}

export interface CreateRequestArgs {
  /** What Mark typed, or the tapped word and its sentence (`readerRequestText`). */
  text_en: string;
  /** Defaults to the quick-add box; the reading views pass 'reader'. */
  source?: RequestSource;
}

/**
 * File one request. `status` and `created_at` come from the schema's defaults,
 * so "pending, now" is defined in exactly one place.
 *
 * No XP: `XP_AWARDS.request` is 0 on purpose (spec §9) — asking for a phrase is
 * not study, and paying for it would make the ring fillable by typing.
 */
async function createRequest({ text_en, source = 'typed' }: CreateRequestArgs): Promise<RequestRow> {
  const userId = await requireUserId();
  const text = text_en.trim();
  // Trimmed to nothing is not a request. The screen blocks this before it gets
  // here; the check is what stops a blank row reaching a queue answered by hand.
  if (text === '') throw new Error('A request needs some text.');

  const { data, error } = await supabase
    .from('requests')
    // `user_id` is not decoration: the `requests_insert_own` policy checks it.
    .insert({ user_id: userId, text_en: text, source })
    .select()
    .single<RequestRow>();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

/**
 * The user's accuracy on one topic, as the topic list shows it. Just the two
 * counters — `topicAccuracy` in lib/grammar.ts turns them into a percentage.
 */
export type GrammarStat = Pick<GrammarStatRow, 'attempts' | 'correct'>;

/** A topic row together with the signed-in user's accuracy on it, if any. */
export interface GrammarTopicEntry extends GrammarTopicRow {
  /** null until the topic has been drilled at least once. */
  stat: GrammarStat | null;
}

/**
 * The embed as PostgREST returns it. `grammar_stats` is a *child* of
 * `grammar_topics` (many rows, one per user), so the embed is an array — of at
 * most one element, because `grammar_stats_select_own` admits only the caller's
 * own row. Typed for both shapes anyway, as `RequestJoinRow` is, so a schema
 * change that made the relationship one-to-one could not fail silently.
 */
interface GrammarTopicJoinRow extends GrammarTopicRow {
  stat: GrammarStat | GrammarStat[] | null;
}

function embeddedGrammarStat(row: GrammarTopicJoinRow): GrammarStat | null {
  if (!row.stat) return null;
  return Array.isArray(row.stat) ? (row.stat[0] ?? null) : row.stat;
}

/**
 * Every grammar topic in teaching order, each with the user's accuracy on it.
 *
 * One read rather than a topic list plus a stats list: the embed is filtered by
 * the same RLS policy that protects a direct read, so the counters that come
 * back are the caller's own and nothing has to be stitched together on the
 * client. Twelve rows today and no paging worry — this content is seeded, not
 * user-generated — but `MAX_ROWS` keeps it honest if that ever changes.
 *
 * The topic screen reads this same list and finds its topic by slug, so opening
 * a topic from here costs no round trip.
 */
async function listGrammarTopics(): Promise<GrammarTopicEntry[]> {
  const { data, error } = await supabase
    .from('grammar_topics')
    // Aliased to `stat` because it is the user's one row, not the table.
    .select('*, stat:grammar_stats(attempts, correct)')
    .order('sort', { ascending: true })
    .limit(MAX_ROWS)
    .returns<GrammarTopicJoinRow[]>();
  if (error) throw error;

  return (data ?? []).map((row) => {
    const { stat: _embedded, ...rest } = row;
    return { ...rest, stat: embeddedGrammarStat(row) };
  });
}

/**
 * One topic's drill items, in teaching order. `pickRun` samples from these; the
 * order they come back in is the order a run is asked in.
 */
async function listGrammarItems(topicId: string): Promise<GrammarItemRow[]> {
  const { data, error } = await supabase
    .from('grammar_items')
    .select('*')
    .eq('topic_id', topicId)
    .order('sort', { ascending: true })
    .limit(MAX_ROWS)
    .returns<GrammarItemRow[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Add one finished run to a topic's counters.
 *
 * Through `bump_grammar_stats` rather than an upsert, for the reason
 * `recordDrillAttempts` gives: PostgREST's upsert *replaces* the counts and this
 * has to add to them. One request per run — not per item — so a run abandoned
 * half way records nothing, which is the same bargain the trainer's XP makes.
 */
async function recordGrammarRun(
  topicId: string,
  attempts: number,
  correct: number,
): Promise<GrammarStatRow> {
  const { data, error } = await supabase.rpc(
    BUMP_GRAMMAR_STATS_FN,
    bumpGrammarStatsParams(topicId, attempts, correct),
  );
  if (error) throw error;
  // The project has no generated `Database` types, so an RPC's result type is
  // whatever the caller says it is. The function returns one `grammar_stats` row.
  return data as GrammarStatRow;
}

export const api = {
  getSettings,
  updateSettings,
  getDashboard,
  getDeckStats,
  getQueue,
  submitReview,
  listCards,
  addCard,
  updateCard,
  deleteCard,
  listDrillStats,
  recordDrillAttempts,
  getProgress,
  awardXp,
  getXpSummary,
  getProgressReport,
  listStories,
  finishStory,
  findCardByWord,
  listRequests,
  createRequest,
  listGrammarTopics,
  listGrammarItems,
  recordGrammarRun,
};
