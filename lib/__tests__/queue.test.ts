import { describe, expect, it } from 'vitest';

import { buildQueue } from '@/lib/queue';
import type { CardKind, CardRow, UserCardRow } from '@/lib/types';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function due(cardId: string, dueIso: string): UserCardRow {
  return {
    user_id: USER_ID,
    card_id: cardId,
    due: dueIso,
    stability: 5,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    state: 'review',
    last_review: '2026-08-20T12:00:00.000Z',
  };
}

function card(id: string, kind: CardKind = 'word'): CardRow {
  return {
    id,
    sr_cyr: 'реч',
    en: 'word',
    pos: 'noun',
    gender: 'f',
    aspect: null,
    example_cyr: 'То је реч.',
    example_en: 'That is a word.',
    domain: 'core',
    audio_path: null,
    kind,
    created_by: null,
    created_at: null,
  };
}

describe('buildQueue', () => {
  it('orders due cards oldest-due-first', () => {
    const result = buildQueue({
      dueCards: [
        due('c-late', '2026-08-29T12:00:00.000Z'),
        due('c-early', '2026-08-27T12:00:00.000Z'),
        due('c-mid', '2026-08-28T12:00:00.000Z'),
      ],
      newCards: [],
      newPerDay: 10,
      newDoneToday: 0,
    });

    expect(result).toEqual([
      { cardId: 'c-early', isNew: false },
      { cardId: 'c-mid', isNew: false },
      { cardId: 'c-late', isNew: false },
    ]);
  });

  it('appends new cards after the due cards, in the order given', () => {
    const result = buildQueue({
      dueCards: [due('c-due', '2026-08-27T12:00:00.000Z')],
      newCards: [card('n-1'), card('n-2')],
      newPerDay: 10,
      newDoneToday: 0,
    });

    expect(result).toEqual([
      { cardId: 'c-due', isNew: false },
      { cardId: 'n-1', isNew: true },
      { cardId: 'n-2', isNew: true },
    ]);
  });

  it('caps new cards at the remaining daily allowance', () => {
    const result = buildQueue({
      dueCards: [],
      newCards: [card('n-1'), card('n-2'), card('n-3'), card('n-4')],
      newPerDay: 5,
      newDoneToday: 3,
    });

    expect(result).toEqual([
      { cardId: 'n-1', isNew: true },
      { cardId: 'n-2', isNew: true },
    ]);
  });

  it('includes no new cards once the daily allowance is exhausted', () => {
    const result = buildQueue({
      dueCards: [due('c-due', '2026-08-27T12:00:00.000Z')],
      newCards: [card('n-1'), card('n-2')],
      newPerDay: 5,
      newDoneToday: 5,
    });

    expect(result).toEqual([{ cardId: 'c-due', isNew: false }]);
  });

  it('clamps a negative allowance to zero new cards', () => {
    const result = buildQueue({
      dueCards: [],
      newCards: [card('n-1')],
      newPerDay: 5,
      newDoneToday: 9,
    });

    expect(result).toEqual([]);
  });

  it('takes fewer new cards than the allowance when the pool is smaller', () => {
    const result = buildQueue({
      dueCards: [],
      newCards: [card('n-1')],
      newPerDay: 20,
      newDoneToday: 0,
    });

    expect(result).toEqual([{ cardId: 'n-1', isNew: true }]);
  });

  it('returns an empty queue when there is nothing to study', () => {
    expect(
      buildQueue({ dueCards: [], newCards: [], newPerDay: 10, newDoneToday: 0 }),
    ).toEqual([]);
  });

  it('does not mutate the arrays it is given', () => {
    const dueCards = [
      due('c-late', '2026-08-29T12:00:00.000Z'),
      due('c-early', '2026-08-27T12:00:00.000Z'),
    ];
    const newCards = [card('n-1'), card('n-2')];
    const dueOrder = dueCards.map((row) => row.card_id);
    const newOrder = newCards.map((row) => row.id);

    buildQueue({ dueCards, newCards, newPerDay: 1, newDoneToday: 0 });

    expect(dueCards.map((row) => row.card_id)).toEqual(dueOrder);
    expect(newCards.map((row) => row.id)).toEqual(newOrder);
  });
});
