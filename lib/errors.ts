/**
 * Turning a thrown thing into a sentence.
 *
 * Not everything that reaches a `catch` is an `Error`: supabase-js rejects with
 * a `PostgrestError`, a plain object carrying `message`/`code`/`details`. Screens
 * that only tested `instanceof Error` fell back to a generic apology and threw
 * away the one useful line the database sent.
 */

/** True for anything with a usable `message` string. */
function hasMessage(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string' &&
    (value as { message: string }).message.trim() !== ''
  );
}

/** `error`'s message if it has one, otherwise `fallback`. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  if (hasMessage(error)) return error.message;
  return fallback;
}
