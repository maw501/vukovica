/**
 * The editable shape of a card, plus the parsing and validation around it.
 *
 * This module is deliberately free of Supabase and React Native imports: it is
 * the piece of the add-word flow that can be unit-tested, and it is the only
 * thing standing between an LLM's JSON and an `insert into public.cards`.
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
 * Mirrors `CARD_DOMAINS` in `supabase/functions/_shared/prompts.ts`. The column
 * has no check constraint — these are the choices the picker offers, not a rule.
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

/** Mirrors the `pos` enum in the `generate` function's card schema. */
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
export const CARD_ASPECTS = ['impf', 'pf'] as const;

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

/** Fields that must be present on both the generated and the hand-typed path. */
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

/**
 * A `/generate` `new_card` response as a `CardInput`.
 *
 * The Edge Function validates its own output against a zod schema, but the
 * response still arrives here as untyped JSON over the wire, and a card whose
 * `en` is missing would otherwise be inserted blank. Throws on anything that
 * cannot be shown in the preview form.
 */
export function parseGeneratedCard(value: unknown): CardInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The generated card was not in the expected format.');
  }

  const source = value as Record<string, unknown>;
  const card = { ...EMPTY_CARD_INPUT };

  for (const field of REQUIRED_FIELDS) {
    const raw = source[field];
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new Error(`The generated card is incomplete: "${field}" is missing.`);
    }
    card[field] = raw.trim();
  }

  card.gender = optional(source.gender);
  card.aspect = optional(source.aspect);
  return card;
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
