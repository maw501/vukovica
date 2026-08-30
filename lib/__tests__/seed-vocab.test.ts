/**
 * Validation for `data/phase3/ghmily-vocab.json` — the 43 cards that make the
 * first book's words tappable — and for the seed script that loads them.
 *
 * The vocabulary is hand-written teaching content with the same shape as
 * `data/seed-deck.json`, so it gets the same scrutiny (`seed-deck.test.ts`):
 * structure, uniqueness, Cyrillic-only Serbian, gender and aspect where the
 * part of speech demands them. Two things are new here. The headwords have to
 * miss all 681 in the starter deck, because `cards.sr_cyr` is unique and a
 * collision would silently drop the card (`ignoreDuplicates`). And the file has
 * to actually be seeded — nothing else notices if `scripts/seed.mjs` stops
 * naming it, since the script reads its sources by path at runtime.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { cyrToLat, latToCyr } from '@/lib/transliterate';

import deck from '../../data/seed-deck.json';
import vocab from '../../data/phase3/ghmily-vocab.json';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const seedScript = readFileSync(path.join(repoRoot, 'scripts', 'seed.mjs'), 'utf8');

/** The `pos` vocabulary the content is allowed to use. */
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
];

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
];

/** As in `seed-deck.test.ts`: Serbian Cyrillic, spaces, and sentence punctuation. */
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

const cards = vocab as Card[];

describe('the GHMILY vocabulary', () => {
  it('holds the 43 cards the content README promises', () => {
    expect(Array.isArray(cards)).toBe(true);
    expect(cards).toHaveLength(43);
  });

  it('gives every card exactly the columns `cards` needs, all non-empty', () => {
    for (const card of cards) {
      expect(Object.keys(card).sort()).toEqual([...CARD_KEYS].sort());

      for (const key of ['sr_cyr', 'en', 'pos', 'example_cyr', 'example_en', 'domain'] as const) {
        expect(typeof card[key], `${card.sr_cyr}.${key}`).toBe('string');
        expect(card[key].trim(), `${card.sr_cyr}.${key}`).not.toBe('');
        expect(card[key], `${card.sr_cyr}.${key}`).toBe(card[key].trim());
      }
    }
  });

  it('uses only the agreed part-of-speech vocabulary', () => {
    for (const card of cards) {
      expect(POS_VALUES, card.sr_cyr).toContain(card.pos);
    }
  });

  it('files every card under the ghmily domain', () => {
    // One domain per file is what makes "the book's words" a query rather than
    // a list of 43 headwords kept somewhere else.
    for (const card of cards) {
      expect(card.domain, card.sr_cyr).toBe('ghmily');
    }
  });

  it('never repeats a headword, which is a unique column', () => {
    expect(new Set(cards.map((card) => card.sr_cyr)).size).toBe(cards.length);
  });

  it('never collides with the starter deck, which would drop the card silently', () => {
    // `seed.mjs` upserts with `ignoreDuplicates`, so a collision is not an
    // error: the deck's row wins and the book's gloss never arrives. Месец (the
    // moon) is deliberately distinct from the deck's месец (month) — the
    // capital is Serbian orthography, and this is the comparison that keeps
    // that distinction honest.
    const inDeck = new Set((deck as Card[]).map((card) => card.sr_cyr));
    expect(cards.filter((card) => inDeck.has(card.sr_cyr)).map((card) => card.sr_cyr)).toEqual([]);
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

  it('keeps examples short and ends them with terminal punctuation', () => {
    for (const card of cards) {
      const words = card.example_cyr.split(/\s+/).filter(Boolean);
      expect(words.length, `example of ${card.sr_cyr}`).toBeGreaterThan(0);
      expect(words.length, `example of ${card.sr_cyr}`).toBeLessThanOrEqual(10);
      expect(card.example_cyr.slice(-1), `example of ${card.sr_cyr}`).toMatch(/[.!?]/);
    }
  });

  it('writes English glosses without Cyrillic', () => {
    for (const card of cards) {
      expect(card.en, `en of ${card.sr_cyr}`).not.toMatch(/[Ѐ-ӿ]/);
      expect(card.example_en, `example_en of ${card.sr_cyr}`).not.toMatch(/[Ѐ-ӿ]/);
    }
  });
});

describe('the deck seed script', () => {
  it("seeds both card files, the book's vocabulary first", () => {
    // Seeding order is queue order (`api.fetchNewCards` sorts on `created_at`),
    // so this is the only thing that notices if the book's 43 words stop coming
    // first — which would push reading "Погоди колико те волим" with his son,
    // the stated first goal, 681 cards down the queue.
    const vocabAt = seedScript.indexOf("'ghmily-vocab.json'");
    const deckAt = seedScript.indexOf("'seed-deck.json'");
    expect(vocabAt).toBeGreaterThan(-1);
    expect(deckAt).toBeGreaterThan(vocabAt);
  });

  it('lets both files land in the word deck by leaving `kind` to its default', () => {
    // `cards.kind` defaults to 'word'; the letters are seeded by migration.
    // Setting a kind here is how these rows would end up in the letters deck.
    expect(seedScript).not.toContain('kind:');
    expect(seedScript).toContain("onConflict: 'sr_cyr'");
    expect(seedScript).toContain('ignoreDuplicates: true');
  });
});
