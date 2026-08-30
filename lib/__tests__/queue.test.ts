import { describe, expect, it } from 'vitest';

import {
  buildQueue,
  cardsInDeck,
  deckAllowance,
  deckKind,
  DEFAULT_DECK,
  LETTERS_NEW_PER_DAY,
  parseDeck,
} from '@/lib/queue';
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

/**
 * The deck split (spec §4). Words and letters share `cards`, FSRS and the
 * `submit_review` RPC, and are kept apart by exactly two things: which `kind`
 * a query asks for, and how many new cards a day each is allowed.
 */
describe('decks', () => {
  it('maps each deck to its cards.kind', () => {
    expect(deckKind('words')).toBe('word');
    expect(deckKind('letters')).toBe('letter');
  });

  it('defaults to the word deck', () => {
    expect(DEFAULT_DECK).toBe('words');
  });

  describe('parseDeck', () => {
    it('accepts the letters deck by name', () => {
      expect(parseDeck('letters')).toBe('letters');
      // expo-router hands a repeated query parameter over as an array.
      expect(parseDeck(['letters'])).toBe('letters');
    });

    it('reads anything else as the word deck', () => {
      // A mistyped or stale link still opens a usable session rather than a
      // blank screen.
      expect(parseDeck('words')).toBe('words');
      expect(parseDeck(undefined)).toBe('words');
      expect(parseDeck('')).toBe('words');
      expect(parseDeck('LETTERS')).toBe('words');
      expect(parseDeck('alphabet')).toBe('words');
      expect(parseDeck([])).toBe('words');
      expect(parseDeck(7)).toBe('words');
    });
  });

  describe('deckAllowance', () => {
    it('gives the words deck the user setting', () => {
      expect(deckAllowance('words', 10)).toBe(10);
      expect(deckAllowance('words', 25)).toBe(25);
    });

    it('gives the letters deck its own fixed budget, whatever the setting', () => {
      expect(deckAllowance('letters', 10)).toBe(LETTERS_NEW_PER_DAY);
      expect(deckAllowance('letters', 100)).toBe(LETTERS_NEW_PER_DAY);
      expect(deckAllowance('letters', 0)).toBe(LETTERS_NEW_PER_DAY);
    });

    it('clamps a nonsense word setting to zero rather than going negative', () => {
      expect(deckAllowance('words', -3)).toBe(0);
    });

    it('introduces the whole azbuka in six sessions', () => {
      expect(Math.ceil(30 / LETTERS_NEW_PER_DAY)).toBe(6);
    });
  });

  describe('cardsInDeck', () => {
    const mixed = [
      card('w-1', 'word'),
      card('l-1', 'letter'),
      card('w-2', 'word'),
      card('l-2', 'letter'),
    ];

    it('partitions a mixed list by kind, keeping the order given', () => {
      expect(cardsInDeck(mixed, 'words').map((c) => c.id)).toEqual(['w-1', 'w-2']);
      expect(cardsInDeck(mixed, 'letters').map((c) => c.id)).toEqual(['l-1', 'l-2']);
    });

    it('never lets one deck leak into the other', () => {
      const words = cardsInDeck(mixed, 'words');
      const letters = cardsInDeck(mixed, 'letters');
      expect(words.every((c) => c.kind === 'word')).toBe(true);
      expect(letters.every((c) => c.kind === 'letter')).toBe(true);
      expect(words.length + letters.length).toBe(mixed.length);
    });

    it('returns an empty list for a deck with no cards yet', () => {
      expect(cardsInDeck([card('w-1', 'word')], 'letters')).toEqual([]);
      expect(cardsInDeck([], 'words')).toEqual([]);
    });

    it('does not mutate the list it is given', () => {
      const input = [...mixed];
      cardsInDeck(input, 'letters');
      expect(input.map((c) => c.id)).toEqual(mixed.map((c) => c.id));
    });
  });

  it('caps a letters queue at the deck allowance', () => {
    // The end-to-end shape: the letter cards for the deck, capped by the
    // letters budget rather than the (larger) words setting.
    const pool = [card('l-1', 'letter'), card('w-1', 'word'), card('l-2', 'letter')];
    const newCards = cardsInDeck(pool, 'letters');
    const newPerDay = deckAllowance('letters', 10);

    expect(
      buildQueue({ dueCards: [], newCards, newPerDay, newDoneToday: 4 }),
    ).toEqual([{ cardId: 'l-1', isNew: true }]);
  });
});

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
