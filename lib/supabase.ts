/**
 * The one supabase-js client for the whole app.
 *
 * Per the design spec (§3), the client talks to Supabase *directly* under RLS
 * for all CRUD. Edge Functions exist only where a server-side secret is needed
 * (tutor / generate / tts). There is no API layer to route through.
 */

import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { supabaseAnonKey, supabaseUrl } from '@/lib/config';

// `functionsUrl` is re-exported so that `${functionsUrl}/tutor` reads the same
// from here as it always has; its definition lives in `lib/config.ts`.
export { functionsUrl } from '@/lib/config';

/**
 * Session storage. On web, passing `undefined` lets supabase-js use its default
 * (localStorage), which is what makes the PWA survive a reload. On native we
 * hand it the keychain/keystore via expo-secure-store.
 *
 * Note: SecureStore warns above 2048 bytes per value on Android. The MVP ships
 * as a PWA (native EAS builds are Phase 2), so the simple adapter stands; if a
 * native build lands, this is the place to add value chunking.
 */
const storage =
  Platform.OS === 'web'
    ? undefined
    : {
        getItem: (key: string) => SecureStore.getItemAsync(key),
        setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
        removeItem: (key: string) => SecureStore.deleteItemAsync(key),
      };

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    persistSession: true,
    autoRefreshToken: true,
    // Only meaningful on web, where supabase-js would otherwise try to read a
    // session out of the URL fragment on every load.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
