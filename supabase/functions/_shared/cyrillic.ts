/**
 * Script guards for anything a model writes into the reader.
 *
 * Ported from the seed deck's character class (`lib/__tests__/seed-deck.test.ts`),
 * which is the deck's definition of "Serbian Cyrillic": the thirty letters plus
 * the punctuation short text legitimately needs, and deliberately NOT digits and
 * NOT a single Latin letter — a stray `a` or `e` from an English keyboard is
 * exactly the failure worth catching, because in Cyrillic context it looks
 * identical to `а`/`е` and silently breaks the one thing the reader is for.
 *
 * Imported by Deno (Edge Functions, via `./cyrillic.ts`) AND by Node (vitest,
 * via `../cyrillic`), so it stays zero-dependency and runtime-neutral.
 */

/** The thirty letters of the Serbian Cyrillic alphabet, both cases. */
const LETTERS = 'абвгдђежзијклљмнњопрстћуфхцчџшАБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ';

/**
 * The punctuation running prose is allowed. Wider than the seed deck's set
 * (which covers four-to-eight-word example sentences) by the marks a story
 * needs: Serbian quotation marks, the dialogue dash, an ellipsis, brackets,
 * colon and semicolon. Typographic quotes and the non-breaking space are in too
 * — a model emits them routinely, and rejecting a good story over a curly
 * apostrophe would be a guard doing harm rather than work.
 *
 * Written as escapes rather than literals throughout: half of these are
 * invisible or indistinguishable on screen, and a character class is not the
 * place to be guessing which quote is which.
 */
const PUNCTUATION = [
  ' ', // space
  '\\u00A0', // non-breaking space
  '.,!?:;',
  "'", // apostrophe
  '"', // straight double quote
  '\\u201E\\u201C\\u201D', // „ “ ”
  '\\u2018\\u2019', // ‘ ’
  '\\u00AB\\u00BB', // « »
  '()',
  '\\u2026', // ellipsis
  '\\u2013\\u2014', // en dash, em dash
  '\\-', // hyphen, escaped so a following \r cannot make it a range
].join('');

/**
 * One line of Cyrillic — a title, or a single word. No newlines.
 * Exported so a zod schema can enforce the same rule with `.regex()`; it has no
 * `g` flag, so it holds no state and is safe to share.
 */
export const CYRILLIC_LINE = new RegExp(`^[${LETTERS}${PUNCTUATION}]+$`);

/** Running Cyrillic prose — a story body. Newlines separate its paragraphs. */
const PROSE = new RegExp(`^[${LETTERS}${PUNCTUATION}\\r\\n]+$`);

/** True when `value` is a single line of Serbian Cyrillic and is not blank. */
export function isCyrillicLine(value: string): boolean {
  return value.trim().length > 0 && CYRILLIC_LINE.test(value);
}

/** True when `value` is Serbian Cyrillic prose (newlines allowed) and is not blank. */
export function isCyrillicProse(value: string): boolean {
  return value.trim().length > 0 && PROSE.test(value);
}
