/**
 * The graded reader's pure logic: turning a story body into tappable words,
 * finding the sentence around a tap, and saying what went wrong in words a
 * person can act on.
 *
 * Free of Supabase and React Native imports on purpose — this is the part of
 * the reader that can be unit-tested, and `lib/errors.ts` (its only import)
 * imports nothing itself.
 */

import { errorMessage } from '@/lib/errors';

/**
 * One piece of a story body.
 *
 * `tappable` is true only for **Cyrillic** words — a run of letters, optionally
 * hyphenated (`црно-бела` is one word, not three tokens). Everything else —
 * punctuation, quotation marks, digits, spaces, newlines, and any word carrying
 * a Latin letter — is a token too, but not one the reader can tap.
 */
export interface Token {
  text: string;
  tappable: boolean;
}

/**
 * A word: letters, with hyphens allowed only *between* letters. Sticky, so it
 * can be matched at a known offset without slicing the string.
 */
const WORD = /\p{L}+(?:-\p{L}+)*/uy;
const WHITESPACE = /\s+/y;
/** Anything that is neither a word character nor whitespace: punctuation, digits. */
const OTHER = /[^\s\p{L}]+/uy;

/**
 * A word made **entirely** of Cyrillic letters (and hyphens).
 *
 * The `story` function refuses to save a body with a Latin letter in it, so in
 * practice every word is Cyrillic — but "in practice" is not a guarantee, and a
 * body inserted by hand, restored from a backup, or written by some future
 * loosening of that check must not produce a tappable Latin word in a view
 * whose whole premise is that there is no Latin in it. A mixed-script word
 * (`бebа`) is untappable too: it is a corruption, and looking it up would send
 * the deck a word that does not exist.
 */
const CYRILLIC_WORD = /^[\p{Script=Cyrillic}-]+$/u;

/** True for the characters that end a sentence. */
const SENTENCE_END = /[.!?…]/u;

/**
 * Split a story body into tokens.
 *
 * The tokens **tile the body exactly**: `tokenize(body).map(t => t.text).join('')`
 * is `body`, whitespace and newlines included. That is what lets the reading
 * view render the whole story as a single `<Text>` with one nested `<Text>` per
 * token — paragraph breaks are simply the tokens that contain a newline, so
 * nothing has to be reassembled, and nothing can silently go missing.
 *
 * Digits are deliberately *not* tappable: "1996" is not a word anyone needs
 * translating. Neither is a word carrying a Latin letter — see `CYRILLIC_WORD`.
 */
export function tokenize(body: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;

  while (at < body.length) {
    // A word is tried first; `WHITESPACE` and `OTHER` are disjoint from it and
    // from each other, so between the three every character is claimed exactly
    // once — which is what makes the tiling lossless.
    const word = match(WORD, body, at);
    if (word !== null) {
      tokens.push({ text: word, tappable: CYRILLIC_WORD.test(word) });
      at += word.length;
      continue;
    }

    const rest = match(WHITESPACE, body, at) ?? match(OTHER, body, at);
    // The `?? body[at]` branch is unreachable: the three classes partition
    // every character. Advancing by one rather than throwing means a future
    // Unicode surprise would cost one odd-looking token, not a blank screen.
    const text = rest ?? body[at];
    tokens.push({ text, tappable: false });
    at += text.length;
  }

  return tokens;
}

/** `pattern` matched at `at`, or null. The pattern must be sticky. */
function match(pattern: RegExp, source: string, at: number): string | null {
  pattern.lastIndex = at;
  return pattern.exec(source)?.[0] ?? null;
}

/**
 * The sentence containing `tokens[index]`: the word in the context that decides
 * what it means, and the context a translation request is filed with.
 *
 * Bounded by sentence-ending punctuation (`. ! ? …`) and by paragraph breaks,
 * so a tap in one paragraph never quotes the one before it. Quotation marks are
 * not boundaries — „Дођи, мацо”, каже беба. is one sentence, which is exactly
 * the kind of line whose grammar needs explaining.
 *
 * Known limit: a Serbian ordinal ("1. мај") would end a sentence early. Seeded
 * texts spell numbers out, so this costs nothing today.
 */
export function sentenceAt(tokens: readonly Token[], index: number): string {
  if (index < 0 || index >= tokens.length) return '';

  let start = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (isBoundary(tokens[i])) {
      start = i + 1;
      break;
    }
  }

  let end = tokens.length - 1;
  for (let i = index; i < tokens.length; i += 1) {
    if (isBoundary(tokens[i])) {
      // A full stop belongs to the sentence it ends; a paragraph break does not
      // belong to anything.
      end = isParagraphBreak(tokens[i]) ? i - 1 : i;
      break;
    }
  }

  return tokens
    .slice(start, end + 1)
    .map((token) => token.text)
    .join('')
    .trim();
}

function isParagraphBreak(token: Token): boolean {
  return !token.tappable && token.text.includes('\n');
}

function isBoundary(token: Token): boolean {
  return !token.tappable && (isParagraphBreak(token) || SENTENCE_END.test(token.text));
}

/**
 * PostgREST's code for "`.single()` asked for one row and got none". On an
 * update under RLS it means the row is not there — or not his.
 */
const NO_ROWS_RETURNED = 'PGRST116';

/**
 * What to tell the reader when "I have finished this" fails.
 *
 * Without this the screen would show PostgREST's own sentence — "JSON object
 * requested, multiple (or no) rows returned" — which describes a serialisation
 * decision, not the thing that happened to the person's story.
 */
export function describeFinishError(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code === NO_ROWS_RETURNED) {
    return 'That story is no longer in your library, so it could not be marked read.';
  }
  return errorMessage(error, 'That could not be saved. Try again.');
}
