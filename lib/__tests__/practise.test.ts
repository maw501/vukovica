import { describe, expect, it } from 'vitest';

import type { LibraryEntry } from '@/lib/library';
import {
  LAST_SET_KEY,
  MINE_THEME,
  WAYS,
  dailyReviewCount,
  inQueueScope,
  meaningEmptyMessage,
  parseTheme,
  practisePool,
  queueScope,
  readLastSet,
  setLabel,
  wayHref,
  writeItEmptyMessage,
  writeLastSet,
  type KeyValueStore,
} from '@/lib/practise';
import type { CardRow, CardState, UserCardRow } from '@/lib/types';

function wordCard(id: string, domain = 'family'): CardRow {
  return {
    id,
    sr_cyr: `реч${id}`,
    en: `word ${id}`,
    pos: 'noun',
    gender: null,
    aspect: null,
    example_cyr: '',
    example_en: '',
    domain,
    audio_path: null,
    kind: 'word',
    created_by: null,
    created_at: null,
  };
}

function userCard(cardId: string, state: CardState): UserCardRow {
  return {
    user_id: 'u1',
    card_id: cardId,
    due: '2026-09-24T08:00:00Z',
    stability: 1,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    state,
    last_review: null,
  };
}

function entry(card: CardRow, state: CardState): LibraryEntry {
  return { card, userCard: userCard(card.id, state) };
}

describe('parseTheme', () => {
  it('is null for no theme, a blank one or an empty array — the whole deck', () => {
    expect(parseTheme(undefined)).toBeNull();
    expect(parseTheme('')).toBeNull();
    expect(parseTheme('   ')).toBeNull();
    expect(parseTheme([])).toBeNull();
  });

  it('keeps a domain or mine, trimmed, and takes the first of a repeated param', () => {
    expect(parseTheme('family')).toBe('family');
    expect(parseTheme(' family ')).toBe('family');
    expect(parseTheme(MINE_THEME)).toBe(MINE_THEME);
    expect(parseTheme(['food', 'family'])).toBe('food');
  });
});

describe('setLabel', () => {
  it('names a set the way the picker does, and the deck when there is none', () => {
    expect(setLabel(MINE_THEME)).toBe('My words');
    expect(setLabel('greetings-courtesy')).toBe('Greetings and manners');
    expect(setLabel(null)).toBe('the whole deck');
  });
});

describe('WAYS and wayHref', () => {
  it('offers the three ways in order, with no jargon in the copy', () => {
    expect(WAYS.map((option) => option.label)).toEqual(['Read aloud', 'Write it', 'Meaning']);
    const copy = WAYS.map((option) => `${option.label} ${option.blurb}`).join(' ').toLowerCase();
    for (const word of ['spaced', 'repetition', 'srs', 'fsrs', 'transliterat']) {
      expect(copy).not.toContain(word);
    }
  });

  it('opens each way on the set, encoded once', () => {
    expect(wayHref('read', 'family')).toBe('/read/run?theme=family');
    expect(wayHref('write', MINE_THEME)).toBe('/trainer?theme=mine');
    expect(wayHref('meaning', 'numbers-time')).toBe('/review?theme=numbers-time');
    expect(wayHref('meaning', 'a b&c')).toBe('/review?theme=a%20b%26c');
  });
});

describe('practisePool', () => {
  const cards = [wordCard('a', 'family'), wordCard('b', 'food'), wordCard('c', 'family')];

  it('is the whole deck with no theme', () => {
    expect(practisePool({ theme: null, cards }).map((card) => card.id)).toEqual(['a', 'b', 'c']);
  });

  it('is one domain for a domain theme', () => {
    expect(practisePool({ theme: 'family', cards }).map((card) => card.id)).toEqual(['a', 'c']);
    expect(practisePool({ theme: 'animals', cards })).toEqual([]);
  });

  it('is only the known words of My words for mine — not the ones still being learnt', () => {
    const library = [
      entry(wordCard('k1', 'food'), 'review'),
      entry(wordCard('l1', 'food'), 'learning'),
      entry(wordCard('r1', 'food'), 'relearning'),
      entry(wordCard('k2', 'my-words'), 'review'),
    ];
    expect(practisePool({ theme: MINE_THEME, cards, library }).map((card) => card.id)).toEqual([
      'k1',
      'k2',
    ]);
    expect(practisePool({ theme: MINE_THEME, cards })).toEqual([]);
  });
});

describe('queueScope and inQueueScope', () => {
  const family = wordCard('f', 'family');
  const food = wordCard('g', 'food');

  it('lets everything through with no theme — the daily session, unchanged', () => {
    const scope = queueScope(null);
    expect(scope).toEqual({ domain: null, knownOnly: false, includeNew: true });
    expect(inQueueScope(scope, family, null)).toBe(true);
    expect(inQueueScope(scope, food, userCard('g', 'learning'))).toBe(true);
  });

  it('keeps a domain theme to that domain, due and new alike', () => {
    const scope = queueScope('family');
    expect(scope).toEqual({ domain: 'family', knownOnly: false, includeNew: true });
    expect(inQueueScope(scope, family, null)).toBe(true);
    expect(inQueueScope(scope, family, userCard('f', 'relearning'))).toBe(true);
    expect(inQueueScope(scope, food, null)).toBe(false);
    expect(inQueueScope(scope, food, userCard('g', 'review'))).toBe(false);
  });

  // `getQueue`'s `.eq` has already excluded such a row by the time this runs;
  // the check only has to agree with the picker's trimmed rule, not rescue it.
  it('compares domains trimmed, agreeing with the picker', () => {
    expect(inQueueScope(queueScope('family'), { domain: 'family ' }, null)).toBe(true);
  });

  it('keeps mine to known words and never introduces a new card', () => {
    const scope = queueScope(MINE_THEME);
    expect(scope).toEqual({ domain: null, knownOnly: true, includeNew: false });
    expect(inQueueScope(scope, food, userCard('g', 'review'))).toBe(true);
    expect(inQueueScope(scope, food, userCard('g', 'learning'))).toBe(false);
    expect(inQueueScope(scope, food, userCard('g', 'relearning'))).toBe(false);
    expect(inQueueScope(scope, food, null)).toBe(false);
  });
});

describe('meaningEmptyMessage', () => {
  it('keeps the daily session’s message with no theme', () => {
    expect(meaningEmptyMessage(null, 0)).toMatch(/^No cards are due right now/);
  });

  it('says today’s new words are used up rather than "try another set" in circles', () => {
    const message = meaningEmptyMessage('family', 0);
    expect(message).toMatch(/today’s new words/);
    expect(message).toMatch(/tomorrow/);
    expect(message).not.toMatch(/another set/);
  });

  it('names the set when there was allowance left and still nothing to do', () => {
    expect(meaningEmptyMessage('family', 4)).toBe(
      'Nothing from Family to go over right now. Come back later, or try another set.',
    );
  });

  it('never blames the allowance for My words, which never takes new cards', () => {
    expect(meaningEmptyMessage(MINE_THEME, 0)).toMatch(/^None of your words/);
  });
});

describe('writeItEmptyMessage', () => {
  it('tells an empty My words from one holding only phrases', () => {
    expect(writeItEmptyMessage(MINE_THEME, 0)).toMatch(/tick words you know/);
    expect(writeItEmptyMessage(MINE_THEME, 3)).toMatch(/all phrases/);
  });

  it('names a domain with no single words, and keeps the whole-deck message', () => {
    expect(writeItEmptyMessage('phrases', 40)).toBe(
      'Phrases has no single words to type. Pick another set.',
    );
    expect(writeItEmptyMessage(null, 0)).toMatch(/^There are no single words in the deck/);
  });
});

describe('dailyReviewCount', () => {
  it('is due cards plus what is left of today’s new ones', () => {
    expect(dailyReviewCount({ dueCount: 5, newAvailable: 100, newDoneToday: 3 }, 10)).toBe(12);
  });

  it('never offers more new cards than the deck has left, nor goes negative', () => {
    expect(dailyReviewCount({ dueCount: 0, newAvailable: 2, newDoneToday: 0 }, 10)).toBe(2);
    expect(dailyReviewCount({ dueCount: 0, newAvailable: 50, newDoneToday: 15 }, 10)).toBe(0);
  });
});

describe('readLastSet / writeLastSet', () => {
  function memoryStore(): KeyValueStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    };
  }

  it('remembers the set picked last', () => {
    const store = memoryStore();
    expect(readLastSet(store)).toBeNull();
    writeLastSet('food', store);
    expect(store.data.get(LAST_SET_KEY)).toBe('food');
    expect(readLastSet(store)).toBe('food');
  });

  it('shrugs off a storage that is missing or throws', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(readLastSet(broken)).toBeNull();
    expect(() => writeLastSet('food', broken)).not.toThrow();
    expect(readLastSet(null)).toBeNull();
    expect(() => writeLastSet('food', null)).not.toThrow();
  });
});
