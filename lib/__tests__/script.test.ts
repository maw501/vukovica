import { describe, expect, it } from 'vitest';

import { hasCyrillic, splitScriptRuns, type ScriptSegment } from '@/lib/script';

/** The Cyrillic runs, in order — what the styling actually turns on. */
function cyrillicRuns(text: string): string[] {
  return splitScriptRuns(text)
    .filter((segment) => segment.cyrillic)
    .map((segment) => segment.text);
}

/** Every segment rejoined. Must always be the input, or something was lost. */
function rejoin(segments: ScriptSegment[]): string {
  return segments.map((segment) => segment.text).join('');
}

describe('splitScriptRuns', () => {
  it('yields nothing for an empty string', () => {
    expect(splitScriptRuns('')).toEqual([]);
  });

  it('yields one non-Cyrillic segment for plain English', () => {
    expect(splitScriptRuns('as in book')).toEqual([{ text: 'as in book', cyrillic: false }]);
  });

  it('yields one Cyrillic segment for a word that is all Cyrillic', () => {
    expect(splitScriptRuns('беба')).toEqual([{ text: 'беба', cyrillic: true }]);
  });

  it('interleaves the two, in order', () => {
    expect(splitScriptRuns('b as in book — беба (baby)')).toEqual([
      { text: 'b as in book — ', cyrillic: false },
      { text: 'беба', cyrillic: true },
      { text: ' (baby)', cyrillic: false },
    ]);
  });

  it('keeps a Cyrillic phrase together across its spaces', () => {
    expect(cyrillicRuns('Read Погоди колико те волим to your son')).toEqual([
      'Погоди колико те волим',
    ]);
  });

  it('pulls guillemets into the run they quote', () => {
    expect(cyrillicRuns('Read «Погоди колико те волим» to your son')).toEqual([
      '«Погоди колико те волим»',
    ]);
  });

  it('handles the low quote pair as well', () => {
    expect(cyrillicRuns('the book „Мали принц“ on the shelf')).toEqual(['„Мали принц“']);
  });

  it('does not swallow the drill blank between two Cyrillic words', () => {
    expect(splitScriptRuns('I love — ја ___ (волети)')).toEqual([
      { text: 'I love — ', cyrillic: false },
      { text: 'ја', cyrillic: true },
      { text: ' ___ (', cyrillic: false },
      { text: 'волети', cyrillic: true },
      { text: ')', cyrillic: false },
    ]);
  });

  it('joins Cyrillic across sentence punctuation but stops at the English', () => {
    expect(cyrillicRuns('To be — сам / јесам (present)')).toEqual(['сам', 'јесам']);
    expect(cyrillicRuns('Ја сам уморан. — I am tired.')).toEqual(['Ја сам уморан']);
  });

  it('finds every run in a string with several', () => {
    expect(cyrillicRuns('мама (mum), тата (dad) and дете (child)')).toEqual([
      'мама',
      'тата',
      'дете',
    ]);
  });

  it('tiles the input exactly, whatever it is given', () => {
    const inputs = [
      '',
      'no Cyrillic here at all',
      'кућа',
      'b as in book — беба (baby)',
      'Read «Погоди колико те волим» to your son',
      'I love — ја ___ (волети)',
      'мама (mum), тата (dad) and дете (child)',
      '   ',
      '— «» ...',
      'прст (finger) — риба (fish)',
    ];
    for (const input of inputs) {
      expect(rejoin(splitScriptRuns(input))).toBe(input);
    }
  });

  it('is not confused by a second call (no shared regex state)', () => {
    const first = splitScriptRuns('мама (mum), тата (dad)');
    const second = splitScriptRuns('мама (mum), тата (dad)');
    expect(second).toEqual(first);
  });
});

describe('hasCyrillic', () => {
  it('is true only when there is Cyrillic in the string', () => {
    expect(hasCyrillic('беба')).toBe(true);
    expect(hasCyrillic('b as in book — беба')).toBe(true);
    expect(hasCyrillic('as in book')).toBe(false);
    expect(hasCyrillic('')).toBe(false);
  });
});
