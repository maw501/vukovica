/**
 * "My words" — the list of words Mark himself knows, and the rule that decides
 * what belongs on it.
 *
 * The Deck screen lists every card in the app; this is the other question. Mark
 * asked for "a library / vocab list of common words I know which I can build up
 * over time", so what this module works over is `user_cards` — the rows that
 * exist only because he has actually studied the word — rather than `cards`.
 *
 * **The known rule lives here and is the same rule the dashboard counts by.**
 * `api.getProgress` counts `state = 'review'` for the Words ladder, deliberately
 * excluding `relearning` ("a lapsed word is one he no longer knows"), and
 * `classifyKnown` says exactly that. One rule, two readers: a word cannot be in
 * the Known list and outside the 142 the dashboard is counting towards the next
 * milestone.
 *
 * Pure and dependency-free, like `lib/letters.ts` and `lib/queue.ts`: `api.ts`
 * reaches `lib/supabase.ts` (and therefore `react-native`), which the Node-based
 * vitest environment cannot load, so everything this screen decides is decided
 * here, over rows the caller has already fetched.
 */

import type { CardRow, CardState, UserCardRow } from '@/lib/types';

/** Which of the two sections a studied word sits in. */
export type LibraryStatus = 'known' | 'learning';

/** One studied word: the card, and the scheduling row that proves it studied. */
export interface LibraryEntry {
  card: CardRow;
  userCard: UserCardRow;
}

/**
 * Known, or still learning.
 *
 * `review` is graduation — FSRS moves a card there once it has survived the
 * learning steps — and it is the single state the Words ladder counts (see
 * `api.getProgress`). `relearning` is a word that lapsed: counting it as known
 * would make both this list and that ladder claim a word he has just failed.
 */
export function classifyKnown(row: { state: CardState }): LibraryStatus {
  return row.state === 'review' ? 'known' : 'learning';
}

/** The same rule where a predicate reads better than a string comparison. */
export function isKnown(row: { state: CardState }): boolean {
  return classifyKnown(row) === 'known';
}

/** The two sections, each keeping the order it was given. */
export function splitLibrary(entries: readonly LibraryEntry[]): {
  known: LibraryEntry[];
  learning: LibraryEntry[];
} {
  const known: LibraryEntry[] = [];
  const learning: LibraryEntry[] = [];
  for (const entry of entries) {
    (isKnown(entry.userCard) ? known : learning).push(entry);
  }
  return { known, learning };
}

/**
 * The line under the title: "142 words known · 38 still learning".
 *
 * A side with nothing in it is left out rather than printed as a zero — "0 still
 * learning" is a fact about nothing, and the first thing this screen says on the
 * day it is first opened should be that there is nothing here yet.
 */
export function libraryHeadline(known: number, learning: number): string {
  const parts: string[] = [];
  if (known > 0) parts.push(`${known} ${known === 1 ? 'word' : 'words'} known`);
  if (learning > 0) parts.push(`${learning} still learning`);
  return parts.length > 0 ? parts.join(' · ') : 'No words yet';
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How long ago the word was last practised, in words.
 *
 * `user_cards.last_review` is the honest column to hand: the row carries no
 * "first learned" stamp, and deriving one would mean a `min(reviewed_at)` over
 * the whole of `review_logs` for a line of small print. So the row says when the
 * word was last seen rather than when it was first met, and says so.
 *
 * Days, not dates, for a fortnight — "3 days ago" is what a learner actually
 * wants to know — and a plain date after that, where the count stops meaning
 * anything. A stamp in the future (a clock skew, nothing else) reads as today
 * rather than as a negative number of days.
 */
export function learnedLabel(lastReview: string | null, now: Date = new Date()): string | null {
  if (!lastReview) return null;
  const seen = new Date(lastReview);
  const time = seen.getTime();
  if (!Number.isFinite(time)) return null;

  const days = Math.floor((startOfDay(now) - startOfDay(seen)) / MS_PER_DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 14) return `${days} days ago`;
  return seen.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Midnight local, so "yesterday" means the calendar day and not 24 hours. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The two orders the screen offers. */
export type LibrarySort = 'recent' | 'alpha';

/**
 * A sorted copy. `recent` is most recently practised first (a word never
 * reviewed sorts last); `alpha` is A–Z in Serbian collation, which is what puts
 * ч after ц rather than wherever Unicode happens to place it.
 *
 * Both break ties alphabetically, so the list does not shuffle itself between
 * renders when two words were answered in the same session.
 */
export function sortLibrary(
  entries: readonly LibraryEntry[],
  sort: LibrarySort,
): LibraryEntry[] {
  const byWord = (a: LibraryEntry, b: LibraryEntry) =>
    a.card.sr_cyr.localeCompare(b.card.sr_cyr, 'sr');

  if (sort === 'alpha') return [...entries].sort(byWord);

  return [...entries].sort((a, b) => seenAt(b) - seenAt(a) || byWord(a, b));
}

/** `last_review` as a number; a word never reviewed sorts to the very end. */
function seenAt(entry: LibraryEntry): number {
  if (!entry.userCard.last_review) return Number.NEGATIVE_INFINITY;
  const time = new Date(entry.userCard.last_review).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

// ---------------------------------------------------------------------------
// The mark_known wire contract
// ---------------------------------------------------------------------------

/**
 * The name and arguments of `public.mark_known`
 * (`supabase/migrations/20260904130000_mark_known.sql`).
 *
 * Argument names here and in the SQL are one contract with no compiler across
 * it: rename one side and PostgREST answers 404 at runtime. `library.test.ts`
 * parses the migration and compares, which is what stops that happening.
 */
export const MARK_KNOWN_FN = 'mark_known';

/**
 * The stability a marked-known word is given, in days, and how far out it is
 * parked. A word Mark says he already knows should not come round for a
 * season — long enough to be out of the way, short enough that the app checks
 * he was right eventually.
 *
 * The literals are checked against the migration by `library.test.ts`, because
 * nothing else spans the two languages.
 */
export const KNOWN_STABILITY = 90;
export const KNOWN_DUE_DAYS = 90;

export interface MarkKnownParams {
  p_card_id: string;
}

/**
 * One "I already know this" as the function's arguments.
 *
 * Deliberately no `p_user_id`: the function fills `user_id` from `auth.uid()`,
 * so the id never travels on the wire and a client cannot mark a card known on
 * somebody else's behalf. Deliberately no XP either — this is a word being
 * declared, not a word being studied, and the ledger records work done.
 */
export function markKnownParams(cardId: string): MarkKnownParams {
  return { p_card_id: cardId };
}
