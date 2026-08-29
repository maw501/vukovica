/**
 * FSRS scheduling, wrapped so the rest of the app only ever sees our own row
 * shapes.
 *
 * All of the scheduling maths lives in the `ts-fsrs` package — we translate
 * between its `Card`/`State`/`Rating` vocabulary and the `user_cards` row we
 * persist, and nothing more. These functions are pure: no clock beyond the
 * `now` you pass in, no I/O, no Supabase.
 */

import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  type Card,
  type Grade,
} from 'ts-fsrs';

import type { CardState, ReviewLogInsert, UserCardRow } from '@/lib/types';

/** How the UI reports an answer: 1 = again, 2 = hard, 3 = good, 4 = easy. */
export type ReviewGrade = 1 | 2 | 3 | 4;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * One scheduler instance, stateless and safe to share across reviews. Fuzz is
 * off by default in `ts-fsrs`, so scheduling is deterministic and testable.
 *
 * The one parameter we override is the (re)learning ladder. FSRS tracks how
 * far a card has climbed its learning steps in `Card.learning_steps`, but
 * `user_cards` has no column for that index, so every row we load from the
 * database starts again at step 0. With the default two-step ladder
 * (`['1m', '10m']`) that is a trap: a good answer moves the card from step 0
 * to step 1 and back to step 0 on the next load, so the card loops inside
 * `learning` forever and its stability never grows. A single step has no index
 * to lose — a good answer always graduates — while still giving a lapsed or
 * failed card one short-term retry a few minutes later. If `user_cards` ever
 * gains a `learning_steps` column, this override can go.
 */
const scheduler = fsrs({
  learning_steps: ['10m'],
  relearning_steps: ['10m'],
});

const TO_FSRS_STATE: Record<CardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const FROM_FSRS_STATE: Record<State, CardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const TO_RATING: Record<ReviewGrade, Grade> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

/**
 * Days since the card was last seen, as a fraction (the `review_logs`
 * `elapsed_days` column is a float8). A card that has never been reviewed has
 * elapsed zero days.
 */
function elapsedDays(row: UserCardRow, now: Date): number {
  if (!row.last_review) return 0;
  return (now.getTime() - new Date(row.last_review).getTime()) / MS_PER_DAY;
}

/**
 * Our row as an FSRS card. We start from `createEmptyCard` so that fields we
 * do not persist (`scheduled_days`, `learning_steps`) get the library's own
 * defaults rather than a value invented here — and so that a future field
 * added by the library does not arrive undefined.
 *
 * `elapsed_days` is recomputed by the scheduler from `last_review`, so the
 * value we pass in is only a courtesy.
 */
function toFsrsCard(row: UserCardRow, now: Date): Card {
  return {
    ...createEmptyCard(now),
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: elapsedDays(row, now),
    reps: row.reps,
    lapses: row.lapses,
    state: TO_FSRS_STATE[row.state],
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

/**
 * Schedule `row` after the user answered it with `grade` at `now`.
 *
 * Returns the row to persist (same `user_id`/`card_id`, everything else
 * rescheduled, `last_review` stamped with `now`) plus the `review_logs` insert
 * describing what happened. Neither the input row nor any global state is
 * mutated.
 */
export function gradeCard(
  row: UserCardRow,
  grade: ReviewGrade,
  now: Date = new Date(),
): { next: UserCardRow; log: ReviewLogInsert } {
  const { card } = scheduler.next(toFsrsCard(row, now), now, TO_RATING[grade]);

  const next: UserCardRow = {
    user_id: row.user_id,
    card_id: row.card_id,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: FROM_FSRS_STATE[card.state],
    last_review: now.toISOString(),
  };

  const log: ReviewLogInsert = {
    user_id: row.user_id,
    card_id: row.card_id,
    grade,
    state_before: row.state,
    state_after: next.state,
    elapsed_days: elapsedDays(row, now),
  };

  return { next, log };
}
