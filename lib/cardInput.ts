/**
 * The editable shape of a card, plus the parsing and validation around it.
 *
 * This module is deliberately free of Supabase and React Native imports: it is
 * the piece of the add-word flow that can be unit-tested, and it is what stands
 * between a hand-typed form and an `insert into public.cards`.
 */

import { latToCyr } from '@/lib/transliterate';

/** `public.cards` minus the columns the database or the server owns. */
export interface CardInput {
  sr_cyr: string;
  en: string;
  pos: string;
  gender: string | null;
  aspect: string | null;
  example_cyr: string;
  example_en: string;
  domain: string;
}

/**
 * The column has no check constraint — these are the choices the picker offers,
 * not a rule.
 */
export const CARD_DOMAINS = [
  'family',
  'baby',
  'home',
  'food',
  'greetings-courtesy',
  'verbs-core',
  'adjectives-core',
  'numbers-time',
  'everyday-objects',
  'phrases',
] as const;

/** The parts of speech the picker offers. */
export const CARD_POS = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'number',
  'interjection',
  'phrase',
] as const;

export const CARD_GENDERS = ['m', 'f', 'n'] as const;

/**
 * The verb aspect, as `cards.aspect` stores it. The stored values are the
 * linguists' — they are what the seed deck holds and what the review screen's
 * metadata row prints — but nothing in the *form* says them out loud; see
 * `CARD_ASPECT_LABELS`.
 */
export const CARD_ASPECTS = ['impf', 'pf'] as const;

/**
 * What the picker calls each aspect.
 *
 * "impf" and "pf" are exactly the linguistic jargon this app is meant not to
 * make a beginner learn: the app is English chrome over Serbian content, and a
 * label a learner has to look up is chrome that failed. The distinction itself
 * is worth having — it is the difference between "I was reading" and "I read
 * it" — so it is said in the words that describe it rather than the words that
 * name it. The stored values are untouched.
 */
export const CARD_ASPECT_LABELS: Readonly<Record<(typeof CARD_ASPECTS)[number], string>> = {
  impf: 'ongoing',
  pf: 'one-off',
};

/** The one line under the picker that says what the two choices mean. */
export const CARD_ASPECT_HINT = 'ongoing = happening or repeated · one-off = done once';

export const EMPTY_CARD_INPUT: CardInput = {
  sr_cyr: '',
  en: '',
  pos: '',
  gender: null,
  aspect: null,
  example_cyr: '',
  example_en: '',
  domain: '',
};

/** Fields a card cannot be saved without. */
const REQUIRED_FIELDS = [
  'sr_cyr',
  'en',
  'pos',
  'example_cyr',
  'example_en',
  'domain',
] as const satisfies readonly (keyof CardInput)[];

const CYRILLIC = /\p{Script=Cyrillic}/u;

function optional(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Whitespace off every field; blank optionals become null (the column default). */
export function trimCardInput(input: CardInput): CardInput {
  return {
    sr_cyr: input.sr_cyr.trim(),
    en: input.en.trim(),
    pos: input.pos.trim(),
    gender: optional(input.gender),
    aspect: optional(input.aspect),
    example_cyr: input.example_cyr.trim(),
    example_en: input.example_en.trim(),
    domain: input.domain.trim(),
  };
}

/**
 * Per-field problems, keyed by field name. An empty object means the card is
 * ready to save. The messages are shown verbatim under the inputs.
 */
export function cardInputErrors(input: CardInput): Partial<Record<keyof CardInput, string>> {
  const card = trimCardInput(input);
  const errors: Partial<Record<keyof CardInput, string>> = {};

  for (const field of REQUIRED_FIELDS) {
    if (card[field] === '') errors[field] = 'Required.';
  }

  // The whole app assumes `sr_cyr` is Cyrillic: the review screen shows it big,
  // and search derives the Latin form from it. A Latin headword would quietly
  // break both.
  if (card.sr_cyr !== '' && !CYRILLIC.test(card.sr_cyr)) {
    errors.sr_cyr = 'Must be written in Cyrillic.';
  }

  return errors;
}

/**
 * A headword in Cyrillic, whichever script it was typed in. Anything already
 * containing Cyrillic is left alone (`latToCyr` would mangle it); anything else
 * is transliterated, so "kasika" and "кашика" are the same word to the app.
 */
export function toCyrillicHeadword(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '' || CYRILLIC.test(trimmed)) return trimmed;
  return latToCyr(trimmed);
}
