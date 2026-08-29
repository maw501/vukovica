import { describe, expect, it } from 'vitest';

import { filterCards } from '@/lib/search';

const cards = [
  { sr_cyr: 'мама', en: 'mum' },
  { sr_cyr: 'ћао', en: 'hi, bye' },
  { sr_cyr: 'дете', en: 'child' },
  { sr_cyr: 'џеп', en: 'pocket' },
  { sr_cyr: 'ђак', en: 'pupil' },
  { sr_cyr: 'Београд', en: 'Belgrade' },
];

const names = (rows: { sr_cyr: string }[]) => rows.map((row) => row.sr_cyr);

describe('filterCards', () => {
  it('returns everything for an empty or whitespace query', () => {
    expect(filterCards(cards, '')).toHaveLength(cards.length);
    expect(filterCards(cards, '   ')).toHaveLength(cards.length);
  });

  it('matches Cyrillic substrings', () => {
    expect(names(filterCards(cards, 'мам'))).toEqual(['мама']);
  });

  it('matches the derived Latin form', () => {
    expect(names(filterCards(cards, 'mama'))).toEqual(['мама']);
    expect(names(filterCards(cards, 'dzep'))).toEqual(['џеп']);
  });

  it('matches English', () => {
    expect(names(filterCards(cards, 'pocket'))).toEqual(['џеп']);
    expect(names(filterCards(cards, 'bye'))).toEqual(['ћао']);
  });

  it('ignores case in both scripts', () => {
    expect(names(filterCards(cards, 'BEOGRAD'))).toEqual(['Београд']);
    expect(names(filterCards(cards, 'МАМА'))).toEqual(['мама']);
    expect(names(filterCards(cards, 'BeLgRaDe'))).toEqual(['Београд']);
  });

  it('ignores Serbian Latin diacritics, so an ASCII keyboard still finds the word', () => {
    // ћао -> "ćao"; typing "cao" must still find it.
    expect(names(filterCards(cards, 'cao'))).toEqual(['ћао']);
    // ђак -> "đak"; đ has no Unicode decomposition, so it needs its own rule.
    expect(names(filterCards(cards, 'dak'))).toEqual(['ђак']);
  });

  it('still matches when the query itself carries the diacritics', () => {
    expect(names(filterCards(cards, 'ćao'))).toEqual(['ћао']);
    expect(names(filterCards(cards, 'đak'))).toEqual(['ђак']);
  });

  it('trims the query', () => {
    expect(names(filterCards(cards, '  mum  '))).toEqual(['мама']);
  });

  it('returns nothing when there is no match', () => {
    expect(filterCards(cards, 'zzzz')).toEqual([]);
  });

  it('preserves the input order and does not mutate the input', () => {
    const input = [...cards];
    // "a" appears in mama / ćao / đak / Beograd, in that order.
    expect(names(filterCards(input, 'a'))).toEqual(['мама', 'ћао', 'ђак', 'Београд']);
    expect(input).toEqual(cards);
  });
});
