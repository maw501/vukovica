/**
 * The letters drill: what a run contains, in what order, and how a rating is
 * written down.
 *
 * There is no scheduling here, and that is the point. The alphabet is thirty
 * cards Mark asked to be able to practise "again and again as much as I want",
 * so every letter is in every run unless he himself narrows it to the tricky
 * ones. What the tallies in `letter_stats` buy is *order* — the letters he has
 * just missed come first — and a "solid" tick once one has been got right three
 * times running. Neither can withhold a card.
 *
 * Pure and dependency-free, like `lib/queue.ts` and `lib/streak.ts`: `api.ts`
 * reaches `lib/supabase.ts` (and therefore `react-native`), which the Node-based
 * vitest environment cannot load, so everything the drill decides is decided
 * here, over rows the caller has already fetched.
 */

import type { CardRow, LetterStatRow } from '@/lib/types';

/**
 * "Got it" this many times in a row and the letter is solid: a tick in the
 * alphabet browser, and out of the "Only the tricky ones" run.
 *
 * Three, not more: this is the *recognition* bar — knowing which sound the shape
 * makes — and the harder bar (typing whole words at 90% over eight tries) is the
 * trainer's, which is what the Alphabet stage still measures mastery by.
 */
export const LETTER_SOLID_STREAK = 3;

/**
 * The key a letter is tallied under: the card's `sr_cyr`, i.e. the pair as
 * printed — "Б б", not "б".
 *
 * It is the card's own unique column, so a tally row always traces back to the
 * card that produced it, and it can never be mistaken for a `drill_stats.letter`
 * (a single lowercase glyph, the trainer's key) if the two are ever read
 * together.
 */
export function letterKey(card: CardRow): string {
  return card.sr_cyr;
}

/** One letter's tally, as everything below needs it. */
export interface LetterStat {
  /** Times rated "Got it". */
  easy: number;
  /** Times rated "Not yet". */
  hard: number;
  /** Consecutive "Got it"s: +1 on easy, back to 0 on hard. */
  streak: number;
}

/** A letter nobody has rated yet. */
export const UNRATED: LetterStat = { easy: 0, hard: 0, streak: 0 };

/**
 * The tally rows as a lookup, with nulls and negatives absorbed.
 *
 * `letter_stats` is keyed by (user, letter) so duplicates cannot happen, but the
 * columns are nullable in the row type (a `select` can return null for any of
 * them) and a total function is one less thing for the screen to think about.
 */
export function statsByLetter(rows: readonly LetterStatRow[]): Map<string, LetterStat> {
  const stats = new Map<string, LetterStat>();
  for (const row of rows) {
    if (!row.letter) continue;
    stats.set(row.letter, {
      easy: nonNegative(row.easy),
      hard: nonNegative(row.hard),
      streak: nonNegative(row.streak),
    });
  }
  return stats;
}

function nonNegative(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0;
}

/** This letter's tally, or a blank one for a letter never rated. */
export function statFor(
  card: CardRow,
  stats: ReadonlyMap<string, LetterStat>,
): LetterStat {
  return stats.get(letterKey(card)) ?? UNRATED;
}

/** True once the letter has been got right `LETTER_SOLID_STREAK` times running. */
export function isSolid(stat: LetterStat): boolean {
  return stat.streak >= LETTER_SOLID_STREAK;
}

/** How many of these letters are solid — the dashboard's "N of 30 solid". */
export function solidCount(
  cards: readonly CardRow[],
  stats: ReadonlyMap<string, LetterStat>,
): number {
  return cards.filter((card) => isSolid(statFor(card, stats))).length;
}

/** The letters that are not solid yet — what "Only the tricky ones" runs. */
export function trickyCards(
  cards: readonly CardRow[],
  stats: ReadonlyMap<string, LetterStat>,
): CardRow[] {
  return cards.filter((card) => !isSolid(statFor(card, stats)));
}

/** A random source in [0, 1). Injected so a run's order is testable. */
export type Rng = () => number;

/**
 * Which of the three groups a letter falls in. Lower sorts first.
 *
 *   0 — missed last time: rated, rated wrong at least once, and the streak is
 *       back at zero. These are the ones the run exists for.
 *   1 — never rated at all.
 *   2 — everything else, ordered by how long its run of right answers is.
 */
function group(stat: LetterStat): 0 | 1 | 2 {
  if (stat.easy + stat.hard === 0) return 1;
  if (stat.streak === 0 && stat.hard > 0) return 0;
  return 2;
}

export interface BuildRunArgs {
  /** Every letter card, in azbuka order. */
  cards: readonly CardRow[];
  stats: ReadonlyMap<string, LetterStat>;
  /** Narrow the run to the letters that are not solid yet. */
  trickyOnly?: boolean;
  /** Injected for deterministic tests; defaults to `Math.random`. */
  random?: Rng;
}

/**
 * The order one run presents the letters in.
 *
 * Shakiest first — the ones just missed, then the ones never seen, then the rest
 * by how well they are going — and shuffled inside each of those bands, so that
 * two runs in a row are not the same run twice. The shuffle is what stops the
 * drill teaching the *order* of the alphabet instead of the letters in it.
 *
 * The input is never mutated, and nothing is ever dropped: the returned array
 * holds every card it was given (or every not-yet-solid one, with `trickyOnly`).
 */
export function buildRun({
  cards,
  stats,
  trickyOnly = false,
  random = Math.random,
}: BuildRunArgs): CardRow[] {
  const pool = trickyOnly ? trickyCards(cards, stats) : [...cards];

  // Bucket by group, and inside group 2 by streak, so that a shuffle stays
  // *within* a band of equally-shaky letters and never across two.
  const buckets = new Map<string, CardRow[]>();
  for (const card of pool) {
    const stat = statFor(card, stats);
    const band = group(stat);
    const key = `${band}:${band === 2 ? stat.streak : 0}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(card);
    else buckets.set(key, [card]);
  }

  return [...buckets.keys()]
    .sort(compareBucketKeys)
    .flatMap((key) => shuffle(buckets.get(key) ?? [], random));
}

/** `"<group>:<streak>"` keys, both numbers ascending. */
function compareBucketKeys(a: string, b: string): number {
  const [aGroup, aStreak] = a.split(':').map(Number);
  const [bGroup, bStreak] = b.split(':').map(Number);
  return aGroup - bGroup || aStreak - bStreak;
}

/** Fisher–Yates over a copy. `random` is injected, so a test can pin the order. */
export function shuffle<T>(items: readonly T[], random: Rng = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** How a finished run is counted up. */
export interface RunTally {
  gotIt: number;
  notYet: number;
}

/**
 * The end-of-run line: "30 letters · 24 got it · 6 not yet".
 *
 * Plain English and no jargon, like every other word on these screens. The
 * totals are the *answers* given, which is the same as the letters shown —
 * nothing in this drill re-asks a card.
 */
export function runSummary({ gotIt, notYet }: RunTally): string {
  const total = Math.max(0, gotIt) + Math.max(0, notYet);
  return [
    `${total} ${total === 1 ? 'letter' : 'letters'}`,
    `${Math.max(0, gotIt)} got it`,
    `${Math.max(0, notYet)} not yet`,
  ].join(' · ');
}

// ---------------------------------------------------------------------------
// The rate_letter wire contract
// ---------------------------------------------------------------------------

/**
 * The name and arguments of `public.rate_letter`
 * (`supabase/migrations/20260904120000_letter_stats.sql`).
 *
 * Argument names here and in the SQL are one contract with no compiler across
 * it: rename one side and PostgREST answers 404 at runtime. `letters.test.ts`
 * parses the migration and compares, which is what stops that happening.
 */
export const RATE_LETTER_FN = 'rate_letter';

export interface RateLetterParams {
  p_letter: string;
  p_got_it: boolean;
}

/**
 * One rating as the function's arguments.
 *
 * Deliberately no `p_user_id`: the function fills `user_id` from `auth.uid()`,
 * so the id never travels on the wire and a client cannot ask to write somebody
 * else's tally. Deliberately no XP amount either — the function pays the review
 * tariff itself, in the same transaction, so a rating cannot count for the tally
 * and not for the day.
 */
export function rateLetterParams(letter: string, gotIt: boolean): RateLetterParams {
  return { p_letter: letter, p_got_it: gotIt };
}
