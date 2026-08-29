/**
 * Validation for `data/seed-deck.json` — the shipped starter deck.
 *
 * The deck is hand-written teaching content, so these assertions are the only
 * thing standing between a typo and a card the learner drills every day. They
 * check structure (schema, uniqueness, per-domain counts) and language
 * mechanics (Cyrillic-only, transliteration round-trip, gender/aspect present
 * where the part of speech demands it, examples that actually use the word).
 */

import { describe, expect, it } from 'vitest';

import { cyrToLat, latToCyr } from '@/lib/transliterate';

import deck from '../../data/seed-deck.json';

/** The `pos` vocabulary the deck is allowed to use. */
const POS_VALUES = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'preposition',
  'conjunction',
  'number',
  'phrase',
  'interjection',
] as const;

/** Domains and the minimum number of cards each must contribute. */
const DOMAIN_MINIMUMS: Readonly<Record<string, number>> = {
  family: 60,
  baby: 50,
  home: 60,
  food: 80,
  'greetings-courtesy': 40,
  'verbs-core': 80,
  'adjectives-core': 50,
  'numbers-time': 50,
  'everyday-objects': 50,
  phrases: 80,
};

const TOTAL_MINIMUM = 550;

/** Every key a card object may have, and no others. */
const CARD_KEYS = [
  'sr_cyr',
  'en',
  'pos',
  'gender',
  'aspect',
  'example_cyr',
  'example_en',
  'domain',
] as const;

/**
 * Serbian Cyrillic letters, spaces and the punctuation a short example
 * sentence legitimately needs. Deliberately excludes digits and every Latin
 * letter, so a stray `a` or `e` pasted from an English keyboard is caught.
 */
const SERBIAN_CYRILLIC =
  /^[абвгдђежзијклљмнњопрстћуфхцчџшАБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ .,!?'-]+$/;

interface Card {
  sr_cyr: string;
  en: string;
  pos: string;
  gender: string | null;
  aspect: string | null;
  example_cyr: string;
  example_en: string;
  domain: string;
}

const cards = deck as Card[];

/**
 * Headwords whose inflected forms in the example sentence are too irregular
 * for the prefix heuristic below (suppletive stems, palatalisation, pronouns
 * with oblique cases). Each has been checked by hand.
 */
const IRREGULAR_STEMS = new Set<string>([
  // Suppletive or heavily alternating verb stems: the infinitive and the
  // conjugated form in the example share almost no leading letters
  // (бити/сам, ићи/идем, јести/једе, рећи/кажем, сести/седи ...).
  'бити',
  'видети',
  'доћи',
  'јести',
  'ићи',
  'моћи',
  'отићи',
  'рећи',
  'сести',
  'стићи',
  'хтети',
  'чути',
  // Adjectives and numerals with a fleeting -a-, which drops out of every
  // form but the masculine singular (ружан/ружно, мокар/мокра, један/једно).
  'један',
  'миран',
  'мокар',
  'ружан',
  'тужан',
]);

/** Length of the shared leading substring of two words. */
function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/** Does `example` contain the headword, or a plausibly inflected form of it? */
function exampleUsesHeadword(headword: string, example: string): boolean {
  const headWords = headword.toLowerCase().split(/[\s-]+/).filter(Boolean);
  const exampleWords = example.toLowerCase().split(/[\s.,!?-]+/).filter(Boolean);

  return headWords.some((head) => {
    const required = Math.min(head.length, 4);
    return exampleWords.some((word) => sharedPrefix(head, word) >= required);
  });
}

describe('seed deck', () => {
  it('is a non-empty array of at least the minimum number of cards', () => {
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBeGreaterThanOrEqual(TOTAL_MINIMUM);
  });

  it('gives every card exactly the expected keys with the expected types', () => {
    for (const card of cards) {
      expect(Object.keys(card).sort()).toEqual([...CARD_KEYS].sort());

      for (const key of ['sr_cyr', 'en', 'pos', 'example_cyr', 'example_en', 'domain'] as const) {
        expect(typeof card[key], `${card.sr_cyr}.${key}`).toBe('string');
        expect(card[key].trim(), `${card.sr_cyr}.${key}`).not.toBe('');
        expect(card[key], `${card.sr_cyr}.${key}`).toBe(card[key].trim());
      }

      for (const key of ['gender', 'aspect'] as const) {
        const value = card[key];
        expect(value === null || typeof value === 'string', `${card.sr_cyr}.${key}`).toBe(true);
      }
    }
  });

  it('uses only the agreed part-of-speech vocabulary', () => {
    for (const card of cards) {
      expect(POS_VALUES, card.sr_cyr).toContain(card.pos);
    }
  });

  it('uses only the agreed domains', () => {
    for (const card of cards) {
      expect(Object.keys(DOMAIN_MINIMUMS), card.sr_cyr).toContain(card.domain);
    }
  });

  it('has a unique sr_cyr for every card', () => {
    const seen = new Map<string, number>();
    for (const card of cards) {
      seen.set(card.sr_cyr, (seen.get(card.sr_cyr) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
    expect(duplicates).toEqual([]);
  });

  it('meets the per-domain minimum counts', () => {
    for (const [domain, minimum] of Object.entries(DOMAIN_MINIMUMS)) {
      const count = cards.filter((card) => card.domain === domain).length;
      expect(count, `domain ${domain}`).toBeGreaterThanOrEqual(minimum);
    }
  });

  it('writes headwords and examples in Serbian Cyrillic only', () => {
    for (const card of cards) {
      expect(card.sr_cyr, `sr_cyr ${card.sr_cyr}`).toMatch(SERBIAN_CYRILLIC);
      expect(card.example_cyr, `example_cyr of ${card.sr_cyr}`).toMatch(SERBIAN_CYRILLIC);
    }
  });

  it('round-trips every headword and example through the Latin script', () => {
    for (const card of cards) {
      expect(latToCyr(cyrToLat(card.sr_cyr)), `sr_cyr ${card.sr_cyr}`).toBe(card.sr_cyr);
      expect(latToCyr(cyrToLat(card.example_cyr)), `example_cyr of ${card.sr_cyr}`).toBe(
        card.example_cyr,
      );
    }
  });

  it('gives every noun a gender and no other part of speech one', () => {
    for (const card of cards) {
      if (card.pos === 'noun') {
        expect(['m', 'f', 'n'], `gender of ${card.sr_cyr}`).toContain(card.gender);
      } else {
        expect(card.gender, `gender of ${card.sr_cyr}`).toBeNull();
      }
    }
  });

  it('gives every verb an aspect and no other part of speech one', () => {
    for (const card of cards) {
      if (card.pos === 'verb') {
        expect(['pf', 'impf'], `aspect of ${card.sr_cyr}`).toContain(card.aspect);
      } else {
        expect(card.aspect, `aspect of ${card.sr_cyr}`).toBeNull();
      }
    }
  });

  it('keeps example sentences to ten words or fewer', () => {
    for (const card of cards) {
      const words = card.example_cyr.split(/\s+/).filter(Boolean);
      expect(words.length, `example of ${card.sr_cyr}`).toBeLessThanOrEqual(10);
      expect(words.length, `example of ${card.sr_cyr}`).toBeGreaterThan(0);
    }
  });

  it('ends every example sentence with terminal punctuation', () => {
    for (const card of cards) {
      expect(card.example_cyr.slice(-1), `example of ${card.sr_cyr}`).toMatch(/[.!?]/);
    }
  });

  it('uses the headword (or an inflected form) in its own example', () => {
    const misses = cards
      .filter((card) => !IRREGULAR_STEMS.has(card.sr_cyr))
      .filter((card) => !exampleUsesHeadword(card.sr_cyr, card.example_cyr))
      .map((card) => `${card.sr_cyr} -> ${card.example_cyr}`);
    expect(misses).toEqual([]);
  });

  it('keeps the irregular-stem allow list free of stale entries', () => {
    const headwords = new Set(cards.map((card) => card.sr_cyr));
    const stale = [...IRREGULAR_STEMS].filter((word) => !headwords.has(word));
    expect(stale).toEqual([]);
  });

  it('writes English glosses without Cyrillic', () => {
    for (const card of cards) {
      expect(card.en, `en of ${card.sr_cyr}`).not.toMatch(/[Ѐ-ӿ]/);
      expect(card.example_en, `example_en of ${card.sr_cyr}`).not.toMatch(/[Ѐ-ӿ]/);
    }
  });
});
