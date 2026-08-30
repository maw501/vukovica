/**
 * The project's Supabase coordinates, read once and validated once.
 *
 * Split out of `lib/supabase.ts` so that modules needing only a URL do not have
 * to pull in the client — and, through it, `react-native` and
 * `expo-secure-store`, neither of which loads under vitest. `lib/chat.ts` is the
 * case in point: it is a plain `fetch` against the functions URL and is unit
 * tested, so it imports this and nothing else.
 *
 * Metro inlines `process.env.EXPO_PUBLIC_*` at build time, so these have to be
 * written out as full static member expressions -- destructuring `process.env`
 * would leave them undefined in the bundle.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are required. ' +
      'Copy .env.example to .env.local and fill in the values from `npx supabase status`.',
  );
}

// Exported after the guard, so importers get `string` rather than
// `string | undefined` -- narrowing does not survive a module boundary.
export const supabaseUrl = url;
export const supabaseAnonKey = anonKey;

/** Base URL for Edge Function calls (`${functionsUrl}/tutor`, etc.). */
export const functionsUrl = `${url.replace(/\/$/, '')}/functions/v1`;
