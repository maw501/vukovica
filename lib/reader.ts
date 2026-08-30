/**
 * The graded reader's pure logic: turning a story body into tappable words,
 * finding the sentence around a tap, choosing a difficulty level, and saying
 * what went wrong in words a person can act on.
 *
 * Free of Supabase and React Native imports on purpose — this is the part of
 * the reader that can be unit-tested, and `lib/errors.ts` (its only import)
 * imports nothing itself.
 */

import { describeEdgeError, EdgeFunctionError } from '@/lib/errors';

/**
 * One piece of a story body.
 *
 * `tappable` is true only for words — a run of letters, optionally hyphenated
 * (`црно-бела` is one word, not three tokens). Everything else — punctuation,
 * quotation marks, digits, spaces and newlines — is a token too, but not one
 * the reader can tap.
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
 * Digits are deliberately *not* tappable: the story prompt spells numbers out,
 * and sending "1996" to the gloss endpoint would spend a model call on nothing.
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
      tokens.push({ text: word, tappable: true });
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
 * The sentence containing `tokens[index]`, as the gloss endpoint wants it: the
 * word in the context that decides what it means.
 *
 * Bounded by sentence-ending punctuation (`. ! ? …`) and by paragraph breaks,
 * so a tap in one paragraph never quotes the one before it. Quotation marks are
 * not boundaries — „Дођи, мацо”, каже беба. is one sentence, which is exactly
 * the kind of line whose grammar needs explaining.
 *
 * Known limit: a Serbian ordinal ("1. мај") would end a sentence early. The
 * generator spells numbers out, so this costs nothing today.
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

/** The three difficulty bands a story can be generated at (`stories.level`). */
export type StoryLevel = 1 | 2 | 3;

/** The levels a picker offers, in order. */
export const STORY_LEVELS: readonly StoryLevel[] = [1, 2, 3];

/** What each band means to someone choosing one, in a handful of words. */
export const STORY_LEVEL_BLURB: Record<StoryLevel, string> = {
  1: 'Very short, present tense',
  2: 'Longer, short sentences',
  3: 'A full little story',
};

/**
 * One tapped word explained, as the `gloss` mode of the `generate` function
 * returns it.
 */
export interface Gloss {
  /** The dictionary form — what the "у шпил" button seeds a card with. */
  base_form_cyr: string;
  en: string;
  /** Why the word looks the way it does here. May be empty. */
  note: string;
}

/**
 * Validate a gloss payload before it reaches the screen.
 *
 * The Edge Function validates its own output, but `callEdgeFunction` returns an
 * unchecked cast, and a missing field would render as the word "undefined" in
 * the sheet rather than as an error anyone could act on.
 */
export function parseGloss(value: unknown): Gloss {
  const source = (value ?? {}) as Record<string, unknown>;
  const base_form_cyr = typeof source.base_form_cyr === 'string' ? source.base_form_cyr.trim() : '';
  const en = typeof source.en === 'string' ? source.en.trim() : '';
  if (!base_form_cyr || !en) {
    throw new Error('The gloss came back incomplete. Try that word again.');
  }
  return {
    base_form_cyr,
    en,
    // The note is genuinely optional — plenty of words need no explaining.
    note: typeof source.note === 'string' ? source.note.trim() : '',
  };
}

/**
 * The level to offer for the next story, from how many words the learner knows
 * (spec §3.3: level 1 until 300 known, then 2, then 3).
 *
 * A suggestion, never a rule — the picker lets him choose anything.
 */
export function suggestedLevel(knownWords: number): StoryLevel {
  if (!Number.isFinite(knownWords) || knownWords < 300) return 1;
  if (knownWords < 600) return 2;
  return 3;
}

/**
 * The one 502 that really is "somebody has to go and fix something". Shared by
 * both describers so the two can never drift into saying it differently.
 */
const AI_UNREACHABLE = 'The AI could not be reached. Check the server’s API key, then try again.';

/**
 * What to tell the reader when a tap-to-gloss call fails.
 *
 * The two 502s mean opposite things and must never be collapsed:
 *   - `provider_error` — the AI was not reachable (a stale key, an outage).
 *     Something has to be fixed before *any* gloss will work.
 *   - `invalid_gloss` — the AI answered, but with a base form that was not
 *     Cyrillic. The key is FINE; the same word may well work on a retry, and
 *     sending the user off to check a key that is not broken is worse than
 *     saying nothing.
 */
export function describeGlossError(error: unknown): string {
  if (error instanceof EdgeFunctionError && error.status === 502) {
    if (error.code === 'invalid_gloss') {
      return 'The AI could not gloss that word. Try again, or tap another word.';
    }
    return AI_UNREACHABLE;
  }
  return describeEdgeError(error);
}

/**
 * What to tell the reader when generating a story fails. Same split as the
 * gloss: `invalid_story` means the model wrote Latin script and the story was
 * thrown away before it was ever saved — a retry is the right move, and the key
 * is not the problem.
 */
export function describeStoryError(error: unknown): string {
  if (error instanceof EdgeFunctionError && error.status === 502) {
    if (error.code === 'invalid_story') {
      return 'The AI wrote that story in the wrong script, so it was thrown away. Try again.';
    }
    return AI_UNREACHABLE;
  }
  return describeEdgeError(error);
}
