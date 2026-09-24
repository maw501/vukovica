import { describe, expect, it } from 'vitest';

import type { LibraryEntry } from '@/lib/library';
import {
  LAST_SET_KEY,
  MINE_THEME,
  WAYS,
  initialSet,
  parseTheme,
  practisePool,
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
    for (const word of ['spaced', 'repetition', 'srs', 'fsrs', 'transliterat', 'flashcard']) {
      expect(copy).not.toContain(word);
    }
  });

  it('describes Meaning as the English-first drill, not a schedule', () => {
    const meaning = WAYS.find((option) => option.way === 'meaning');
    expect(meaning?.blurb).toBe('See the English, say the Serbian, then check.');
  });

  it('opens each way on the set, encoded once', () => {
    expect(wayHref('read', 'family')).toBe('/read/run?theme=family');
    expect(wayHref('write', MINE_THEME)).toBe('/trainer?theme=mine');
    expect(wayHref('meaning', 'numbers-time')).toBe('/read/run?way=meaning&theme=numbers-time');
    expect(wayHref('meaning', 'a b&c')).toBe('/read/run?way=meaning&theme=a%20b%26c');
  });

  it('never sends a way to the flashcard queue', () => {
    for (const option of WAYS) {
      expect(wayHref(option.way, 'family')).not.toMatch(/^\/review/);
    }
  });
});

describe('initialSet', () => {
  const sets = [
    { domain: MINE_THEME, total: 3 },
    { domain: 'family', total: 20 },
    { domain: 'food', total: 0 },
  ];

  it('opens on the set picked last time while it has words', () => {
    expect(initialSet('family', sets)).toBe('family');
    expect(initialSet(MINE_THEME, sets)).toBe(MINE_THEME);
  });

  it('opens on My words when nothing was remembered and My words has any', () => {
    expect(initialSet(null, sets)).toBe(MINE_THEME);
  });

  it('treats a remembered set that has emptied or gone as not remembered', () => {
    expect(initialSet('food', sets)).toBe(MINE_THEME);
    expect(initialSet('animals', sets)).toBe(MINE_THEME);
  });

  it('shows the list when there is neither', () => {
    const noMine = [
      { domain: MINE_THEME, total: 0 },
      { domain: 'family', total: 20 },
    ];
    expect(initialSet(null, noMine)).toBeNull();
    expect(initialSet('animals', noMine)).toBeNull();
    // Still loading: no sets at all.
    expect(initialSet('family', [])).toBeNull();
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

  // Mark: ticking a word must never take it out of a drill. A theme's set is
  // the whole theme, whatever he has ticked; ticking only adds to My words.
  it('keeps a ticked word in its theme’s set, and adds it to My words', () => {
    const family = [wordCard('a'), wordCard('b')];
    const library = [entry(family[0], 'review')];
    expect(practisePool({ theme: 'family', cards: family, library }).map((c) => c.id)).toEqual([
      'a',
      'b',
    ]);
    expect(practisePool({ theme: null, cards: family, library }).map((c) => c.id)).toEqual([
      'a',
      'b',
    ]);
    expect(practisePool({ theme: MINE_THEME, cards: family, library }).map((c) => c.id)).toEqual([
      'a',
    ]);
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
