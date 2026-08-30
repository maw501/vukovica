/**
 * The books feature's pure logic: where a photographed page lives in storage,
 * what makes a book worth saving, how base64 from the image picker becomes
 * bytes, and what to say when something goes wrong.
 *
 * Free of Supabase and React Native imports on purpose — exactly as
 * `lib/reader.ts` is — so every boundary here is unit-testable without a
 * database, a browser, or a phone. `lib/errors.ts` is the only import, and it
 * imports nothing itself.
 */

import { errorMessage } from '@/lib/errors';

/**
 * Where a photographed page lives in the private `book-photos` bucket.
 *
 * **The first path segment must be the owner's user id.** That is not a
 * convention this file invented: the bucket's RLS policies read
 * `(storage.foldername(name))[1]` and compare it with `auth.uid()`, so an object
 * written anywhere else is refused by the database. One definition, here, so the
 * upload and any later reader of these photos cannot disagree about it.
 *
 * The extension is always `.jpg`, whatever the picked file actually was: it is
 * part of the agreed path shape, and storage records the real MIME type as
 * object metadata rather than inferring it from the name.
 */
export function photoObjectPath(userId: string, bookId: string, pageNo: number): string {
  return `${userId}/${bookId}/${pageNo}.jpg`;
}

/** Pages in one book. A picture book is tens of pages; this is a typo guard. */
export const MAX_PAGES = 80;

/**
 * The most one photograph may weigh, decoded.
 *
 * The bucket itself has no size limit (a known ticket), so this is the only
 * thing standing between a stray 40MB scan and a very slow upload on a phone.
 * A page photographed at `PHOTO_QUALITY` lands well under it.
 */
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

/**
 * JPEG quality asked of the picker on native, which re-encodes the picked image
 * before handing it over. Web ignores it — the browser file input gives back the
 * file as it is — so this is a saving on the platform that actually photographs
 * the books, and no worse than a no-op on the one that does not.
 */
export const PHOTO_QUALITY = 0.6;

/** Longest a title may be. Both columns are unbounded `text`; screens are not. */
const MAX_TITLE = 200;

/**
 * What is wrong with the English title, or null if nothing is.
 *
 * English is required and Cyrillic is optional, matching the schema
 * (`title_en text not null`, `title_cyr text`): the English title is how the
 * book is found in a list read half-asleep, and the Cyrillic one is the cover.
 */
export function bookTitleError(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed === '') return 'A book needs an English title.';
  if (trimmed.length > MAX_TITLE) return `Keep the title under ${MAX_TITLE} characters.`;
  return null;
}

/** What is wrong with the optional Cyrillic title, or null. Blank is fine. */
export function cyrillicTitleError(title: string): string | null {
  if (title.trim().length > MAX_TITLE) return `Keep the title under ${MAX_TITLE} characters.`;
  return null;
}

/** What is wrong with the chosen pages, or null. */
export function pageCountError(count: number): string | null {
  if (count <= 0) return 'Choose at least one page to photograph.';
  if (count > MAX_PAGES) return `That is more than ${MAX_PAGES} pages. Split it into two books.`;
  return null;
}

/**
 * The line shown while pages are going up, e.g. "Uploading page 3 of 8…".
 *
 * `done` is how many have landed, so the one in flight is `done + 1` — and once
 * every page is up the message stops counting and says what is left to do,
 * because the row inserts that follow are not a page anybody is waiting on.
 */
export function uploadProgressLabel(done: number, total: number): string {
  if (done >= total) return 'Saving the book…';
  return `Uploading page ${done + 1} of ${total}…`;
}

/** What the list says under a book whose pages have not been transcribed yet. */
export const PENDING_NOTE = 'Waiting for transcription — Claude fills this in next session.';

/**
 * PostgREST's code for "`.single()` asked for one row and got none". On an
 * update under RLS it means the row is not there — or not his.
 */
const NO_ROWS_RETURNED = 'PGRST116';

/**
 * What to tell the reader when "Finished" fails.
 *
 * The twin of `describeFinishError` in `lib/reader.ts`, and separate from it
 * because the sentence names the thing that was lost: a reader told his *story*
 * is gone when a book could not be saved would go looking in the wrong place.
 */
export function describeBookFinishError(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code === NO_ROWS_RETURNED) {
    return 'That book is no longer in your library, so it could not be marked finished.';
  }
  return errorMessage(error, 'That could not be saved. Try again.');
}

/** The standard base64 alphabet, indexed by value. */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Character code → 6-bit value; -1 for anything that is not base64. */
const BASE64_VALUES = (() => {
  const values = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    values[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  // URL-safe base64, accepted so a picker or a platform that emits it cannot
  // silently produce a corrupt photograph.
  values['-'.charCodeAt(0)] = 62;
  values['_'.charCodeAt(0)] = 63;
  return values;
})();

/**
 * Decode base64 to bytes.
 *
 * Hand-rolled rather than `atob` or a dependency: `atob` exists on web and in
 * recent Hermes but is not something this app can promise on every runtime it
 * ships to, and a photograph decoded by an absent global is a blank page in a
 * child's book. Whitespace and padding are skipped; anything else is a corrupt
 * payload and says so rather than quietly producing wrong bytes.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor((base64.length * 3) / 4));
  let length = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < base64.length; i += 1) {
    const code = base64.charCodeAt(i);
    if (code === 61) break; // '=' — padding, and nothing meaningful follows it.
    // Whitespace is legal filler in base64 (data URLs wrap at 76 characters).
    if (code === 32 || code === 9 || code === 10 || code === 13) continue;
    const value = code < 128 ? BASE64_VALUES[code] : -1;
    if (value < 0) throw new Error('That photo could not be read. Try choosing it again.');

    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[length] = (buffer >> bits) & 0xff;
      length += 1;
    }
  }

  // `bits` is what is left over from a truncated group: 0, 2 or 4 bits of
  // padding. Six left over means a lone base64 character, which encodes nothing.
  if (bits === 6) throw new Error('That photo could not be read. Try choosing it again.');

  return bytes.subarray(0, length);
}

/**
 * The MIME type to record for an uploaded page.
 *
 * The picker reports the file's own type on web and on native; anything that is
 * not an image is not a page of a book, so it falls back to JPEG rather than
 * letting a `text/html` (or absent) type be stored as the truth about the bytes.
 */
export function photoContentType(mimeType: string | null | undefined): string {
  return mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
}
