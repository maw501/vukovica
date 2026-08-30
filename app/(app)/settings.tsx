/**
 * Settings: Latin transliteration on/off, the daily new-card budget, audio
 * on/off, and sign out. Every change writes straight to `public.settings`
 * (optimistically, so a toggle never lags behind the thumb).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type SwitchProps,
} from 'react-native';

import { api, DEFAULT_NEW_PER_DAY } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { useAuth } from '@/lib/stores/auth';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import type { SettingsRow } from '@/lib/types';

/**
 * react-native-web paints the *switched-on* thumb from `activeThumbColor`, a
 * prop core React Native does not declare -- hence the cast. On native the
 * `thumbColor` below already covers both states.
 */
const webSwitchProps: Partial<SwitchProps> =
  Platform.OS === 'web' ? ({ activeThumbColor: colors.surface } as Partial<SwitchProps>) : {};

/** The stepper's bounds and granularity. 0 = reviews only, no new cards. */
const NEW_PER_DAY_STEP = 5;
const NEW_PER_DAY_MIN = 0;
const NEW_PER_DAY_MAX = 100;

export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const session = useAuth((state) => state.session);
  const signOut = useAuth((state) => state.signOut);

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<Omit<SettingsRow, 'user_id'>>) => api.updateSettings(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] });
      const previous = queryClient.getQueryData<SettingsRow>(['settings']);
      if (previous) {
        queryClient.setQueryData<SettingsRow>(['settings'], { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      // Put the old value back so the switch does not lie about what is stored.
      if (context?.previous) queryClient.setQueryData(['settings'], context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      // The new-card budget feeds the dashboard's "new today" figure.
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      // Nothing in settings moves the stage today, but the rule the dashboard
      // is refreshed by is "anything it shows changed" -- keeping both of its
      // reads together is what stops the two halves drifting apart later.
      void queryClient.invalidateQueries({ queryKey: ['progress'] });
    },
  });

  if (settings.isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (settings.isError || !settings.data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>
          {settings.error instanceof Error
            ? settings.error.message
            : 'Could not load your settings.'}
        </Text>
        <Pressable
          style={styles.textButton}
          onPress={() => void settings.refetch()}
          accessibilityRole="button"
        >
          <Text style={styles.textButtonLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const row = settings.data;
  const showLatin = row.show_latin ?? true;
  const ttsEnabled = row.tts_enabled ?? true;
  const newPerDay = row.new_per_day ?? DEFAULT_NEW_PER_DAY;

  function stepNewPerDay(delta: number) {
    const next = Math.min(NEW_PER_DAY_MAX, Math.max(NEW_PER_DAY_MIN, newPerDay + delta));
    if (next !== newPerDay) save.mutate({ new_per_day: next });
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        <View style={styles.card}>
          <ToggleRow
            title="Latin transliteration"
            subtitle="Show the Latin form under Cyrillic text"
            value={showLatin}
            onChange={(value) => save.mutate({ show_latin: value })}
            testID="toggle-show-latin"
          />
          <View style={styles.divider} />
          <StepperRow
            title="New cards per day"
            subtitle="How many unseen words a session may introduce"
            value={newPerDay}
            onDecrement={() => stepNewPerDay(-NEW_PER_DAY_STEP)}
            onIncrement={() => stepNewPerDay(NEW_PER_DAY_STEP)}
            canDecrement={newPerDay > NEW_PER_DAY_MIN}
            canIncrement={newPerDay < NEW_PER_DAY_MAX}
          />
          <View style={styles.divider} />
          <ToggleRow
            title="Audio"
            subtitle="Pronounce words with text-to-speech"
            value={ttsEnabled}
            onChange={(value) => save.mutate({ tts_enabled: value })}
            testID="toggle-tts"
          />
        </View>

        {save.isError ? (
          <Text style={styles.error} testID="settings-error">
            Could not save that change. Check your connection and try again.
          </Text>
        ) : null}

        <Text style={styles.account} testID="account-email">
          Signed in as {session?.user.email ?? 'unknown'}
        </Text>

        <Pressable
          style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
          onPress={() => void confirmSignOut(signOut)}
          accessibilityRole="button"
          testID="sign-out"
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

async function confirmSignOut(signOut: () => Promise<void>) {
  const confirmed = await confirmAction({
    title: 'Sign out',
    message: 'Sign out of Vukovica?',
    confirmLabel: 'Sign out',
    destructive: true,
  });
  if (confirmed) await signOut();
}

function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
  testID,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (value: boolean) => void;
  testID?: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.disabled }}
        // The platform default thumb is green, which fights the navy track;
        // white reads as "the knob" everywhere.
        thumbColor={colors.surface}
        {...webSwitchProps}
        testID={testID}
      />
    </View>
  );
}

function StepperRow({
  title,
  subtitle,
  value,
  onDecrement,
  onIncrement,
  canDecrement,
  canIncrement,
}: {
  title: string;
  subtitle: string;
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  canDecrement: boolean;
  canIncrement: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.stepper}>
        <StepperButton label="−" onPress={onDecrement} enabled={canDecrement} testID="new-minus" />
        <Text style={styles.stepperValue} testID="new-per-day">
          {value}
        </Text>
        <StepperButton label="+" onPress={onIncrement} enabled={canIncrement} testID="new-plus" />
      </View>
    </View>
  );
}

function StepperButton({
  label,
  onPress,
  enabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  enabled: boolean;
  testID: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.stepperButton,
        !enabled && styles.stepperButtonDisabled,
        pressed && enabled && styles.pressed,
      ]}
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Increase' : 'Decrease'}
      testID={testID}
    >
      <Text style={[styles.stepperButtonText, !enabled && styles.stepperButtonTextDisabled]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: spacing.md },
  content: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    gap: spacing.md,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
  },
  divider: { height: 1, backgroundColor: colors.border },
  row: {
    minHeight: touchTarget + 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowSubtitle: { fontSize: 13, color: colors.textMuted },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stepperButton: {
    width: touchTarget - 8,
    height: touchTarget - 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  stepperButtonDisabled: { opacity: 0.4 },
  stepperButtonText: { fontSize: 22, color: colors.primary, lineHeight: 26 },
  stepperButtonTextDisabled: { color: colors.textMuted },
  stepperValue: {
    minWidth: 40,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  account: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  signOut: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  signOutText: { fontSize: 16, fontWeight: '600', color: colors.danger },
  pressed: { opacity: 0.8 },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  textButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
});
