import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses RLS — only ever used for writes the user is
 * deliberately not allowed to make directly (ai_usage rows, audio uploads).
 */
export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

function createAnonClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Resolves the caller's user from the Authorization header, or null.
 *
 * Note the raw JWT is passed to getUser() explicitly: a server-side client does
 * NOT derive a session from a `global.headers.Authorization` option, so relying
 * on that silently authenticates nobody.
 *
 * Functions are deployed with `verify_jwt = false` (the platform gate would
 * reject the OPTIONS preflight), which makes this check the only thing standing
 * between the internet and the model spend. It is not optional in any handler.
 */
export async function getAuthenticatedUser(req: Request): Promise<User | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const { data, error } = await createAnonClient().auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}
