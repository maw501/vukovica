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

/**
 * A non-2xx from an Edge Function, carrying its `{ error }` code.
 *
 * Lives here rather than in `lib/edge.ts` because `lib/chat.ts` throws it too,
 * and `lib/chat.ts` must stay free of the Supabase client to remain unit
 * testable. This module imports nothing.
 */
export class EdgeFunctionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
    this.name = 'EdgeFunctionError';
  }
}

/**
 * A sentence to show the user for a failed Edge Function call. The wire codes
 * are for the log; this is for a person who just tapped a button.
 */
export function describeEdgeError(error: unknown): string {
  if (error instanceof EdgeFunctionError) {
    if (error.status === 401) return 'Your session has expired. Sign in again.';
    if (error.status === 502) {
      return 'The AI service could not be reached. Check the server’s API key, or fill the card in by hand.';
    }
    if (error.status >= 500) return 'The server had a problem. Try again in a moment.';
    return 'That request was rejected. Check what you typed and try again.';
  }
  return errorMessage(error, 'Something went wrong. Try again.');
}
