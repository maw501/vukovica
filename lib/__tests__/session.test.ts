import { describe, expect, it } from 'vitest';

import {
  MAX_REINSERTS_PER_CARD,
  answerCurrent,
  createSession,
  currentCardId,
  isSessionComplete,
  sessionProgress,
  sessionTotalAnswers,
  skipCurrent,
} from '@/lib/session';

/** Answer the current card `times` times in a row with the same grade. */
function answerMany(cardIds: string[], grades: (1 | 2 | 3 | 4)[]) {
  let state = createSession(cardIds);
  for (const grade of grades) state = answerCurrent(state, grade);
  return state;
}

describe('createSession', () => {
  it('starts at the first card', () => {
    const state = createSession(['a', 'b', 'c']);
    expect(currentCardId(state)).toBe('a');
    expect(sessionProgress(state)).toEqual({ position: 1, total: 3 });
    expect(isSessionComplete(state)).toBe(false);
  });

  it('is immediately complete when there is nothing to study', () => {
    const state = createSession([]);
    expect(currentCardId(state)).toBeNull();
    expect(isSessionComplete(state)).toBe(true);
    expect(sessionProgress(state)).toEqual({ position: 0, total: 0 });
  });

  it('starts with zero counts', () => {
    expect(createSession(['a']).counts).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
  });

  it('does not alias the caller’s array', () => {
    const ids = ['a', 'b'];
    const state = createSession(ids);
    ids.push('c');
    expect(state.order).toEqual(['a', 'b']);
  });
});

describe('answerCurrent', () => {
  it('advances to the next card', () => {
    const state = answerMany(['a', 'b'], [3]);
    expect(currentCardId(state)).toBe('b');
    expect(sessionProgress(state)).toEqual({ position: 2, total: 2 });
  });

  it('does not mutate the state it is given', () => {
    const before = createSession(['a', 'b']);
    const snapshot = JSON.parse(JSON.stringify(before));
    answerCurrent(before, 1);
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
  });

  it('tallies each grade, including repeat answers for the same card', () => {
    const state = answerMany(['a', 'b'], [3, 1]);
    expect(state.counts).toEqual({ 1: 1, 2: 0, 3: 1, 4: 0 });
    expect(sessionTotalAnswers(state)).toBe(2);
  });

  it('completes the session after the last card', () => {
    const state = answerMany(['a', 'b'], [3, 4]);
    expect(isSessionComplete(state)).toBe(true);
    expect(currentCardId(state)).toBeNull();
  });

  it('is a no-op once the session is complete', () => {
    const done = answerMany(['a'], [3]);
    const after = answerCurrent(done, 1);
    expect(after).toEqual(done);
  });
});

describe('Again re-inserts the card at the end of the session queue', () => {
  it('re-shows an Again-graded card after everything else', () => {
    const state = answerMany(['a', 'b', 'c'], [1]);
    expect(state.order).toEqual(['a', 'b', 'c', 'a']);
    expect(currentCardId(state)).toBe('b');
    expect(sessionProgress(state)).toEqual({ position: 2, total: 4 });
  });

  it('re-shows the card even when it was the last one left', () => {
    const state = answerMany(['a'], [1]);
    expect(isSessionComplete(state)).toBe(false);
    expect(currentCardId(state)).toBe('a');
  });

  it('does not re-insert for Hard, Good or Easy', () => {
    for (const grade of [2, 3, 4] as const) {
      const state = answerMany(['a', 'b'], [grade]);
      expect(state.order).toEqual(['a', 'b']);
    }
  });

  it(`caps re-insertions at ${MAX_REINSERTS_PER_CARD} per card, so Again cannot loop forever`, () => {
    // One card, answered Again over and over. It should come back exactly
    // MAX_REINSERTS_PER_CARD times and then the session must end.
    let state = createSession(['a']);
    let answers = 0;
    while (!isSessionComplete(state) && answers < 50) {
      state = answerCurrent(state, 1);
      answers += 1;
    }
    expect(answers).toBe(MAX_REINSERTS_PER_CARD + 1);
    expect(state.order).toEqual(['a', 'a', 'a', 'a']);
    expect(state.counts[1]).toBe(MAX_REINSERTS_PER_CARD + 1);
    expect(isSessionComplete(state)).toBe(true);
  });

  it('counts the cap per card, not per session', () => {
    // a fails four times, b still gets its own allowance.
    let state = createSession(['a', 'b']);
    // a: Again x4 (3 re-inserts, then capped), interleaved with b's answers.
    state = answerCurrent(state, 1); // a -> queue [a,b,a], now at b
    state = answerCurrent(state, 3); // b good, now at a (2nd showing)
    state = answerCurrent(state, 1); // a again -> [a,b,a,a]
    state = answerCurrent(state, 1); // a again -> [a,b,a,a,a]
    state = answerCurrent(state, 1); // a again -> capped, no re-insert
    expect(state.order).toEqual(['a', 'b', 'a', 'a', 'a']);
    expect(isSessionComplete(state)).toBe(true);

    const fresh = answerMany(['b'], [1]);
    expect(fresh.order).toEqual(['b', 'b']);
  });
});

describe('skipCurrent', () => {
  it('moves to the next card', () => {
    const state = skipCurrent(createSession(['a', 'b']));
    expect(currentCardId(state)).toBe('b');
    expect(sessionProgress(state)).toEqual({ position: 2, total: 2 });
  });

  it('counts no answer — a word declared known was not studied', () => {
    const state = skipCurrent(createSession(['a', 'b']));
    expect(sessionTotalAnswers(state)).toBe(0);
    expect(state.counts).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
  });

  it('never re-queues the skipped card', () => {
    const state = skipCurrent(createSession(['a']));
    expect(state.order).toEqual(['a']);
    expect(isSessionComplete(state)).toBe(true);
  });

  it('leaves the input untouched', () => {
    const before = createSession(['a', 'b']);
    skipCurrent(before);
    expect(before.index).toBe(0);
  });

  it('is a no-op once the session is over', () => {
    const done = skipCurrent(skipCurrent(createSession(['a'])));
    expect(done.index).toBe(1);
    expect(isSessionComplete(done)).toBe(true);
  });
});
