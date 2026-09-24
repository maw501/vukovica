import { describe, expect, it } from 'vitest';

import type { LibraryEntry } from '@/lib/library';
import { QUICK_ADD_DOMAIN } from '@/lib/quickAdd';
import { knownCardIds, knownOfLine, tickThemes, withMarkedKnown } from '@/lib/tick';
import type { CardRow, CardState, UserCardRow } from '@/lib/types';

function wordCard(id: string, domain = 'family'): CardRow {
  return {
    id,
    sr_cyr: `реч-${id}`,
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
    due: '2026-09-04T00:00:00.000Z',
    stability: 1,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    state,
    last_review: null,
  };
}

function entry(id: string, state: CardState, domain = 'family'): LibraryEntry {
  return { card: wordCard(id, domain), userCard: userCard(id, state) };
}

describe('knownCardIds', () => {
  it('keeps only graduated words, by the library rule', () => {
    const ids = knownCardIds([
      entry('a', 'review'),
      entry('b', 'learning'),
      entry('c', 'relearning'),
      entry('d', 'new'),
    ]);
    expect([...ids]).toEqual(['a']);
  });
});

describe('tickThemes', () => {
  const cards = [
    wordCard('f1', 'family'),
    wordCard('f2', 'family'),
    wordCard('f3', 'family'),
    wordCard('h1', 'home'),
    wordCard('q1', QUICK_ADD_DOMAIN),
    wordCard('x1', '  '),
  ];

  it('offers every deck theme with its size and how much is known, by name', () => {
    expect(tickThemes({ cards, knownIds: new Set(['f1', 'f3', 'q1']) })).toEqual([
      { domain: 'family', label: 'Family', total: 3, known: 2 },
      { domain: 'home', label: 'Home', total: 1, known: 0 },
    ]);
  });

  it('never offers the words he already has as a theme to tick', () => {
    const domains = tickThemes({ cards, knownIds: new Set() }).map((theme) => theme.domain);
    expect(domains).not.toContain('mine');
    expect(domains).not.toContain(QUICK_ADD_DOMAIN);
  });

  it('is empty for an empty deck', () => {
    expect(tickThemes({ cards: [], knownIds: new Set() })).toEqual([]);
  });
});

describe('knownOfLine', () => {
  it('reads as a fraction part way', () => {
    expect(knownOfLine(12, 66)).toBe('12 of 66 known');
  });

  it('says none rather than zero', () => {
    expect(knownOfLine(0, 66)).toBe('66 words · none known yet');
    expect(knownOfLine(0, 1)).toBe('1 word · none known yet');
  });

  it('says all when the theme is done, and never more than all', () => {
    expect(knownOfLine(66, 66)).toBe('All 66 known');
    expect(knownOfLine(70, 66)).toBe('All 66 known');
  });
});

describe('withMarkedKnown', () => {
  it('puts a newly known word at the front', () => {
    const before = [entry('a', 'review')];
    const card = wordCard('b');
    const row = userCard('b', 'review');
    const after = withMarkedKnown(before, card, row);
    expect(after?.map((e) => e.card.id)).toEqual(['b', 'a']);
    expect(after?.[0].userCard).toBe(row);
  });

  it('replaces a word he was still learning in place, without duplicating it', () => {
    const before = [entry('a', 'review'), entry('b', 'learning'), entry('c', 'review')];
    const row = userCard('b', 'review');
    const after = withMarkedKnown(before, before[1].card, row);
    expect(after?.map((e) => e.card.id)).toEqual(['a', 'b', 'c']);
    expect(after?.[1].userCard.state).toBe('review');
  });

  it('does not mutate what it was given', () => {
    const before = [entry('a', 'learning')];
    withMarkedKnown(before, before[0].card, userCard('a', 'review'));
    expect(before[0].userCard.state).toBe('learning');
  });

  it('leaves a list that was never loaded unloaded', () => {
    expect(withMarkedKnown(undefined, wordCard('a'), userCard('a', 'review'))).toBeUndefined();
  });
});
