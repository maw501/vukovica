/**
 * Finding the Serbian inside a mixed string.
 *
 * Plenty of the app's content is one string in two languages: a letter mnemonic
 * ("b as in book — беба (baby)"), a grammar prompt ("I love — ја ___ (волети)"),
 * a topic title ("To be — сам / јесам (present)"), the Books goal ("Read Погоди
 * колико те волим to your son"). The three-script styling has to reach inside
 * those, not just around them, or the one line where the Serbian actually
 * appears is the one line that does not look like Serbian.
 *
 * Pure and free of React Native imports on purpose: this is the piece worth
 * testing, and `components/ScriptText.tsx` is only the rendering of it.
 */

/** Which of the three kinds of text a run is. */
export type ScriptRole = 'cyr' | 'lat' | 'en';

/** One stretch of a mixed string, and whether it is the Cyrillic. */
export interface ScriptSegment {
  text: string;
  /** True for a Serbian Cyrillic run; false for everything around it. */
  cyrillic: boolean;
}

/** Cyrillic and Cyrillic Supplement — Ѐ (U+0400) to ӿ (U+04FF). */
const CYRILLIC = '[\\u0400-\\u04FF]';

/**
 * What may sit *between* two Cyrillic words without ending the run: spaces, the
 * punctuation Serbian sets inside a sentence, and the guillemets a title is
 * quoted in. Deliberately excludes brackets and the drill's `___` blank, which
 * is what keeps "ја ___ (волети)" three pieces rather than one.
 */
const JOINER = "[ \\u00A0.,;:!?\\u2018\\u2019'\\-\\u2010-\\u2015\\u00AB\\u00BB\\u201E\\u201C\\u201D]";

/**
 * A Cyrillic run: one or more Cyrillic words, joined across the punctuation
 * between them, optionally wrapped in the quotes Serbian uses («…», „…“).
 *
 * The trailing `[»“”]?` and leading `[«„]?` are what pull the guillemets into
 * the run rather than leaving them in the English around it — a quotation mark
 * in the wrong face is exactly the sort of small wrongness that reads as a bug.
 */
const CYRILLIC_RUN = new RegExp(
  `[\\u00AB\\u201E]?${CYRILLIC}+(?:${JOINER}*${CYRILLIC}+)*[\\u00BB\\u201C\\u201D]?`,
  'g',
);

/**
 * Cut `text` into alternating non-Cyrillic and Cyrillic segments, in order,
 * tiling the input exactly: joining every `text` back together returns the
 * original string, whatever went in.
 *
 * An empty string yields no segments; a string with no Cyrillic in it yields
 * one; a string that is nothing but Cyrillic yields one.
 */
export function splitScriptRuns(text: string): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  let cut = 0;

  for (const match of text.matchAll(CYRILLIC_RUN)) {
    const start = match.index ?? 0;
    if (start > cut) segments.push({ text: text.slice(cut, start), cyrillic: false });
    segments.push({ text: match[0], cyrillic: true });
    cut = start + match[0].length;
  }

  if (cut < text.length) segments.push({ text: text.slice(cut), cyrillic: false });
  return segments;
}

/** Whether a string has any Serbian Cyrillic in it at all. */
export function hasCyrillic(text: string): boolean {
  return new RegExp(CYRILLIC).test(text);
}
