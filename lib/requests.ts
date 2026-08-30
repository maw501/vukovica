/**
 * The capture queue's pure logic.
 *
 * A request is one English phrase Mark wants to be able to say, filed for
 * fulfilment between sessions — there is no translator in the app (phase 3
 * removed the runtime AI), so what the queue holds is the question, and a card
 * is the answer that arrives later.
 *
 * Free of Supabase and React Native imports on purpose: the two decisions worth
 * testing are what counts as an empty request, and exactly how a tapped word is
 * written down as one.
 */

/**
 * Why `text` cannot be filed, or null when it can.
 *
 * Whitespace only is the single rejection. There is no length cap: the column is
 * unbounded `text`, a reader request quotes a whole sentence, and a limit that
 * silently truncated the context would make the request harder to answer, not
 * easier.
 */
export function requestTextError(text: string): string | null {
  if (text.trim() === '') return 'Type what you want to say first.';
  return null;
}

/**
 * How a word tapped in a reading view is written down.
 *
 * The sentence is part of the request, not decoration: `мачка` alone can be
 * answered with one gloss, but the *case* it is in — and so the card worth
 * making — is only decidable from the line it was read in.
 *
 * The exact shape is `"<word>" — in: <sentence>`. A word with no sentence around
 * it (which `sentenceAt` does not produce, but an empty body would) files as the
 * quoted word alone rather than with a dangling "in:".
 */
export function readerRequestText(word: string, sentence: string): string {
  const quoted = `"${word.trim()}"`;
  const context = sentence.trim();
  return context === '' ? quoted : `${quoted} — in: ${context}`;
}
