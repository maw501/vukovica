/**
 * The in-memory shape of one study session.
 *
 * `lib/queue.ts` decides *which* cards a session contains; this decides how the
 * user walks through them, including the one bit of short-term reinforcement the
 * app has: a card answered **Again** comes back before the session ends.
 *
 * Pure and synchronous — no clock, no I/O, no card data. It moves card ids
 * around and tallies grades; the screen owns everything else.
 */

import type { ReviewGrade } from '@/lib/fsrs';

/**
 * How many times one card may be pushed back into the session queue.
 *
 * FSRS already gives an Again-graded card a 10-minute retry step, but a session
 * is usually over long before that, so an in-session re-show is what actually
 * reinforces a word the user just failed. Without a cap, a card the user cannot
 * remember at all would re-queue itself forever and the session could never end.
 */
export const MAX_REINSERTS_PER_CARD = 3;

export interface SessionState {
  /**
   * Card ids in presentation order. It *grows*: an Again answer appends the card
   * again at the end, which is why progress is "position of order.length" rather
   * than a fixed total.
   */
  readonly order: readonly string[];
  /** Index into `order` of the card being shown. `order.length` means finished. */
  readonly index: number;
  /** Re-insertions used so far, per card id. */
  readonly reinserts: Readonly<Record<string, number>>;
  /** How many answers of each grade the user has given this session. */
  readonly counts: Readonly<Record<ReviewGrade, number>>;
}

const NO_COUNTS: Record<ReviewGrade, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

/** A session over `cardIds`, in the order given. The array is copied. */
export function createSession(cardIds: readonly string[]): SessionState {
  return { order: [...cardIds], index: 0, reinserts: {}, counts: { ...NO_COUNTS } };
}

/** The card to show, or null when the session is over. */
export function currentCardId(state: SessionState): string | null {
  return state.index < state.order.length ? state.order[state.index] : null;
}

export function isSessionComplete(state: SessionState): boolean {
  return state.index >= state.order.length;
}

/** "X of N", where N grows as Again-graded cards are re-queued. */
export function sessionProgress(state: SessionState): { position: number; total: number } {
  return {
    position: Math.min(state.index + 1, state.order.length),
    total: state.order.length,
  };
}

/** Total answers given, i.e. the sum of the grade tallies. */
export function sessionTotalAnswers(state: SessionState): number {
  return state.counts[1] + state.counts[2] + state.counts[3] + state.counts[4];
}

/**
 * Record `grade` for the current card and move on.
 *
 * Grade 1 (Again) also re-queues the card at the end, up to
 * `MAX_REINSERTS_PER_CARD` times. Returns a new state; the input is untouched.
 * Answering a finished session is a no-op.
 */
export function answerCurrent(state: SessionState, grade: ReviewGrade): SessionState {
  const cardId = currentCardId(state);
  if (cardId === null) return state;

  const used = state.reinserts[cardId] ?? 0;
  const reinsert = grade === 1 && used < MAX_REINSERTS_PER_CARD;

  return {
    order: reinsert ? [...state.order, cardId] : state.order,
    index: state.index + 1,
    reinserts: reinsert ? { ...state.reinserts, [cardId]: used + 1 } : state.reinserts,
    counts: { ...state.counts, [grade]: state.counts[grade] + 1 },
  };
}
