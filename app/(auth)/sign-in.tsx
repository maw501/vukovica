/**
 * Email + password sign-in, and -- only when `EXPO_PUBLIC_ALLOW_SIGNUP=true` --
 * account creation. This is a single-user instance: the flag comes off once
 * Mark has registered, and the deployed bundle then has no sign-up path at all.
 */

import Head from 'expo-router/head';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { signupEnabled, useAuth } from '@/lib/stores/auth';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';

export default function SignInScreen() {
  const signIn = useAuth((state) => state.signIn);
  const signUp = useAuth((state) => state.signUp);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'sign-up') {
        const signedIn = await signUp(email, password);
        // Local dev has confirmations off, so sign-up lands you straight in. A
        // hosted project that requires them leaves the session null instead.
        if (!signedIn) {
          setNotice('Check your email for a confirmation link, then sign in.');
        }
      } else {
        await signIn(email, password);
      }
      // No navigation here: the gate in app/_layout.tsx reacts to the session.
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* See app/(app)/_layout.tsx: the browser tab title has to come from `Head`. */}
      <Head>
        <title>Vukovica</title>
      </Head>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <Text style={styles.wordmark}>Vukovica</Text>
          <Text style={styles.tagline}>Serbian, one card at a time</Text>

          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            testID="email"
          />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            secureTextEntry
            onSubmitEditing={submit}
            returnKeyType="go"
            testID="password"
          />

          {error ? (
            <Text style={styles.error} testID="auth-error">
              {error}
            </Text>
          ) : null}
          {notice ? (
            <Text style={styles.notice} testID="auth-notice">
              {notice}
            </Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              !canSubmit && styles.buttonDisabled,
              pressed && canSubmit && styles.buttonPressed,
            ]}
            onPress={submit}
            disabled={!canSubmit}
            accessibilityRole="button"
            testID="submit"
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryOn} />
            ) : (
              <Text style={styles.primaryButtonText}>
                {mode === 'sign-up' ? 'Create account' : 'Sign in'}
              </Text>
            )}
          </Pressable>

          {signupEnabled ? (
            <Pressable
              style={styles.linkButton}
              onPress={() => {
                setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up');
                setError(null);
              }}
              accessibilityRole="button"
              testID="toggle-mode"
            >
              <Text style={styles.linkButtonText}>
                {mode === 'sign-up'
                  ? 'Already have an account? Sign in'
                  : 'No account yet? Create one'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  content: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    gap: spacing.md,
  },
  wordmark: {
    fontSize: 44,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  input: {
    minHeight: touchTarget,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 17,
    color: colors.text,
  },
  primaryButton: {
    minHeight: touchTarget,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { backgroundColor: colors.disabled },
  buttonPressed: { opacity: 0.85 },
  primaryButtonText: {
    color: colors.primaryOn,
    fontSize: 17,
    fontWeight: '600',
  },
  linkButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkButtonText: { color: colors.primary, fontSize: 15 },
  error: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
  },
  notice: {
    color: colors.primary,
    fontSize: 14,
    textAlign: 'center',
  },
});
