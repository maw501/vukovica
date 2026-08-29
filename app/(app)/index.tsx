/**
 * Home dashboard: what is due, how long the streak is, and the way in to each
 * of the four activities.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { api, DEFAULT_NEW_PER_DAY } from '@/lib/api';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';

interface Activity {
  /** Serbian label -- the point of the app is to make Cyrillic ordinary. */
  cyr: string;
  en: string;
  /** null until the screen exists; the button renders disabled until then. */
  href: Href | null;
}

// Review / Deck arrive in Task 8, Trainer in Task 9, Chat in Task 10. Wiring one
// up is a one-line change here -- swap the `null` for its href.
const ACTIVITIES: Activity[] = [
  { cyr: 'Учи', en: 'Review', href: null },
  { cyr: 'Разговор', en: 'Chat with tutor', href: null },
  { cyr: 'Ћирилица', en: 'Cyrillic trainer', href: null },
  { cyr: 'Шпил', en: 'Deck', href: null },
];

export default function DashboardScreen() {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.getDashboard(),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
  });

  const stats = dashboard.data;
  const newPerDay = settings.data?.new_per_day ?? DEFAULT_NEW_PER_DAY;
  const newLeftToday = stats
    ? Math.max(0, Math.min(newPerDay - stats.newDoneToday, stats.newAvailable))
    : 0;

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={dashboard.isRefetching}
          onRefresh={() => {
            void dashboard.refetch();
            void settings.refetch();
          }}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.content}>
        {dashboard.isPending ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : dashboard.isError ? (
          <ErrorCard
            message={
              dashboard.error instanceof Error
                ? dashboard.error.message
                : 'Could not load your progress.'
            }
            onRetry={() => void dashboard.refetch()}
          />
        ) : (
          <>
            <View style={styles.statRow}>
              <Stat label="Due" value={stats?.dueCount ?? 0} testID="stat-due" />
              <Stat
                label="New today"
                value={newLeftToday}
                testID="stat-new"
                caption={`of ${newPerDay}`}
              />
              <Stat
                label="Streak"
                value={stats?.streakDays ?? 0}
                testID="stat-streak"
                caption={(stats?.streakDays ?? 0) === 1 ? 'day' : 'days'}
                accent
              />
            </View>
            <Text style={styles.deckLine} testID="deck-line">
              {stats?.newAvailable ?? 0} cards not yet studied
            </Text>
          </>
        )}

        <View style={styles.activities}>
          {ACTIVITIES.map((activity) => (
            <ActivityButton key={activity.en} activity={activity} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function Stat({
  label,
  value,
  caption,
  accent,
  testID,
}: {
  label: string;
  value: number;
  caption?: string;
  accent?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.stat} testID={testID}>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {caption ? <Text style={styles.statCaption}>{caption}</Text> : null}
    </View>
  );
}

function ActivityButton({ activity }: { activity: Activity }) {
  const router = useRouter();
  const enabled = activity.href !== null;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.activity,
        !enabled && styles.activityDisabled,
        pressed && enabled && styles.activityPressed,
      ]}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={activity.en}
      onPress={() => {
        if (activity.href) router.push(activity.href);
      }}
    >
      <View style={styles.activityText}>
        <Text style={[styles.activityCyr, !enabled && styles.mutedText]}>{activity.cyr}</Text>
        <Text style={styles.activityEn}>{activity.en}</Text>
      </View>
      {enabled ? (
        <Text style={styles.chevron}>›</Text>
      ) : (
        <Text style={styles.soon}>soon</Text>
      )}
    </Pressable>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorCard}>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable style={styles.retry} onPress={onRetry} accessibilityRole="button">
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: spacing.md },
  content: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  loading: { marginVertical: spacing.xl },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statValue: { fontSize: 34, fontWeight: '700', color: colors.primary },
  statValueAccent: { color: colors.accent },
  statLabel: { fontSize: 13, color: colors.text, marginTop: spacing.xs },
  statCaption: { fontSize: 12, color: colors.textMuted },
  deckLine: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: -spacing.sm,
  },
  activities: { gap: spacing.sm },
  activity: {
    minHeight: touchTarget + 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  activityDisabled: { backgroundColor: colors.background, opacity: 0.7 },
  activityPressed: { opacity: 0.8 },
  activityText: { gap: 2 },
  activityCyr: { fontSize: 22, fontWeight: '600', color: colors.text },
  activityEn: { fontSize: 13, color: colors.textMuted },
  mutedText: { color: colors.textMuted },
  chevron: { fontSize: 28, color: colors.primary },
  soon: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase' },
  errorCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorText: { color: colors.danger, fontSize: 14 },
  retry: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
});
