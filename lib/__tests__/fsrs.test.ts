import { describe, expect, it } from 'vitest';

import { gradeCard } from '@/lib/fsrs';
import type { UserCardRow } from '@/lib/types';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const CARD_ID = '22222222-2222-2222-2222-222222222222';

/** A fixed "now" so every assertion below is deterministic. */
const NOW = new Date('2026-08-29T12:00:00.000Z');

/** A brand-new, never-reviewed card, exactly as the database defaults it. */
function newCard(overrides: Partial<UserCardRow> = {}): UserCardRow {
  return {
    user_id: USER_ID,
    card_id: CARD_ID,
    due: NOW.toISOString(),
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: 'new',
    last_review: null,
    ...overrides,
  };
}

/** A matured card in `review`, last seen ten days ago and due today. */
function reviewCard(overrides: Partial<UserCardRow> = {}): UserCardRow {
  return {
    user_id: USER_ID,
    card_id: CARD_ID,
    due: NOW.toISOString(),
    stability: 10,
    difficulty: 5,
    reps: 4,
    lapses: 0,
    state: 'review',
    last_review: new Date('2026-08-19T12:00:00.000Z').toISOString(),
    ...overrides,
  };
}

describe('gradeCard', () => {
  it('moves a new card out of `new` and schedules it in the future on Good', () => {
    const { next } = gradeCard(newCard(), 3, NOW);

    expect(next.state).not.toBe('new');
    expect(['learning', 'review', 'relearning']).toContain(next.state);
    expect(new Date(next.due).getTime()).toBeGreaterThan(NOW.getTime());
    expect(next.reps).toBe(1);
  });

  it('records the review time and keeps the row identity on a new card', () => {
    const { next } = gradeCard(newCard(), 3, NOW);

    expect(next.user_id).toBe(USER_ID);
    expect(next.card_id).toBe(CARD_ID);
    expect(next.last_review).toBe(NOW.toISOString());
  });

  it('gives a new card real stability and difficulty', () => {
    const { next } = gradeCard(newCard(), 3, NOW);

    expect(next.stability).toBeGreaterThan(0);
    expect(next.difficulty).toBeGreaterThan(0);
  });

  /**
   * `user_cards` has no column for the FSRS (re)learning step index, so every
   * row we load starts again at step 0. Scheduling must therefore graduate a
   * card on a good answer without depending on that index — otherwise a card
   * loops inside `learning` forever and its stability never grows.
   */
  it('graduates a learning card to `review` on Good', () => {
    const learning = newCard({
      state: 'learning',
      stability: 2.31,
      difficulty: 2.12,
      reps: 1,
      last_review: new Date('2026-08-29T11:50:00.000Z').toISOString(),
    });

    const { next } = gradeCard(learning, 3, NOW);

    expect(next.state).toBe('review');
  });

  it('graduates a relearning card back to `review` on Good', () => {
    const relearning = reviewCard({
      state: 'relearning',
      stability: 1.39,
      lapses: 1,
      last_review: new Date('2026-08-29T11:50:00.000Z').toISOString(),
    });

    const { next } = gradeCard(relearning, 3, NOW);

    expect(next.state).toBe('review');
  });

  it('keeps growing stability across a persisted run of good answers', () => {
    let row = newCard();
    let now = NOW;
    const stabilities: number[] = [];

    // Study the card each time it falls due, persisting only the columns the
    // database actually has (which is all `gradeCard` returns).
    for (let i = 0; i < 4; i += 1) {
      const { next } = gradeCard(row, 3, now);
      stabilities.push(next.stability);
      row = next;
      now = new Date(next.due);
    }

    for (let i = 1; i < stabilities.length; i += 1) {
      expect(stabilities[i]).toBeGreaterThan(stabilities[i - 1]);
    }
  });

  it('lapses a review card into `relearning` on Again', () => {
    const before = reviewCard();
    const { next } = gradeCard(before, 1, NOW);

    expect(next.state).toBe('relearning');
    expect(next.lapses).toBe(before.lapses + 1);
    expect(next.reps).toBe(before.reps + 1);
  });

  it('keeps a review card in `review` on Good and does not add a lapse', () => {
    const before = reviewCard();
    const { next } = gradeCard(before, 3, NOW);

    expect(next.state).toBe('review');
    expect(next.lapses).toBe(before.lapses);
    expect(new Date(next.due).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('returns a log with the grade and the before/after states', () => {
    const { log, next } = gradeCard(reviewCard(), 1, NOW);

    expect(log.user_id).toBe(USER_ID);
    expect(log.card_id).toBe(CARD_ID);
    expect(log.grade).toBe(1);
    expect(log.state_before).toBe('review');
    expect(log.state_after).toBe('relearning');
    expect(log.state_after).toBe(next.state);
  });

  it('logs `new` as the state before for a first review', () => {
    const { log, next } = gradeCard(newCard(), 4, NOW);

    expect(log.grade).toBe(4);
    expect(log.state_before).toBe('new');
    expect(log.state_after).toBe(next.state);
  });

  it('computes elapsed_days from last_review', () => {
    const { log } = gradeCard(reviewCard(), 3, NOW);

    expect(log.elapsed_days).toBe(10);
  });

  it('computes elapsed_days as 0 when the card has never been reviewed', () => {
    const { log } = gradeCard(newCard(), 3, NOW);

    expect(log.elapsed_days).toBe(0);
  });

  it('does not mutate the row it is given', () => {
    const before = reviewCard();
    const snapshot = { ...before };

    gradeCard(before, 1, NOW);

    expect(before).toEqual(snapshot);
  });

  it('accepts every grade and always returns a scheduled, ISO-dated row', () => {
    for (const grade of [1, 2, 3, 4] as const) {
      const { next, log } = gradeCard(reviewCard(), grade, NOW);

      expect(log.grade).toBe(grade);
      expect(Number.isNaN(new Date(next.due).getTime())).toBe(false);
      expect(next.due).toBe(new Date(next.due).toISOString());
      expect(new Date(next.due).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it('schedules an Easy answer no sooner than a Hard one', () => {
    const hard = gradeCard(reviewCard(), 2, NOW).next;
    const easy = gradeCard(reviewCard(), 4, NOW).next;

    expect(new Date(easy.due).getTime()).toBeGreaterThanOrEqual(
      new Date(hard.due).getTime(),
    );
  });

  it('defaults `now` to the current time', () => {
    const start = Date.now();
    const { next } = gradeCard(newCard(), 3);
    const end = Date.now();

    const reviewedAt = new Date(next.last_review as string).getTime();
    expect(reviewedAt).toBeGreaterThanOrEqual(start);
    expect(reviewedAt).toBeLessThanOrEqual(end);
  });
});
