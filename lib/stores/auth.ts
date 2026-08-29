/**
 * Auth session state.
 *
 * Zustand holds the session (client state); React Query holds everything that
 * comes out of Postgres (server state). The store is the single source of truth
 * the route gate in `app/_layout.tsx` reads.
 */

import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { supabase } from '@/lib/supabase';

/**
 * Sign-up is a build-time flag, not a runtime setting: this is a single-user
 * instance, so once Mark has registered the flag comes off and the deployed
 * bundle has no way to create another account.
 */
export const signupEnabled = process.env.EXPO_PUBLIC_ALLOW_SIGNUP === 'true';

interface AuthState {
  session: Session | null;
  /** True until the persisted session (if any) has been read back from storage. */
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Resolves to false when the project requires email confirmation, in which
   * case no session exists yet and the user has to click a link first.
   */
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  session: null,
  initializing: true,

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    // `onAuthStateChange` sets the session; we only surface failure here.
    if (error) throw error;
  },

  signUp: async (email, password) => {
    if (!signupEnabled) {
      throw new Error('Sign-up is disabled on this instance.');
    }
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) throw error;
    return data.session !== null;
  },

  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    // Belt and braces: `onAuthStateChange` fires SIGNED_OUT, but clearing here
    // means the gate redirects even if the listener has been torn down.
    set({ session: null });
  },
}));

let initialized = false;

/**
 * Wire the store to supabase-js. Idempotent, so React 19's double-invoked
 * effects (and Fast Refresh) cannot end up with two subscriptions.
 */
export function initAuth(): void {
  if (initialized) return;
  initialized = true;

  supabase.auth
    .getSession()
    .then(({ data }) => {
      useAuth.setState({ session: data.session, initializing: false });
    })
    // Storage can throw outright (a locked keychain, a browser blocking site
    // data). Treat that as "signed out" rather than leaving `initializing` true
    // forever, which would strand the user on the splash spinner.
    .catch(() => {
      useAuth.setState({ session: null, initializing: false });
    });

  supabase.auth.onAuthStateChange((_event, session) => {
    useAuth.setState({ session, initializing: false });
  });
}
