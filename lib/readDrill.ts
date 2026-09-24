/**
 * The "Read it" drill: which words a run contains, in what order, and how a
 * reading is written down.
 *
 * The letters drill taught Mark the thirty shapes one at a time; this is the
 * same exercise one level up. A card shows a word in Cyrillic and nothing else —
 * no Latin, no English — to be read out loud and translated from memory, then
 * turned over to check. What is being practised is *reading*, which is why the
 * word may well be one he already knows in speech, and why this has a tally of
 * its own rather than a place in the review queue.
 *
 * There is no scheduling here, deliberately, for the reason the letters have
 * none: a word is never unavailable to practise. What the tallies in
 * `read_stats` buy is *order* — the words just missed come first — and a "solid"
 * count once one has been read right three times running. Neither can withhold a
 * card. The one thing that is capped is how long a sitting is: the deck runs to
 * hundreds of words per theme, so a run is `READ_RUN_SIZE` of them and "Keep
 * going" builds the next one from what is left.
 *
 * Practise's "Meaning" is this same drill the other way round (`DrillWay`):
 * the English on the face, the Serbian said out loud, then checked. It used to
 * be the flashcard queue over one set, until Mark asked to drill every word
 * with no waiting — so it runs here, on its own tally, under the same rule that
 * nothing can withhold a card.
 *
 * Pure and dependency-free, like `lib/letters.ts` and `lib/library.ts`: `api.ts`
 * reaches `lib/supabase.ts` (and therefore `react-native`), which the Node-based
 * vitest environment cannot load, so everything the drill decides is decided
 * here, over rows the caller has already fetched.
 */

import { domainLabel } from "@/lib/domains";
// The shuffle is the letters drill's, taken rather than copied: it is a plain
// Fisher–Yates over a copy with an injected random source, and two of them would
// be two things to keep right. Nothing else crosses between the two drills.
import { shuffle, type Rng } from "@/lib/letters";
import type { CardRow, ReadStatRow } from "@/lib/types";
import { QUICK_ADD_DOMAIN } from "@/lib/quickAdd";

/**
 * Read right this many times in a row and the word is solid: a count on the
 * theme picker, and the last band a run puts a word in.
 *
 * Three, the same bar the letters drill sets, and for the same reason: this is
 * the *recognition* bar — reading the shapes and knowing what they say — not a
 * claim that the word is known for good. That claim is the review queue's, and
 * "I already know this" is how it gets made.
 */
export const READ_SOLID_STREAK = 3;

/**
 * How many words one run holds.
 *
 * The letters drill can offer the whole alphabet because the alphabet is thirty
 * cards. A theme is anything from a dozen words to a hundred and two, and a run
 * with no end in sight is one nobody finishes — so a sitting is twenty, the
 * summary comes up, and "Keep going" starts the next twenty from what has not
 * been seen yet. Nothing is withheld; the stopping point is just offered.
 */
export const READ_RUN_SIZE = 20;

/**
 * Which way round a run goes, and so which tally it reads and writes.
 *
 *   read    — Read aloud: the Cyrillic on the face; say it, then check.
 *   meaning — Meaning: the English on the face; say the Serbian, then check.
 *
 * One screen and one ordering rule for both, because they are the same drill
 * mirrored. They keep separate tallies (`read_stats.way`) because they are not
 * the same skill: reading a word off the page three times running says nothing
 * about producing it from the English, and a shared streak would call a word
 * solid in a drill he has never done.
 */
export type DrillWay = "read" | "meaning";

/** A `?way=` param as the run screen receives it. Anything else is Read aloud. */
export function parseDrillWay(
  value: string | string[] | undefined,
): DrillWay {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() === "meaning" ? "meaning" : "read";
}

/** The pseudo-theme that means "the words I already know", not a `cards.domain`. */
export const MINE_THEME = "mine";

/** What "My words" is called on screen. */
const MINE_LABEL = "My words";

/** One word's tally, as everything below needs it. */
export interface ReadStat {
  /** Times read correctly. */
  easy: number;
  /** Times not. */
  hard: number;
  /** Consecutive "Got it"s: +1 on got it, back to 0 on not yet. */
  streak: number;
}

/** A word nobody has read in this drill yet. */
export const UNRATED_READ: ReadStat = { easy: 0, hard: 0, streak: 0 };

/**
 * One way's tally rows as a lookup, keyed by `cards.id`, with nulls and
 * negatives absorbed.
 *
 * `read_stats` is keyed by (user, card, way), so within one way duplicates
 * cannot happen. The other way's rows are skipped, which is what keeps a good
 * reading streak from reordering a Meaning run. A row with no `way` is a
 * reading, as the column's default says. The counts are nullable in the row
 * type (a `select` can return null for any of them) and a total function is one
 * less thing for the screen to think about.
 */
export function statsByCard(
  rows: readonly ReadStatRow[],
  way: DrillWay = "read",
): Map<string, ReadStat> {
  const stats = new Map<string, ReadStat>();
  for (const row of rows) {
    if (!row.card_id) continue;
    if ((row.way ?? "read") !== way) continue;
    stats.set(row.card_id, {
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

/** This word's tally, or a blank one for a word never read here. */
export function statFor(
  card: CardRow,
  stats: ReadonlyMap<string, ReadStat>,
): ReadStat {
  return stats.get(card.id) ?? UNRATED_READ;
}

/** True once the word has been read right `READ_SOLID_STREAK` times running. */
export function isSolid(stat: ReadStat): boolean {
  return stat.streak >= READ_SOLID_STREAK;
}

/** How many of these words are solid — the picker's "60 words · 12 solid". */
export function solidCount(
  cards: readonly CardRow[],
  stats: ReadonlyMap<string, ReadStat>,
): number {
  return cards.filter((card) => isSolid(statFor(card, stats))).length;
}

/**
 * Which of the three groups a word falls in. Lower sorts first.
 *
 *   0 — missed last time: read at least once, got wrong at least once, and the
 *       streak is back at zero. These are the ones the run exists for.
 *   1 — never read in this drill at all.
 *   2 — everything else, ordered by how long its run of right answers is.
 */
function group(stat: ReadStat): 0 | 1 | 2 {
  if (stat.easy + stat.hard === 0) return 1;
  if (stat.streak === 0 && stat.hard > 0) return 0;
  return 2;
}

export interface BuildRunArgs {
  /** Every word in the chosen theme. */
  cards: readonly CardRow[];
  stats: ReadonlyMap<string, ReadStat>;
  /**
   * Card ids already answered in this sitting. Left out, so "Keep going" is a
   * fresh twenty rather than the same twenty again.
   */
  seen?: ReadonlySet<string>;
  /** How many words this run holds. Defaults to `READ_RUN_SIZE`. */
  size?: number;
  /** Injected for deterministic tests; defaults to `Math.random`. */
  random?: Rng;
}

/**
 * The order one run presents the words in, and where it stops.
 *
 * Shakiest first — the ones just missed, then the ones never read, then the rest
 * by how well they are going — and shuffled inside each of those bands, so two
 * runs in a row are not the same run twice. The same ordering as the letters
 * drill's `buildRun`, over cards rather than letter pairs.
 *
 * The input is never mutated. Unlike the letters drill nothing here claims to
 * return every card it was given: the run is capped, and what is left over is
 * what the next run is built from.
 */
export function buildRun({
  cards,
  stats,
  seen,
  size = READ_RUN_SIZE,
  random = Math.random,
}: BuildRunArgs): CardRow[] {
  const pool = remainingCards(cards, seen);

  // Bucket by group, and inside group 2 by streak, so that a shuffle stays
  // *within* a band of equally-shaky words and never across two.
  const buckets = new Map<string, CardRow[]>();
  for (const card of pool) {
    const stat = statFor(card, stats);
    const band = group(stat);
    const key = `${band}:${band === 2 ? stat.streak : 0}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(card);
    else buckets.set(key, [card]);
  }

  const ordered = [...buckets.keys()]
    .sort(compareBucketKeys)
    .flatMap((key) => shuffle(buckets.get(key) ?? [], random));

  return ordered.slice(0, size);
}

/** `"<group>:<streak>"` keys, both numbers ascending. */
function compareBucketKeys(a: string, b: string): number {
  const [aGroup, aStreak] = a.split(":").map(Number);
  const [bGroup, bStreak] = b.split(":").map(Number);
  return aGroup - bGroup || aStreak - bStreak;
}

/** The words of a theme that this sitting has not reached yet. */
function remainingCards(
  cards: readonly CardRow[],
  seen: ReadonlySet<string> = new Set(),
): CardRow[] {
  return cards.filter((card) => !seen.has(card.id));
}

/** How many words are left for a "Keep going" to run. */
export function remainingCount(
  cards: readonly CardRow[],
  seen: ReadonlySet<string> = new Set(),
): number {
  return remainingCards(cards, seen).length;
}

/** How a finished run is counted up. */
export interface RunTally {
  gotIt: number;
  notYet: number;
}

/**
 * The end-of-run line: "20 words · 16 got it · 4 not yet".
 *
 * Plain English and no jargon, like every other word on these screens. The
 * totals are the *answers* given, which is the same as the words shown —
 * nothing in this drill re-asks a card.
 */
export function runSummary({ gotIt, notYet }: RunTally): string {
  const total = Math.max(0, gotIt) + Math.max(0, notYet);
  return [
    `${total} ${total === 1 ? "word" : "words"}`,
    `${Math.max(0, gotIt)} got it`,
    `${Math.max(0, notYet)} not yet`,
  ].join(" · ");
}

// ---------------------------------------------------------------------------
// The theme picker
// ---------------------------------------------------------------------------

/** One row of the picker: a theme, how big it is, and how much of it is solid. */
export interface Theme {
  /** A `cards.domain`, or `MINE_THEME` for the words he already knows. */
  domain: string;
  label: string;
  total: number;
  solid: number;
}

/**
 * The picker's rows: "My words" first, then every domain the deck actually has.
 *
 * Driven by the cards rather than by `DOMAIN_LABELS`, deliberately. Content is
 * written between sessions and arrives as rows, so a theme appears here the day
 * its first card lands — under its proper name if it has one and a tidied
 * version of its slug if it does not — and a domain that has been emptied stops
 * being offered without anyone editing a list.
 *
 * "My words" is offered even when it is empty: it is the one theme Mark builds
 * himself, and a row saying there is nothing in it yet is more use than no row
 * at all. The domains are sorted by name, which is the only order that stays put
 * as the deck grows.
 */
export function buildThemes({
  cards,
  stats,
  knownIds = new Set<string>(),
}: {
  /** Every word card in the deck. */
  cards: readonly CardRow[];
  stats: ReadonlyMap<string, ReadStat>;
  /** The ids of the words he knows — `user_cards.state = 'review'`. */
  knownIds?: ReadonlySet<string>;
}): Theme[] {
  const byDomain = new Map<string, CardRow[]>();
  const mine: CardRow[] = [];

  for (const card of cards) {
    if (knownIds.has(card.id)) mine.push(card);

    const domain = domainOf(card);
    // Quick-added words are filed under `my-words` and are known by
    // construction, so they are already in the "My words" theme above. Offering
    // the domain as well would list "My words" twice with different counts.
    if (!domain || domain === QUICK_ADD_DOMAIN) continue;
    const bucket = byDomain.get(domain);
    if (bucket) bucket.push(card);
    else byDomain.set(domain, [card]);
  }

  const themes = [...byDomain.entries()]
    .map(([domain, group]) => ({
      domain,
      label: domainLabel(domain),
      total: group.length,
      solid: solidCount(group, stats),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    {
      domain: MINE_THEME,
      label: MINE_LABEL,
      total: mine.length,
      solid: solidCount(mine, stats),
    },
    ...themes,
  ];
}

/** The words one theme runs. `MINE_THEME` is the known ones, not a domain. */
export function themeCards({
  theme,
  cards,
  knownIds = new Set<string>(),
}: {
  theme: string;
  cards: readonly CardRow[];
  knownIds?: ReadonlySet<string>;
}): CardRow[] {
  if (theme === MINE_THEME)
    return cards.filter((card) => knownIds.has(card.id));
  const wanted = theme.trim();
  return cards.filter((card) => domainOf(card) === wanted);
}

/**
 * A card's domain as both the picker and the run read it.
 *
 * One rule rather than two: `buildThemes` used to trim and `themeCards` used to
 * compare the raw column, so a row stored as `"family "` would have been offered
 * as a theme with a count and then opened an empty run. `trimCardInput` makes
 * that theoretical today, which is exactly when it is cheap to make impossible.
 */
function domainOf(card: CardRow): string {
  return card.domain?.trim() ?? "";
}

/** A theme's name for the top of the drill. */
export function themeLabel(theme: string): string {
  return theme === MINE_THEME ? MINE_LABEL : domainLabel(theme);
}

// ---------------------------------------------------------------------------
// The rate_read wire contract
// ---------------------------------------------------------------------------

/**
 * The name and arguments of `public.rate_read`
 * (`supabase/migrations/20260924120000_read_stats_way.sql`, which recreated
 * 20260918160000_read_stats.sql's function with `p_way` added).
 *
 * Argument names here and in the SQL are one contract with no compiler across
 * it: rename one side and PostgREST answers 404 at runtime. `readDrill.test.ts`
 * parses the migration and compares, which is what stops that happening.
 */
export const RATE_READ_FN = "rate_read";

export interface RateReadParams {
  p_card_id: string;
  p_got_it: boolean;
  /**
   * Always sent, although the SQL defaults it to 'read': a Meaning answer that
   * leaned on the default would quietly land in the reading tally.
   */
  p_way: DrillWay;
}

/**
 * One reading as the function's arguments.
 *
 * Deliberately no `p_user_id`: the function fills `user_id` from `auth.uid()`,
 * so the id never travels on the wire and a client cannot ask to write somebody
 * else's tally. Deliberately no XP amount either — the function pays the review
 * tariff itself, in the same transaction, so a reading cannot count for the
 * tally and not for the day.
 */
export function rateReadParams(
  cardId: string,
  gotIt: boolean,
  way: DrillWay,
): RateReadParams {
  return { p_card_id: cardId, p_got_it: gotIt, p_way: way };
}
