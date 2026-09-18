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

const CYRILLIC = /\p{Script=Cyrillic}/u;

/**
 * Per-box problems, keyed by box. An empty object means the word is ready to
 * add. The messages are shown verbatim under the inputs.
 *
 * The Cyrillic check is made *after* the conversion, exactly as the function
 * checks what it was sent: "kasika" is fine, because it arrives as "касика";
 * "123" is not, because nothing in it converts to a letter. Saying so here saves
 * a round trip and puts the message under the box it belongs to, but it is not
 * the only guard — `quick_add_word` makes the same three checks itself.
 */
export function quickAddErrors(sr: string, en: string): Partial<Record<QuickAddField, string>> {
  const errors: Partial<Record<QuickAddField, string>> = {};
  const headword = toCyrillicHeadword(sr);

  if (headword === '') {
    errors.sr = 'Type the Serbian word.';
  } else if (!CYRILLIC.test(headword)) {
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
