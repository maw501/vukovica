/**
 * Root layout: providers plus the auth gate.
 *
 * Two route groups hang off here -- `(auth)` for the signed-out world and
 * `(app)` for everything else. The gate below is what keeps you in the right
 * one; neither group is reachable by URL without a matching session.
 */

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { initAuth, useAuth } from '@/lib/stores/auth';
import { colors } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A phone on a flaky train connection should retry, but not for a minute.
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

export default function RootLayout() {
  useEffect(() => {
    initAuth();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate />
      <StatusBar style="dark" />
    </QueryClientProvider>
  );
}

function AuthGate() {
  const session = useAuth((state) => state.session);
  const initializing = useAuth((state) => state.initializing);
  const segments = useSegments();
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    // Every cached query holds one user's rows. Dropping them the moment the
    // session goes means a second account cannot briefly see the first one's
    // settings and counts while its own queries are still in flight.
    if (!session) queryClient.clear();
  }, [session, queryClient]);

  useEffect(() => {
    // Wait for the persisted session to load, otherwise every cold start would
    // bounce the user to sign-in for a frame and lose their deep link.
    if (initializing) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!session && !inAuthGroup) {
      router.replace('/sign-in');
    } else if (session && inAuthGroup) {
      router.replace('/');
    }
  }, [initializing, session, segments, router]);

  if (initializing) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
