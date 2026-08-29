import { describe, expect, it } from 'vitest';

import {
  EMPTY_CARD_INPUT,
  cardInputErrors,
  parseGeneratedCard,
  toCyrillicHeadword,
  trimCardInput,
  type CardInput,
} from '@/lib/cardInput';

/** A well-formed `/generate` `new_card` payload. */
const generated = {
  sr_cyr: 'кашика',
  en: 'spoon',
  pos: 'noun',
  gender: 'f',
  aspect: null,
  example_cyr: 'Дај ми кашику, молим те.',
  example_en: 'Pass me the spoon, please.',
  domain: 'food',
};

const valid: CardInput = { ...generated };

describe('parseGeneratedCard', () => {
  it('accepts a well-formed payload', () => {
    expect(parseGeneratedCard(generated)).toEqual(valid);
  });

  it('trims whitespace on every string field', () => {
    expect(
      parseGeneratedCard({ ...generated, sr_cyr: '  кашика \n', en: ' spoon ' }),
    ).toMatchObject({ sr_cyr: 'кашика', en: 'spoon' });
  });

  it('treats a missing, empty or non-string gender/aspect as null', () => {
    const { gender: _g, aspect: _a, ...withoutOptionals } = generated;
    expect(parseGeneratedCard(withoutOptionals)).toMatchObject({ gender: null, aspect: null });
    expect(parseGeneratedCard({ ...generated, gender: '', aspect: '  ' })).toMatchObject({
      gender: null,
      aspect: null,
    });
    expect(parseGeneratedCard({ ...generated, gender: 7 })).toMatchObject({ gender: null });
  });

  it('keeps a real aspect through', () => {
    expect(parseGeneratedCard({ ...generated, pos: 'verb', aspect: 'impf' })).toMatchObject({
      aspect: 'impf',
    });
  });

  it('ignores unknown extra fields rather than passing them to the insert', () => {
    const parsed = parseGeneratedCard({ ...generated, id: 'nope', audio_path: '/x.mp3' });
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(valid).sort());
  });

  it.each([
    ['null', null],
    ['a string', '"кашика"'],
    ['an array', [generated]],
    ['a number', 42],
  ])('rejects %s', (_label, value) => {
    expect(() => parseGeneratedCard(value)).toThrow();
  });

  it.each(['sr_cyr', 'en', 'pos', 'example_cyr', 'example_en', 'domain'] as const)(
    'rejects a payload with a missing %s',
    (field) => {
      const broken = { ...generated };
      delete (broken as Record<string, unknown>)[field];
      expect(() => parseGeneratedCard(broken)).toThrow(/incomplete|missing|invalid/i);
    },
  );

  it('rejects a payload whose required field is blank', () => {
    expect(() => parseGeneratedCard({ ...generated, en: '   ' })).toThrow();
  });

  it('rejects a payload whose required field is the wrong type', () => {
    expect(() => parseGeneratedCard({ ...generated, sr_cyr: 123 })).toThrow();
  });
});

describe('cardInputErrors', () => {
  it('finds nothing wrong with a complete card', () => {
    expect(cardInputErrors(valid)).toEqual({});
  });

  it('reports every blank required field', () => {
    const errors = cardInputErrors(EMPTY_CARD_INPUT);
    expect(Object.keys(errors).sort()).toEqual(
      ['domain', 'en', 'example_cyr', 'example_en', 'pos', 'sr_cyr'].sort(),
    );
  });

  it('treats whitespace as blank', () => {
    expect(cardInputErrors({ ...valid, en: '  ' })).toHaveProperty('en');
  });

  it('does not require gender or aspect', () => {
    expect(cardInputErrors({ ...valid, gender: null, aspect: null })).toEqual({});
  });

  it('rejects a headword that is not written in Cyrillic', () => {
    expect(cardInputErrors({ ...valid, sr_cyr: 'kasika' })).toHaveProperty('sr_cyr');
  });
});

describe('trimCardInput', () => {
  it('trims strings and nulls out blank optionals', () => {
    expect(trimCardInput({ ...valid, sr_cyr: ' кашика ', gender: ' ', aspect: '' })).toEqual({
      ...valid,
      gender: null,
      aspect: null,
    });
  });
});

describe('toCyrillicHeadword', () => {
  it('transliterates a Latin word so either script can be typed in', () => {
    expect(toCyrillicHeadword('kasika')).toBe('касика');
    expect(toCyrillicHeadword('ćao')).toBe('ћао');
    expect(toCyrillicHeadword('džep')).toBe('џеп');
  });

  it('leaves Cyrillic alone', () => {
    expect(toCyrillicHeadword('кашика')).toBe('кашика');
    expect(toCyrillicHeadword('Београд')).toBe('Београд');
  });

  it('trims', () => {
    expect(toCyrillicHeadword('  мама  ')).toBe('мама');
  });

  it('is empty for an empty input', () => {
    expect(toCyrillicHeadword('   ')).toBe('');
  });
});
