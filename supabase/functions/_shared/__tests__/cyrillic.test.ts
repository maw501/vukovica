import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isCyrillicLine, isCyrillicProse } from '../cyrillic';

/**
 * The graded reader's whole point is decoding Cyrillic, so a story with a stray
 * Latin letter in it is not a slightly imperfect story — it is a broken one, and
 * it must never reach the database. These guards are the port of the seed-deck
 * character class (`lib/__tests__/seed-deck.test.ts`), widened only by what
 * running prose legitimately needs: quotes, dashes, ellipsis, newlines.
 */
describe('isCyrillicLine', () => {
  it('accepts a Serbian Cyrillic title', () => {
    expect(isCyrillicLine('Мачка и беба')).toBe(true);
    expect(isCyrillicLine('Ђурђевак, љубав и џеп')).toBe(true);
  });

  it('accepts the punctuation a title legitimately carries', () => {
    expect(isCyrillicLine('Где је мама?')).toBe(true);
    expect(isCyrillicLine('„Лаку ноћ”')).toBe(true);
    expect(isCyrillicLine('Мама, тата и ја!')).toBe(true);
  });

  it('rejects Latin letters, however few', () => {
    expect(isCyrillicLine('Macka i beba')).toBe(false);
    // A single Latin `a` hiding among Cyrillic is the realistic failure.
    expect(isCyrillicLine('Мaчка и беба')).toBe(false);
  });

  it('rejects digits — a children\'s story spells its numbers out', () => {
    expect(isCyrillicLine('Три мачке')).toBe(true);
    expect(isCyrillicLine('3 мачке')).toBe(false);
  });

  it('rejects empty and whitespace-only input', () => {
    expect(isCyrillicLine('')).toBe(false);
    expect(isCyrillicLine('   ')).toBe(false);
  });

  it('rejects a newline: a title is one line', () => {
    expect(isCyrillicLine('Мачка\nи беба')).toBe(false);
  });
});

describe('isCyrillicProse', () => {
  const STORY = `Мама и беба су код куће.
Мачка спава на столици.

„Где је тата?” пита беба.
Тата долази — доноси млеко и хлеб.`;

  it('accepts a multi-paragraph Cyrillic story', () => {
    expect(isCyrillicProse(STORY)).toBe(true);
  });

  it('accepts the quotes, dashes and ellipsis prose uses', () => {
    expect(isCyrillicProse('Беба каже: „Мама...” — и смеје се.')).toBe(true);
    expect(isCyrillicProse('Мама и тата (и мачка) иду кући.')).toBe(true);
    expect(isCyrillicProse('Спава; сања.')).toBe(true);
  });

  it('accepts typographic quotes and a non-breaking space', () => {
    // Models emit these routinely. Rejecting a good story over one would be a
    // guard doing harm rather than work. Written as escapes, not pasted: a
    // non-breaking space is invisible in a diff and a curly quote is near enough.
    expect(isCyrillicProse('\u041cама\u00a0и беба.')).toBe(true);
    expect(isCyrillicProse('\u2018Мацо\u2019 \u201cМацо\u201d')).toBe(true);
    expect(isCyrillicProse('\u00abМацо\u00bb')).toBe(true);
  });

  it('rejects a story with any Latin in it', () => {
    expect(isCyrillicProse(`${STORY}\n\nThe end.`)).toBe(false);
    expect(isCyrillicProse(`${STORY}\n\n(Latin: Mama i beba.)`)).toBe(false);
  });

  it('rejects an empty or whitespace-only body', () => {
    expect(isCyrillicProse('')).toBe(false);
    expect(isCyrillicProse('\n\n  \n')).toBe(false);
  });

  it('rejects emoji and other stray symbols', () => {
    expect(isCyrillicProse('Мачка спава \u{1F63A}')).toBe(false);
    expect(isCyrillicProse('Мачка & беба')).toBe(false);
  });
});

describe('cyrillic.ts portability', () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cyrillic.ts'),
    'utf8',
  );

  // Imported by both Deno (Edge Functions) and Node (vitest), same rule as
  // prompts.ts: zero dependencies, no runtime globals.
  it('has no imports at all', () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it('references no Deno or Node globals', () => {
    expect(source).not.toMatch(/\bDeno\./);
    expect(source).not.toMatch(/\bprocess\./);
    expect(source).not.toMatch(/npm:/);
  });
});
