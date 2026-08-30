import { describe, expect, it } from 'vitest';

import { cyrToLat, latinLetterPair, latToCyr } from '@/lib/transliterate';

/**
 * The full Serbian alphabet, in Vuk's order, as (cyrillic, latin) pairs.
 * Both functions must agree with this table for every letter.
 */
const ALPHABET: ReadonlyArray<readonly [string, string]> = [
  ['а', 'a'],
  ['б', 'b'],
  ['в', 'v'],
  ['г', 'g'],
  ['д', 'd'],
  ['ђ', 'đ'],
  ['е', 'e'],
  ['ж', 'ž'],
  ['з', 'z'],
  ['и', 'i'],
  ['ј', 'j'],
  ['к', 'k'],
  ['л', 'l'],
  ['љ', 'lj'],
  ['м', 'm'],
  ['н', 'n'],
  ['њ', 'nj'],
  ['о', 'o'],
  ['п', 'p'],
  ['р', 'r'],
  ['с', 's'],
  ['т', 't'],
  ['ћ', 'ć'],
  ['у', 'u'],
  ['ф', 'f'],
  ['х', 'h'],
  ['ц', 'c'],
  ['ч', 'č'],
  ['џ', 'dž'],
  ['ш', 'š'],
];

/** Cyrillic words used for the round-trip guarantee the seed deck relies on. */
const ROUND_TRIP_WORDS = [
  'ђак',
  'ћирилица',
  'џеп',
  'љубав',
  'њива',
  'шљива',
  'Београд',
  'Живела Србија',
];

describe('cyrToLat', () => {
  it('maps every lowercase letter of the alphabet', () => {
    for (const [cyr, lat] of ALPHABET) {
      expect(cyrToLat(cyr)).toBe(lat);
    }
  });

  it('maps every uppercase letter of the alphabet in an all-caps context', () => {
    for (const [cyr, lat] of ALPHABET) {
      expect(cyrToLat(cyr.toUpperCase())).toBe(lat.toUpperCase());
    }
  });

  it('translates whole words', () => {
    expect(cyrToLat('ђак')).toBe('đak');
    expect(cyrToLat('ћирилица')).toBe('ćirilica');
    expect(cyrToLat('џеп')).toBe('džep');
    expect(cyrToLat('шљива')).toBe('šljiva');
    expect(cyrToLat('Београд')).toBe('Beograd');
    expect(cyrToLat('Живела Србија')).toBe('Živela Srbija');
  });

  it('title-cases a digraph capital when the word is title case', () => {
    expect(cyrToLat('Његош')).toBe('Njegoš');
    expect(cyrToLat('Љубав')).toBe('Ljubav');
    expect(cyrToLat('Џеп')).toBe('Džep');
  });

  it('upper-cases a digraph capital in an ALL-CAPS word', () => {
    expect(cyrToLat('ЊЕГОШ')).toBe('NJEGOŠ');
    expect(cyrToLat('ЉУБАВ')).toBe('LJUBAV');
    expect(cyrToLat('ЏЕП')).toBe('DŽEP');
  });

  it('upper-cases a trailing digraph capital that follows an uppercase letter', () => {
    expect(cyrToLat('КРАЉ')).toBe('KRALJ');
  });

  it('passes non-Cyrillic characters through unchanged', () => {
    expect(cyrToLat('hello, 123!')).toBe('hello, 123!');
    expect(cyrToLat('')).toBe('');
    expect(cyrToLat('Ђак = đak (100%)')).toBe('Đak = đak (100%)');
  });
});

describe('latToCyr', () => {
  it('maps every lowercase letter of the alphabet', () => {
    for (const [cyr, lat] of ALPHABET) {
      expect(latToCyr(lat)).toBe(cyr);
    }
  });

  it('maps every uppercase letter of the alphabet', () => {
    for (const [cyr, lat] of ALPHABET) {
      expect(latToCyr(lat.toUpperCase())).toBe(cyr.toUpperCase());
    }
  });

  it('parses digraphs greedily, in every casing', () => {
    expect(latToCyr('džez')).toBe('џез');
    expect(latToCyr('Ljubav')).toBe('Љубав');
    expect(latToCyr('NJIVA')).toBe('ЊИВА');
    expect(latToCyr('Njegoš')).toBe('Његош');
    expect(latToCyr('DŽEP')).toBe('ЏЕП');
    expect(latToCyr('šljiva')).toBe('шљива');
  });

  it('does not map ASCII lookalikes to diacritic letters', () => {
    // c/s/z are real Serbian Latin letters and map to ц/с/з, not ћ/ч/ш/ж.
    expect(latToCyr('csz')).toBe('цсз');
    // "dj" is a transliteration crutch, not a Serbian Latin letter: d + j.
    expect(latToCyr('djak')).toBe('дјак');
  });

  it('passes non-Serbian-Latin characters through unchanged', () => {
    expect(latToCyr('123!')).toBe('123!');
    expect(latToCyr('')).toBe('');
    expect(latToCyr('qwxy')).toBe('qwxy');
    expect(latToCyr('Београд')).toBe('Београд');
  });
});

/**
 * The letter-card pair form. `cyrToLat` alone is not it: a lone capital digraph
 * has no lowercase neighbour to prove it is title-case, so it defaults to all
 * caps — right for КРАЉ, wrong for a letter cited on its own.
 */
describe('latinLetterPair', () => {
  it('title-cases a digraph rather than shouting it', () => {
    expect(latinLetterPair('Љ љ')).toBe('Lj lj');
    expect(latinLetterPair('Њ њ')).toBe('Nj nj');
    expect(latinLetterPair('Џ џ')).toBe('Dž dž');
    // The behaviour this fixes, still correct for words:
    expect(cyrToLat('Љ љ')).toBe('LJ lj');
    expect(cyrToLat('КРАЉ')).toBe('KRALJ');
  });

  it('handles the single-glyph letters and the diacritics', () => {
    expect(latinLetterPair('А а')).toBe('A a');
    expect(latinLetterPair('Б б')).toBe('B b');
    expect(latinLetterPair('Ђ ђ')).toBe('Đ đ');
    expect(latinLetterPair('Ж ж')).toBe('Ž ž');
    expect(latinLetterPair('Ћ ћ')).toBe('Ć ć');
    expect(latinLetterPair('Ч ч')).toBe('Č č');
    expect(latinLetterPair('Ш ш')).toBe('Š š');
  });

  it('agrees with cyrToLat for every non-digraph letter of the alphabet', () => {
    for (const [cyr, lat] of ALPHABET) {
      const expected = `${lat.charAt(0).toUpperCase()}${lat.slice(1)} ${lat}`;
      expect(latinLetterPair(`${cyr.toUpperCase()} ${cyr}`)).toBe(expected);
    }
  });

  it('leaves an empty or non-Serbian input alone but for its first letter', () => {
    expect(latinLetterPair('')).toBe('');
    expect(latinLetterPair('?')).toBe('?');
  });
});

describe('round trip', () => {
  it('preserves Cyrillic through latToCyr(cyrToLat(x))', () => {
    for (const word of ROUND_TRIP_WORDS) {
      expect(latToCyr(cyrToLat(word))).toBe(word);
    }
  });

  it('preserves Latin through cyrToLat(latToCyr(x))', () => {
    for (const word of ROUND_TRIP_WORDS) {
      const latin = cyrToLat(word);
      expect(cyrToLat(latToCyr(latin))).toBe(latin);
    }
  });

  it('preserves every letter of the alphabet in both directions', () => {
    for (const [cyr, lat] of ALPHABET) {
      expect(latToCyr(cyrToLat(cyr))).toBe(cyr);
      expect(cyrToLat(latToCyr(lat))).toBe(lat);
      expect(latToCyr(cyrToLat(cyr.toUpperCase()))).toBe(cyr.toUpperCase());
    }
  });
});
