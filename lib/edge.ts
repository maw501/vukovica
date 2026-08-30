/**
 * Calling our Edge Functions.
 *
 * Everything else in the app talks to Postgres directly under RLS; these three
 * endpoints (`tutor`, `generate`, `tts`) exist only because they need a
 * server-side AI key. They are plain `fetch` calls — supabase-js's
 * `functions.invoke` swallows the response body on a non-2xx, and the body is
 * exactly where our error code lives.
 */

import { EdgeFunctionError } from '@/lib/errors';
import { functionsUrl, supabase } from '@/lib/supabase';

// The error type and its user-facing wording live in `lib/errors.ts` — a module
// with no imports, so `lib/chat.ts` can throw the same error without dragging
// the Supabase client (and `react-native`) into a unit test. Re-exported here
// because this is where every call site already looks for them.
export { EdgeFunctionError, describeEdgeError } from '@/lib/errors';

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
