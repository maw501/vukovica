/**
 * Quick add — the two-box way into the deck, and the rules behind it.
 *
 * The full form (`lib/cardInput.ts`, `components/CardForm.tsx`) asks for eight
 * things, which Mark's verdict was that he would never fill in: the usual
 * occasion for adding a word is his wife saying one at the kitchen table, and
 * what he wants to record is that he knows it. So this module is the smaller
 * contract — a Serbian word and what it means — and `public.quick_add_word`
 * (`supabase/migrations/20260918150000_quick_add.sql`) is what it talks to.
 *
 * Pure and dependency-free, like `lib/library.ts`: `api.ts` reaches
 * `lib/supabase.ts` (and therefore `react-native`), which the Node-based vitest
 * environment cannot load, so everything the screen decides is decided here.
 */

import { toCyrillicHeadword } from '@/lib/cardInput';
import { filterCards, type SearchableCard } from '@/lib/search';

/**
 * The name of `public.quick_add_word`.
 *
 * The name and the argument names here and in the SQL are one contract with no
 * compiler across it: rename one side and PostgREST answers 404 at runtime.
 * `quickAdd.test.ts` parses the migration and compares, which is what stops that
 * happening.
 */
export const QUICK_ADD_FN = 'quick_add_word';

/**
 * The domain a quick-added card is filed under.
 *
 * Not one of the subject domains ("food", "home"): those say what a word is
 * about, and a two-box form has nobody to ask. This one says where the card came
 * from, which is the honest thing it knows and the handle a backfill run uses to
 * find the cards still missing their part of speech, examples and audio.
 */
export const QUICK_ADD_DOMAIN = 'my-words';

export interface QuickAddParams {
  p_sr_cyr: string;
  p_en: string;
}

/**
 * What the function hands back: the card, and whether this call is what put it
 * in the deck.
 *
 * `created` is the function's own answer rather than something the screen works
 * out by looking the id up in the deck it has loaded — that deck may still be in
 * flight, and getting it wrong inverts the one discovery the screen exists to
 * make ("trainers has been in there as патике all along").
 */
export interface QuickAddResult {
  card_id: string;
  created: boolean;
}

/**
 * One quick add as the function's arguments.
 *
 * The Serbian goes through `toCyrillicHeadword`, so "kašika" is sent as
 * "кашика": `sr_cyr` is Cyrillic everywhere in this app — the review screen sets
 * it in the serif, search derives the Latin form from it — and a beginner who
 * cannot yet type Cyrillic should still be able to add a word. Anything already
 * in Cyrillic passes through untouched.
 *
 * Deliberately no `p_user_id`: the function fills `created_by` and `user_id`
 * from `auth.uid()`, so the id never travels on the wire.
 */
export function quickAddParams(sr: string, en: string): QuickAddParams {
  return { p_sr_cyr: toCyrillicHeadword(sr), p_en: en.trim() };
}

/** Which of the two boxes is wrong, and what to say under it. */
export type QuickAddField = 'sr' | 'en';

const CYRILLIC_LETTER = /\p{Script=Cyrillic}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

/**
 * What a headword may be made of: Cyrillic letters, spaces, and the four marks
 * and the apostrophe and hyphen the seeded deck's own headwords use
 * (`lib/__tests__/seed-deck.test.ts` holds the same list).
 *
 * Whole-string, not "contains one": `toCyrillicHeadword` leaves a string that
 * already has any Cyrillic in it *unconverted*, so one slipped keyboard switch
 * halfway through a word gives "кasika" — which passed the old containment test
 * on both sides of the wire and would have gone into the shared deck under a
 * unique `sr_cyr`, where `cyrToLat`, search and the audio batch all assume the
 * headword is pure. `quick_add_word` makes the same check in SQL.
 */
const CYRILLIC_HEADWORD = /^[\p{Script=Cyrillic}\s.,!?'-]+$/u;

/**
 * Per-box problems, keyed by box. An empty object means the word is ready to
 * add. The messages are shown verbatim under the inputs.
 *
 * The script check is made *after* the conversion, exactly as the function
 * checks what it was sent: "kasika" is fine, because it arrives as "касика";
 * "кasika" is not, because half of it never converted; "123" is not, because
 * nothing in it is a letter. Saying so here saves a round trip and puts the
 * message under the box it belongs to, but it is not the only guard.
 */
export function quickAddErrors(sr: string, en: string): Partial<Record<QuickAddField, string>> {
  const errors: Partial<Record<QuickAddField, string>> = {};
  const headword = toCyrillicHeadword(sr);

  if (headword === '') {
    errors.sr = 'Type the Serbian word.';
  } else if (LATIN_LETTER.test(headword)) {
    // Said as the mistake it is — a word half-typed on the other keyboard —
    // rather than as "must be Cyrillic", which is advice he already took.
    errors.sr = 'Type the whole word in one script — Cyrillic or Latin.';
  } else if (!CYRILLIC_HEADWORD.test(headword) || !CYRILLIC_LETTER.test(headword)) {
    errors.sr = 'Use Cyrillic or Latin letters.';
  }

  if (en.trim() === '') {
    errors.en = 'Type what it means in English.';
  }

  return errors;
}

/** True when both boxes are filled in well enough to send. */
export function canQuickAdd(sr: string, en: string): boolean {
  return Object.keys(quickAddErrors(sr, en)).length === 0;
}

/**
 * The one line the screen shows after a word lands: "патике — trainers".
 *
 * Built here rather than in the screen because it is also what a tapped search
 * match says, and the two confirmations saying the same thing in the same shape
 * is the point — either way the word is now in My words.
 */
export function quickAddConfirmation(srCyr: string, en: string): string {
  return `${srCyr} — ${en}`;
}

// ---------------------------------------------------------------------------
// When the database says no
// ---------------------------------------------------------------------------

/** What the screen says when it has nothing better to say. */
export const QUICK_ADD_FAILED = 'Couldn’t save that word. Try again.';

/**
 * A failed `quick_add_word` as a sentence Mark can act on.
 *
 * `errorMessage` passes a `PostgrestError.message` through verbatim, which is
 * the right default everywhere else in the app and quite wrong here: the
 * function's own raises name it and its arguments, so a mistyped word would put
 * `quick_add_word: p_sr_cyr must be a word` on screen — worse than the
 * linguistic jargon the house rules ban, because it is not even English.
 *
 * Matched on the text rather than on `errcode`, because all four of the
 * function's raises share `22023`. The raw message is still worth keeping; the
 * caller logs it to the console.
 */
export function quickAddErrorMessage(error: unknown): string {
  const raw =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';

  if (raw.includes('not as a word')) return 'That’s a letter, not a word.';
  if (raw.includes('not written in Cyrillic') || raw.includes('p_sr_cyr')) {
    return 'Type the word in Serbian first.';
  }
  if (raw.includes('p_en')) return 'Type what it means in English.';
  if (raw.includes('requires an authenticated user')) {
    return 'You are signed out. Sign in and try again.';
  }
  return QUICK_ADD_FAILED;
}

// ---------------------------------------------------------------------------
// What the deck already has
// ---------------------------------------------------------------------------

/**
 * How much has to be typed before the screen starts suggesting, and how many
 * suggestions it shows.
 *
 * One or two letters match half the deck, and a list that long under the box
 * being typed into is noise rather than help. Five is what fits above the
 * keyboard on a phone.
 */
export const QUICK_ADD_MATCH_MIN = 2;
export const QUICK_ADD_MATCH_LIMIT = 5;

/**
 * The deck cards worth showing while the two boxes are being filled in.
 *
 * This is the half of the screen that is not about adding at all. The deck holds
 * 724 words already, and Mark cannot be expected to remember which: typing
 * "trainers" should show him that патике has been in there since the day he
 * installed the app, and one tap puts it in My words without a duplicate card
 * ever existing.
 *
 * Both boxes are searched, Serbian first, because either one may be the one he
 * knows — he heard "патике" and is looking for its meaning, or he wants
 * "trainers" and has no idea what the Serbian is. `filterCards` is the deck
 * screen's own matcher (Cyrillic, its transliteration, or the English, folded so
 * an English keyboard finds "ћао" by typing "cao"), so a match here and a match
 * on the Deck screen are the same thing.
 */
export function quickAddMatches<T extends SearchableCard & { id: string }>(
  cards: readonly T[],
  sr: string,
  en: string,
  limit: number = QUICK_ADD_MATCH_LIMIT,
): T[] {
  const needles = [sr.trim(), en.trim()].filter((text) => text.length >= QUICK_ADD_MATCH_MIN);
  if (needles.length === 0) return [];

  const matches: T[] = [];
  const seen = new Set<string>();
  for (const needle of needles) {
    for (const card of filterCards(cards, needle)) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      matches.push(card);
      if (matches.length >= limit) return matches;
    }
  }
  return matches;
}
