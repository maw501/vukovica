import { describe, expect, it } from 'vitest';

import {
  EMPTY_CARD_INPUT,
  cardInputErrors,
  toCyrillicHeadword,
  trimCardInput,
  type CardInput,
} from '@/lib/cardInput';

/** A complete, well-formed card. */
const valid: CardInput = {
  sr_cyr: 'кашика',
  en: 'spoon',
  pos: 'noun',
  gender: 'f',
  aspect: null,
  example_cyr: 'Дај ми кашику, молим те.',
  example_en: 'Pass me the spoon, please.',
  domain: 'food',
};

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
