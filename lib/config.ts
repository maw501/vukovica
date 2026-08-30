/**
 * The project's Supabase coordinates, read once and validated once.
 *
 * Split out of `lib/supabase.ts` so that a module needing only the coordinates
 * does not have to pull in the client — and, through it, `react-native` and
 * `expo-secure-store`, neither of which loads under vitest.
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
