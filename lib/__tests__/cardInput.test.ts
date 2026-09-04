import { describe, expect, it } from 'vitest';

import {
  CARD_ASPECTS,
  CARD_ASPECT_HINT,
  CARD_ASPECT_LABELS,
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

/**
 * The form's wording, not its data. `cards.aspect` still stores "impf" / "pf" —
 * the seed deck is full of them and the review screen prints them as metadata —
 * but a beginner filling in a card should never be asked to know what they mean.
 */
describe('the verb-type labels', () => {
  it('names every stored aspect', () => {
    for (const aspect of CARD_ASPECTS) {
      expect(CARD_ASPECT_LABELS[aspect]).toBeTruthy();
    }
    expect(Object.keys(CARD_ASPECT_LABELS).sort()).toEqual([...CARD_ASPECTS].sort());
  });

  it('says them in English rather than in grammar', () => {
    const wording = [...Object.values(CARD_ASPECT_LABELS), CARD_ASPECT_HINT].join(' ');
    for (const jargon of ['impf', 'pf', 'aspect', 'perfective', 'imperfective']) {
      expect(wording.toLowerCase()).not.toContain(jargon);
    }
  });

  it('keeps the stored values themselves untouched', () => {
    // The labels are a display concern only: changing these would need a data
    // migration and would break `data/seed-deck.json`.
    expect([...CARD_ASPECTS]).toEqual(['impf', 'pf']);
  });

  it('explains the two choices in one line', () => {
    for (const label of Object.values(CARD_ASPECT_LABELS)) {
      expect(CARD_ASPECT_HINT).toContain(label);
    }
  });
});
