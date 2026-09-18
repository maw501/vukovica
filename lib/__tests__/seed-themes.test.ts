/**
 * Validation for `data/phase3/themes.json` — the themed vocabulary Mark asked
 * for on 2026-09-18: clothes, body parts, animals, the things a dad says to a
 * toddler ("bring me the ball", "look at the ducks"), and the toddler-food
 * gaps in the food domain.
 *
 * Same shape and same scrutiny as `seed-deck.test.ts` and `seed-vocab.test.ts`:
 * structure, uniqueness, Cyrillic-only Serbian, gender and aspect where the
 * part of speech demands them, examples that use the headword. Headwords have
 * to miss every card in the other two files, because `cards.sr_cyr` is unique
 * and `seed.mjs` upserts with `ignoreDuplicates` — a collision drops the card
 * silently. And `seed.mjs` has to actually name the file.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { cyrToLat, latToCyr } from "@/lib/transliterate";

import deck from "../../data/seed-deck.json";
import vocab from "../../data/phase3/ghmily-vocab.json";
import themes from "../../data/phase3/themes.json";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const seedScript = readFileSync(
  path.join(repoRoot, "scripts", "seed.mjs"),
  "utf8",
);

const POS_VALUES = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "number",
  "phrase",
  "interjection",
];

/** The themes and the minimum each contributes. `food` tops up the deck's own. */
const DOMAIN_MINIMUMS: Readonly<Record<string, number>> = {
  clothes: 30,
  body: 40,
  animals: 50,
  "toddler-talk": 60,
  food: 20,
};

const CARD_KEYS = [
  "sr_cyr",
  "en",
  "pos",
  "gender",
  "aspect",
  "example_cyr",
  "example_en",
  "domain",
];

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

const cards = themes as Card[];

/**
 * Headwords whose form in the example shares too little with the headword for
 * the prefix heuristic: short nouns whose case ending eats the fourth letter
 * (меда/меду, шака/шаку), a fleeting -a- (нокат/нокте, тесан/тесне), and verbs whose
 * imperative drops the -ти (обути/обуј, пасти/паднеш). Each checked by hand.
 */
const IRREGULAR_STEMS = new Set<string>([
  "бара",
  "гуза",
  "изути",
  "маца",
  "меда",
  "нокат",
  "обути",
  "пасти",
  "пуса",
  "тесан",
  "шака",
  "шапа",
]);

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/**
 * Does `example` contain the headword, or a plausibly inflected form of it?
 * Punctuation is stripped from both sides, so "Јој!" matches "Јој, ...".
 */
function exampleUsesHeadword(headword: string, example: string): boolean {
  const headWords = headword
    .toLowerCase()
    .split(/[\s.,!?-]+/)
    .filter(Boolean);
  const exampleWords = example
    .toLowerCase()
    .split(/[\s.,!?-]+/)
    .filter(Boolean);

  return headWords.some((head) => {
    const required = Math.min(head.length, 4);
    return exampleWords.some((word) => sharedPrefix(head, word) >= required);
  });
}

describe("themed vocabulary", () => {
  it("gives every card exactly the columns `cards` needs, all non-empty", () => {
    for (const card of cards) {
      expect(Object.keys(card).sort()).toEqual([...CARD_KEYS].sort());
      for (const key of [
        "sr_cyr",
        "en",
        "pos",
        "example_cyr",
        "example_en",
        "domain",
      ] as const) {
        expect(typeof card[key], `${card.sr_cyr}.${key}`).toBe("string");
        expect(card[key], `${card.sr_cyr}.${key}`).toBe(card[key].trim());
        expect(card[key], `${card.sr_cyr}.${key}`).not.toBe("");
      }
    }
  });

  it("uses only the agreed part-of-speech vocabulary", () => {
    for (const card of cards) {
      expect(POS_VALUES, card.sr_cyr).toContain(card.pos);
    }
  });

  it("files every card under one of the themes and meets each minimum", () => {
    for (const card of cards) {
      expect(Object.keys(DOMAIN_MINIMUMS), card.sr_cyr).toContain(card.domain);
    }
    for (const [domain, minimum] of Object.entries(DOMAIN_MINIMUMS)) {
      const count = cards.filter((card) => card.domain === domain).length;
      expect(count, `domain ${domain}`).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("never repeats a headword, which is a unique column", () => {
    expect(new Set(cards.map((card) => card.sr_cyr)).size).toBe(cards.length);
  });

  it("never collides with the starter deck or the book vocabulary", () => {
    const elsewhere = new Set(
      [...(deck as Card[]), ...(vocab as Card[])].map((card) => card.sr_cyr),
    );
    expect(
      cards
        .filter((card) => elsewhere.has(card.sr_cyr))
        .map((card) => card.sr_cyr),
    ).toEqual([]);
  });

  it("writes headwords and examples in Serbian Cyrillic only", () => {
    for (const card of cards) {
      expect(card.sr_cyr, `sr_cyr ${card.sr_cyr}`).toMatch(SERBIAN_CYRILLIC);
      expect(card.example_cyr, `example_cyr of ${card.sr_cyr}`).toMatch(
        SERBIAN_CYRILLIC,
      );
    }
  });

  it("round-trips every headword and example through the Latin script", () => {
    for (const card of cards) {
      expect(latToCyr(cyrToLat(card.sr_cyr)), `sr_cyr ${card.sr_cyr}`).toBe(
        card.sr_cyr,
      );
      expect(
        latToCyr(cyrToLat(card.example_cyr)),
        `example_cyr of ${card.sr_cyr}`,
      ).toBe(card.example_cyr);
    }
  });

  it("gives every noun a gender and no other part of speech one", () => {
    for (const card of cards) {
      if (card.pos === "noun") {
        expect(["m", "f", "n"], `gender of ${card.sr_cyr}`).toContain(
          card.gender,
        );
      } else {
        expect(card.gender, `gender of ${card.sr_cyr}`).toBeNull();
      }
    }
  });

  it("gives every verb an aspect and no other part of speech one", () => {
    for (const card of cards) {
      if (card.pos === "verb") {
        expect(["pf", "impf"], `aspect of ${card.sr_cyr}`).toContain(
          card.aspect,
        );
      } else {
        expect(card.aspect, `aspect of ${card.sr_cyr}`).toBeNull();
      }
    }
  });

  it("keeps examples short and ends them with terminal punctuation", () => {
    for (const card of cards) {
      const words = card.example_cyr.split(/\s+/).filter(Boolean);
      expect(words.length, `example of ${card.sr_cyr}`).toBeLessThanOrEqual(10);
      expect(card.example_cyr.slice(-1), `example of ${card.sr_cyr}`).toMatch(
        /[.!?]/,
      );
    }
  });

  it("uses the headword (or an inflected form) in its own example", () => {
    const misses = cards
      .filter((card) => !IRREGULAR_STEMS.has(card.sr_cyr))
      .filter((card) => !exampleUsesHeadword(card.sr_cyr, card.example_cyr))
      .map((card) => `${card.sr_cyr} -> ${card.example_cyr}`);
    expect(misses).toEqual([]);
  });

  it("keeps the irregular-stem allow list free of stale entries", () => {
    const headwords = new Set(cards.map((card) => card.sr_cyr));
    expect([...IRREGULAR_STEMS].filter((word) => !headwords.has(word))).toEqual(
      [],
    );
  });

  it("writes English glosses without Cyrillic", () => {
    for (const card of cards) {
      expect(card.en, `en of ${card.sr_cyr}`).not.toMatch(/[Ѐ-ӿ]/);
      expect(card.example_en, `example_en of ${card.sr_cyr}`).not.toMatch(
        /[Ѐ-ӿ]/,
      );
    }
  });

  it("is seeded by seed.mjs, after the starter deck", () => {
    // New themes queue behind the starter deck in `created_at` order, so the
    // beginner path (family, baby, home) still comes first for new cards.
    const deckAt = seedScript.indexOf("'seed-deck.json'");
    const themesAt = seedScript.indexOf("'themes.json'");
    expect(themesAt).toBeGreaterThan(deckAt);
  });
});
