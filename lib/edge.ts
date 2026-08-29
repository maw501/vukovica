/**
 * Calling our Edge Functions.
 *
 * Everything else in the app talks to Postgres directly under RLS; these three
 * endpoints (`tutor`, `generate`, `tts`) exist only because they need a
 * server-side AI key. They are plain `fetch` calls — supabase-js's
 * `functions.invoke` swallows the response body on a non-2xx, and the body is
 * exactly where our error code lives.
 */

import { functionsUrl, supabase } from '@/lib/supabase';

/** A non-2xx from an Edge Function, carrying its `{ error }` code. */
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
 * POST `body` to `/functions/v1/<name>` as the signed-in user and return the
 * parsed JSON. Throws `EdgeFunctionError` on a non-2xx.
 */
export async function callEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');

  const response = await fetch(`${functionsUrl}/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // The function always answers with `{ error: '<code>' }`, but a crashed
    // container or a proxy in front of it may not.
    let code = `http_${response.status}`;
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload?.error === 'string') code = payload.error;
    } catch {
      // Body was not JSON; the status code alone will have to do.
    }
    throw new EdgeFunctionError(response.status, code);
  }

  return (await response.json()) as T;
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
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Try again.';
}
