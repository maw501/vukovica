/**
 * The progression layer: which of the four stages the learner is in, how far
 * through it he is, and the one line the dashboard leads with.
 *
 * Everything here is pure — plain numbers and `drill_stats` rows in, a
 * `Progress` out. `api.getProgress` does the fetching; this file does the
 * deciding, so every boundary is unit-testable without a database.
 *
 * The stages are soft: nothing is ever locked. A stage only decides what the
 * dashboard emphasises and which goal it shows.
 */

import { CYRILLIC_ALPHABET } from '@/lib/drills';
import type { DrillStatRow } from '@/lib/types';

/** Alphabet → Words → Reading → Books, in order. */
export type Stage = 'alphabet' | 'words' | 'reading' | 'books';

/** Vuk's alphabet is the whole of the first stage: thirty letters, no more. */
export const LETTER_TOTAL = 30;

/** A letter needs this much evidence before mastery can be claimed at all. */
const MASTERY_MIN_ATTEMPTS = 8;

/** ...and this share of it correct. Both are inclusive floors. */
const MASTERY_MIN_ACCURACY = 0.9;

/** How many unmastered letters the trainer is pointed at. */
export const WEAKEST_LIMIT = 5;

/** The Words ladder: known words. */
export const KNOWN_MILESTONES = [100, 300, 600] as const;
export type KnownMilestone = (typeof KNOWN_MILESTONES)[number];

/** The Reading ladder: stories finished. */
export const STORY_MILESTONES = [1, 5, 20] as const;
export type StoryMilestone = (typeof STORY_MILESTONES)[number];

/** Reading becomes the primary stage at this many known words. */
const READING_KNOWN_WORDS = 100;

/** Books needs both of these. */
const BOOKS_KNOWN_WORDS = 300;
const BOOKS_STORIES = 5;

/**
 * The capstone goal, printed verbatim once the Books stage is reached. The
 * Cyrillic in it is the book's own title — content, not chrome.
 */
const BOOKS_GOAL = 'Read Погоди колико те волим to your son';

export interface LetterMastery {
  /** Letters of the alphabet meeting the mastery bar. 0..30. */
  mastered: number;
  total: typeof LETTER_TOTAL;
  /** Up to five unmastered letters, weakest first. Empty once all 30 are done. */
  weakest: string[];
}

export interface Progress {
  stage: Stage;
  letterMastery: LetterMastery;
  knownWords: number;
  knownMilestone: KnownMilestone;
  storiesRead: number;
  storyMilestone: StoryMilestone;
  /** `books` rows with a `finished_at`. Shown, but no stage turns on it yet. */
  booksFinished: number;
  /** One short line, rendered verbatim by the dashboard. */
  nextGoal: string;
}

export interface ProgressInputs {
  /** The user's lifetime per-letter drill counters. Order is irrelevant. */
  drillStats: readonly DrillStatRow[];
  /** `user_cards` rows in state 'review' — words graduated out of learning. */
  knownWords: number;
  /** `stories` rows with a `finished_at`. */
  storiesRead: number;
  /** `books` rows with a `finished_at`. */
  booksFinished: number;
}

/** One alphabet letter's lifetime record, folded out of the raw rows. */
interface LetterRecord {
  attempts: number;
  /** correct/attempts, clamped to 0..1. Zero for a letter never attempted — no
   * evidence is the weakest evidence there is, which is what `weakest` wants
   * and what keeps an untouched letter out of `mastered`. */
  accuracy: number;
}

/** A letter nobody has ever drilled. */
const UNATTEMPTED: LetterRecord = { attempts: 0, accuracy: 0 };

/**
 * Every letter of Vuk's alphabet with its lifetime record, in alphabet order.
 *
 * Rows for anything outside the thirty are dropped and the ratio is clamped to
 * 0..1, so nonsense in `drill_stats` (an unknown character, null counters, more
 * correct answers than attempts) cannot move the counts. Rows are summed rather
 * than last-wins: `drill_stats` is keyed by (user, letter) so a duplicate
 * should not happen, but adding is the only reading that stays right if one ever does.
 */
function letterRecords(stats: readonly DrillStatRow[]): Map<string, LetterRecord> {
  const records = new Map<string, LetterRecord>(
    CYRILLIC_ALPHABET.map((letter) => [letter, { attempts: 0, accuracy: 0 }]),
  );
  const correct = new Map<string, number>();

  for (const row of stats) {
    const record = records.get(row.letter);
    if (!record) continue;
    record.attempts += Math.max(0, row.attempts ?? 0);
    correct.set(row.letter, (correct.get(row.letter) ?? 0) + Math.max(0, row.correct ?? 0));
  }

  for (const [letter, record] of records) {
    if (record.attempts <= 0) continue;
    record.accuracy = Math.min(1, (correct.get(letter) ?? 0) / record.attempts);
  }
  return records;
}

/** Whether a letter's record clears both mastery bars. */
function isMastered({ attempts, accuracy }: LetterRecord): boolean {
  return attempts >= MASTERY_MIN_ATTEMPTS && accuracy >= MASTERY_MIN_ACCURACY;
}

/**
 * The alphabet letters the user has mastered — what the trainer marks in its
 * summary, and the numerator of the Alphabet goal.
 */
export function masteredLetters(stats: readonly DrillStatRow[]): Set<string> {
  const mastered = new Set<string>();
  for (const [letter, record] of letterRecords(stats)) {
    if (isMastered(record)) mastered.add(letter);
  }
  return mastered;
}

/**
 * The unmastered letters worth drilling next: weakest accuracy first, an
 * unattempted letter counting as zero. Ties keep Vuk's order, so the list is
 * stable between renders.
 */
function weakestLetters(records: ReadonlyMap<string, LetterRecord>): string[] {
  return CYRILLIC_ALPHABET
    // `letterRecords` keys every letter, so the fallback is only for the type.
    .map((letter, index) => ({ letter, index, record: records.get(letter) ?? UNATTEMPTED }))
    .filter(({ record }) => !isMastered(record))
    .sort((a, b) => a.record.accuracy - b.record.accuracy || a.index - b.index)
    .slice(0, WEAKEST_LIMIT)
    .map((entry) => entry.letter);
}

/**
 * The lowest rung of a ladder the count has not yet reached, or the top rung
 * once it has passed them all — the goal stops moving, it does not disappear.
 */
function nextRung<T extends number>(rungs: readonly T[], count: number): T {
  return rungs.find((rung) => count < rung) ?? rungs[rungs.length - 1];
}

/**
 * Which stage the dashboard leads with.
 *
 * Alphabet gates everything: it is the first stage and it runs "until all thirty
 * are mastered", so a learner with plenty of words but a shaky letter is still
 * sent back to the trainer. Above it, the highest satisfied stage wins.
 *
 * Books deliberately does *not* turn on `booksFinished`: it is the stage in
 * which he reads real books, so finishing one must not end it.
 */
function stageFor(masteredCount: number, knownWords: number, storiesRead: number): Stage {
  if (masteredCount < LETTER_TOTAL) return 'alphabet';
  if (knownWords >= BOOKS_KNOWN_WORDS && storiesRead >= BOOKS_STORIES) return 'books';
  if (knownWords >= READING_KNOWN_WORDS) return 'reading';
  return 'words';
}

/** "4 more letters" / "1 more letter". */
function pluralise(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The single line the dashboard renders under the stage name — English, like
 * every other piece of chrome in the app, so it is read at a glance while half
 * awake. The only Serbian that appears is a book's own title.
 */
function nextGoalFor(stage: Stage, progress: Omit<Progress, 'nextGoal'>): string {
  switch (stage) {
    case 'alphabet': {
      const { mastered, total } = progress.letterMastery;
      return `Alphabet — master ${pluralise(total - mastered, 'more letter', 'more letters')} (${mastered}/${total})`;
    }
    case 'words': {
      const target = progress.knownMilestone;
      const left = Math.max(0, target - progress.knownWords);
      return `Words — learn ${pluralise(left, 'more word', 'more words')} (${progress.knownWords}/${target})`;
    }
    case 'reading': {
      const target = progress.storyMilestone;
      const left = target - progress.storiesRead;
      // The story ladder can top out inside Reading — twenty stories read on a
      // vocabulary still short of 300 leaves the stage but not the ladder. Ask
      // for "0 more stories (25/20)" and the goal stops being a goal, so point
      // at what actually opens Books from here: the word count. The stage is
      // Reading exactly when known < 300, so this remainder is never zero.
      if (left <= 0) {
        const words = BOOKS_KNOWN_WORDS - progress.knownWords;
        return `Reading — ${pluralise(words, 'word', 'words')} to Books (${progress.knownWords}/${BOOKS_KNOWN_WORDS})`;
      }
      return `Reading — read ${pluralise(left, 'more story', 'more stories')} (${progress.storiesRead}/${target})`;
    }
    case 'books':
      // No ladder here: the goal is the book itself, and it does not change
      // when one is finished. Both ladders keep showing alongside it as
      // milestones, they are just not the headline any more.
      return BOOKS_GOAL;
  }
}

/**
 * Everything the dashboard needs to lead with the right stage and goal.
 *
 * Pure and total: no I/O, no clock, no throwing. Garbage in `drillStats`
 * (unknown letters, null counters, more correct than attempted) is absorbed
 * rather than propagated.
 */
export function computeProgress({
  drillStats,
  knownWords,
  storiesRead,
  booksFinished,
}: ProgressInputs): Progress {
  const records = letterRecords(drillStats);
  let mastered = 0;
  for (const record of records.values()) {
    if (isMastered(record)) mastered += 1;
  }

  const letterMastery: LetterMastery = {
    mastered,
    total: LETTER_TOTAL,
    weakest: weakestLetters(records),
  };

  const stage = stageFor(mastered, knownWords, storiesRead);
  const withoutGoal: Omit<Progress, 'nextGoal'> = {
    stage,
    letterMastery,
    knownWords,
    knownMilestone: nextRung(KNOWN_MILESTONES, knownWords),
    storiesRead,
    storyMilestone: nextRung(STORY_MILESTONES, storiesRead),
    booksFinished,
  };

  return { ...withoutGoal, nextGoal: nextGoalFor(stage, withoutGoal) };
}
