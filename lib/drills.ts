/**
 * The Cyrillic typing trainer's brain.
 *
 * Everything here is pure and synchronous: which words a round is built from,
 * how an answer is marked letter by letter, what a keyboard's worth of Latin
 * keystrokes means in Cyrillic, and how a round's marks add up into the
 * per-letter counters the next round is biased by. The screen holds the state;
 * this file holds the decisions.
 *
 * The unit of learning is the *Cyrillic letter*, in both drill directions. A
 * miss in the Latin direction ("zena" for "žena") has to be recorded against ж,
 * not against some Latin "z" the deck has no notion of — which is what
 * `segmentExpected` exists for.
 */

import { latToCyr } from '@/lib/transliterate';
import type { CardRow, DrillStatRow } from '@/lib/types';

/** Vuk's alphabet, in order. The trainer's whole universe of letters. */
export const CYRILLIC_ALPHABET: readonly string[] = [
  'а', 'б', 'в', 'г', 'д', 'ђ', 'е', 'ж', 'з', 'и',
  'ј', 'к', 'л', 'љ', 'м', 'н', 'њ', 'о', 'п', 'р',
  'с', 'т', 'ћ', 'у', 'ф', 'х', 'ц', 'ч', 'џ', 'ш',
];

const CYRILLIC_LETTERS = new Set(CYRILLIC_ALPHABET);

/**
 * The letters a plain (QWERTY, no Serbian layout) keyboard cannot produce even
 * through `cyrillicInput`, because their Latin spelling is a digraph or carries
 * a diacritic. These get on-screen keys in the Lat→Cyr drill.
 */
export const KEYBOARD_ONLY_CYRILLIC: readonly string[] = [
  'ђ', 'ж', 'љ', 'њ', 'ћ', 'ч', 'џ', 'ш',
];

/** The same problem in the other direction: Latin letters with diacritics. */
export const LATIN_ACCENTS: readonly string[] = ['č', 'ć', 'đ', 'š', 'ž'];

/** True for a Serbian Cyrillic letter (lower case; the caller folds case). */
function isCyrillicLetter(char: string): boolean {
  return CYRILLIC_LETTERS.has(char);
}

// ---------------------------------------------------------------------------
// Choosing a round's words
// ---------------------------------------------------------------------------

/** How often a letter has been typed right, as a fraction of attempts. */
function accuracyByLetter(stats: readonly DrillStatRow[]): Map<string, number> {
  const accuracy = new Map<string, number>();
  for (const row of stats) {
    const attempts = row.attempts ?? 0;
    if (attempts <= 0) continue; // no evidence: leave it "weakest" (see below)
    const correct = row.correct ?? 0;
    // A row claiming more correct answers than attempts is nonsense; clamping
    // beats letting it drive a negative weight.
    accuracy.set(row.letter, Math.min(1, Math.max(0, correct / attempts)));
  }
  return accuracy;
}

/** The distinct Serbian Cyrillic letters of a word, lower-cased. */
function lettersOf(word: string): string[] {
  const seen = new Set<string>();
  for (const char of word.toLowerCase()) {
    if (isCyrillicLetter(char)) seen.add(char);
  }
  return [...seen];
}

/**
 * How much practice a word promises: the sum of `1 - accuracy` over its
 * *distinct* letters.
 *
 * Distinct, so "ааааа" is not five times the practice of "а". A letter with no
 * stats row contributes a full 1 — never having typed it is the weakest a
 * letter can be, and it is exactly what the drill should be reaching for.
 */
function weightOf(word: string, accuracy: ReadonlyMap<string, number>): number {
  return lettersOf(word).reduce((total, letter) => total + (1 - (accuracy.get(letter) ?? 0)), 0);
}

/**
 * Cards eligible for a typing drill: one word only (a phrase is a typing test,
 * not a spelling drill) and at least one Serbian letter to be marked on.
 */
function isDrillable(card: CardRow): boolean {
  return !/\s/.test(card.sr_cyr.trim()) && lettersOf(card.sr_cyr).length > 0;
}

/**
 * `n` words for a round, chosen at random but weighted towards the user's
 * weakest letters.
 *
 * Weighted, not sorted: always drilling the single worst word would be a
 * treadmill, and a letter only improves by being met in different words. Every
 * eligible card keeps a non-zero chance unless its letters are *all* perfect —
 * and if every weight is zero (a user who has never got anything wrong) the
 * choice falls back to uniform rather than returning nothing.
 *
 * `rng` is a test seam. The brief's signature is the three-argument one; the
 * fourth exists so the bias can be asserted against a seeded generator instead
 * of a statistical hope.
 */
export function pickDrillWords(
  cards: CardRow[],
  stats: DrillStatRow[],
  n: number,
  rng: () => number = Math.random,
): CardRow[] {
  if (n <= 0) return [];

  const accuracy = accuracyByLetter(stats);
  const pool = cards.filter(isDrillable);
  const weights = pool.map((card) => weightOf(card.sr_cyr, accuracy));

  const picked: CardRow[] = [];
  const count = Math.min(n, pool.length);

  while (picked.length < count) {
    let total = 0;
    for (const weight of weights) total += weight;

    // Every remaining word is mastered (or the pool is one perfect word): pick
    // uniformly rather than stalling.
    let index = 0;
    if (total <= 0) {
      index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    } else {
      let target = rng() * total;
      for (index = 0; index < pool.length - 1; index += 1) {
        target -= weights[index];
        if (target < 0) break;
      }
    }

    picked.push(pool[index]);
    // Swap-remove: sampling without replacement, and no O(n) splice.
    pool[index] = pool[pool.length - 1];
    weights[index] = weights[weights.length - 1];
    pool.pop();
    weights.pop();
  }

  return picked;
}

// ---------------------------------------------------------------------------
// Marking an answer
// ---------------------------------------------------------------------------

/** One piece of the expected answer, and the Cyrillic letter it stands for. */
export interface ExpectedSegment {
  /** The Cyrillic letter, or null for a space, hyphen or anything else. */
  letter: string | null;
  /** How that letter is written in the expected answer ("ж", "ž", "dž"…). */
  text: string;
}

/** Longest Latin letter ("lj", "nj", "dž"). */
const MAX_LATIN_LETTER = 2;

/**
 * Split an expected answer into one segment per letter.
 *
 * Cyrillic input is one segment per character. Latin input is walked
 * longest-match-first so a digraph stays the single letter it spells: "džep" is
 * џ-е-п, three letters, not four.
 *
 * Known limit, inherited from `latToCyr` itself: a genuine д+ж sequence (as in
 * "nadživeti") reads back as џ. No word in the deck contains one, and the
 * ambiguity is in the transliteration standard, not here.
 */
export function segmentExpected(expected: string): ExpectedSegment[] {
  const text = expected.normalize('NFC');
  const segments: ExpectedSegment[] = [];

  for (let i = 0; i < text.length; ) {
    const lower = text[i].toLowerCase();

    if (isCyrillicLetter(lower)) {
      segments.push({ letter: lower, text: text[i] });
      i += 1;
      continue;
    }

    let matched = false;
    for (let length = MAX_LATIN_LETTER; length >= 1; length -= 1) {
      const slice = text.slice(i, i + length);
      if (slice.length < length) continue;
      const cyr = latToCyr(slice.toLowerCase());
      if (cyr.length !== 1 || !isCyrillicLetter(cyr)) continue;
      segments.push({ letter: cyr, text: slice });
      i += length;
      matched = true;
      break;
    }

    if (!matched) {
      segments.push({ letter: null, text: text[i] });
      i += 1;
    }
  }

  return segments;
}

/** One Cyrillic letter of the expected answer, and whether it was typed right. */
export interface LetterResult {
  letter: string;
  correct: boolean;
}

export interface AttemptScore {
  /** True only for an exact answer (case and surrounding space forgiven). */
  correct: boolean;
  /** One entry per Cyrillic letter of the expected answer, in order. */
  perLetter: LetterResult[];
}

/** Trim, fold case, and compose diacritics so "ž" typed as z+caron still matches. */
function normalise(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

/**
 * A hair of cost per character of length mismatch, so that among alignments
 * with equally many wrong letters the one that consumes what it should wins.
 * Small enough that it can never outweigh a single wrong letter.
 */
const LENGTH_BIAS = 1e-3;

/**
 * Which segments were typed correctly, allowing for inserted and dropped
 * characters.
 *
 * Position-by-position comparison would be wrong in the way that matters most:
 * one dropped letter shifts everything after it, so "маа" for "мама" would mark
 * three letters wrong instead of one and the stats would blame letters the user
 * types perfectly well. This is a small edit-distance alignment instead — each
 * segment may consume a few characters or none, minimising the number of
 * segments marked wrong.
 */
function alignSegments(segments: ExpectedSegment[], actual: string): boolean[] {
  const m = segments.length;
  const n = actual.length;

  const cost: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  /** How many characters segment i consumed on the best path to (i+1, j). */
  const took: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(-1));

  cost[0][0] = 0;

  for (let i = 0; i < m; i += 1) {
    const wanted = segments[i].text.toLowerCase();
    const last = i === m - 1;

    for (let j = 0; j <= n; j += 1) {
      if (cost[i][j] === Infinity) continue;
      // The final segment may swallow whatever is left, so the whole answer is
      // always accounted for however much extra was typed.
      const maxTake = last ? n - j : Math.min(wanted.length + 2, n - j);

      for (let take = 0; take <= maxTake; take += 1) {
        const slice = actual.slice(j, j + take);
        const step =
          (slice === wanted ? 0 : 1) + Math.abs(take - wanted.length) * LENGTH_BIAS;
        const candidate = cost[i][j] + step;
        if (candidate < cost[i + 1][j + take]) {
          cost[i + 1][j + take] = candidate;
          took[i + 1][j + take] = take;
        }
      }
    }
  }

  const correct = new Array<boolean>(m).fill(false);
  let j = n;
  for (let i = m; i > 0; i -= 1) {
    const take = took[i][j];
    if (take < 0) break; // unreachable in practice; leave the rest marked wrong
    correct[i - 1] = actual.slice(j - take, j) === segments[i - 1].text.toLowerCase();
    j -= take;
  }

  return correct;
}

/**
 * Mark one typed answer.
 *
 * `expected` may be in either script — the Cyrillic headword (Lat→Cyr drill) or
 * its Latin transliteration (Cyr→Lat drill) — and either way the result is
 * reported per *Cyrillic* letter, because that is what `drill_stats` counts and
 * what the user is actually learning.
 */
export function scoreAttempt(expected: string, actual: string): AttemptScore {
  const segments = segmentExpected(normalise(expected));
  const typed = normalise(actual);
  const marks = alignSegments(segments, typed);

  const perLetter: LetterResult[] = [];
  segments.forEach((segment, index) => {
    if (segment.letter === null) return;
    perLetter.push({ letter: segment.letter, correct: marks[index] });
  });

  return {
    // Exact match is the bar for "you got it right"; the per-letter marks are
    // for the stats, and an alignment that scores every letter can still have
    // left something unaccounted for at the edges.
    correct: segments.map((segment) => segment.text).join('').toLowerCase() === typed,
    perLetter,
  };
}

// ---------------------------------------------------------------------------
// Typing Cyrillic on a keyboard that has none
// ---------------------------------------------------------------------------

/**
 * The digraphs, as they arrive when typed a key at a time: the first letter has
 * already been converted to Cyrillic by the time the second key is pressed.
 */
const CYRILLIC_DIGRAPHS: Readonly<Record<string, string>> = {
  'лј': 'љ',
  'нј': 'њ',
  'дж': 'џ',
};

const DIGRAPH_PATTERN = new RegExp(Object.keys(CYRILLIC_DIGRAPHS).join('|'), 'gi');

/**
 * What the user meant, in Cyrillic, given whatever they managed to type.
 *
 * Latin runs are transliterated (`mama` → `мама`) and Cyrillic passes straight
 * through, so the on-screen letter keys and the physical keyboard can be mixed
 * freely. The digraph fold is the part `latToCyr` cannot do alone: typing "lj"
 * one key at a time produces "л" and then "j", never the "lj" that would have
 * become љ.
 *
 * "dz" deliberately stays "дз". Typing it for џ is precisely the mistake the
 * drill exists to catch, so silently correcting it would hide the lesson.
 */
export function cyrillicInput(text: string): string {
  const converted = latToCyr(text.normalize('NFC'));
  return converted.replace(DIGRAPH_PATTERN, (pair) => {
    const merged = CYRILLIC_DIGRAPHS[pair.toLowerCase()];
    if (!merged) return pair;
    return pair[0] === pair[0].toUpperCase() ? merged.toUpperCase() : merged;
  });
}

// ---------------------------------------------------------------------------
// Adding a round up
// ---------------------------------------------------------------------------

/** What one round adds to one letter's counters. */
export interface LetterDelta {
  letter: string;
  attempts: number;
  correct: number;
}

/**
 * A round's marks as one delta per distinct letter, alphabetically.
 *
 * Distinct is not a nicety: `bump_drill_stats` upserts, and `on conflict do
 * update` refuses to touch the same row twice in one statement, so a duplicated
 * letter would abort the whole write.
 */
export function tallyAttempts(attempts: LetterResult[][]): LetterDelta[] {
  const totals = new Map<string, LetterDelta>();

  for (const result of attempts) {
    for (const { letter, correct } of result) {
      const entry = totals.get(letter) ?? { letter, attempts: 0, correct: 0 };
      entry.attempts += 1;
      if (correct) entry.correct += 1;
      totals.set(letter, entry);
    }
  }

  return [...totals.values()].sort((a, b) => a.letter.localeCompare(b.letter, 'sr'));
}

/** Anything carrying per-letter counters: a `drill_stats` row or a round's delta. */
export interface LetterCounts {
  letter: string;
  attempts: number | null;
  correct: number | null;
}

/**
 * Fold the rows `bump_drill_stats` returned back into the cached stats.
 *
 * The function answers with the *new totals* for the letters it touched, which
 * is exactly what the cache needs — merging them beats refetching all thirty
 * rows after every word, and it cannot disagree with the database.
 */
export function mergeDrillStats<Row extends LetterCounts>(
  current: readonly Row[],
  updated: readonly Row[],
): Row[] {
  const byLetter = new Map(current.map((row) => [row.letter, row]));
  for (const row of updated) byLetter.set(row.letter, row);
  return [...byLetter.values()];
}

/**
 * The letters most often typed wrong, worst first — the round summary's "these
 * are the ones to look at".
 *
 * Letters with no attempts are left out: unlike the word-picking weight, where
 * "never tried" is a reason to reach for a word, a summary claiming you are bad
 * at a letter you have never met would be a lie.
 */
export function weakestLetters(stats: readonly LetterCounts[], limit: number): string[] {
  return stats
    .map((row) => ({
      letter: row.letter,
      attempts: row.attempts ?? 0,
      accuracy: (row.correct ?? 0) / (row.attempts ?? 0),
    }))
    .filter((row) => row.attempts > 0 && row.accuracy < 1)
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts || a.letter.localeCompare(b.letter, 'sr'))
    .slice(0, Math.max(0, limit))
    .map((row) => row.letter);
}

// ---------------------------------------------------------------------------
// The bump_drill_stats wire contract
// ---------------------------------------------------------------------------

/**
 * The name and arguments of `public.bump_drill_stats`
 * (`supabase/migrations/20260830130000_bump_drill_stats.sql`).
 *
 * Argument names here and in the SQL are one contract with no compiler across
 * it: rename one side and PostgREST answers 404 at runtime. `drills.test.ts`
 * parses the migration and compares, which is what stops that happening.
 */
export const BUMP_DRILL_STATS_FN = 'bump_drill_stats';

export interface BumpDrillStatsParams {
  p_letters: string[];
  p_attempts: number[];
  p_correct: number[];
}

/**
 * A round's deltas as the function's three parallel arrays.
 *
 * Deliberately no `p_user_id`: the function fills `user_id` from `auth.uid()`,
 * so the id never travels on the wire and a client cannot ask to write somebody
 * else's counters.
 */
export function bumpDrillStatsParams(deltas: readonly LetterDelta[]): BumpDrillStatsParams {
  return {
    p_letters: deltas.map((delta) => delta.letter),
    p_attempts: deltas.map((delta) => delta.attempts),
    p_correct: deltas.map((delta) => delta.correct),
  };
}
