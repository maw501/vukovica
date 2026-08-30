/**
 * Home dashboard: which stage of the path the learner is on and its one goal,
 * the daily review habit, and the way in to every other activity.
 *
 * The stage decides emphasis only — nothing here is ever locked. Whatever the
 * stage, the review/streak card stays put (reviews are the daily habit) and
 * every activity keeps a row, in stage order, minus whatever the top of the
 * screen already leads with.
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
import { errorMessage } from '@/lib/errors';
import type { Stage } from '@/lib/stages';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';

/** The four places the dashboard can send the learner. */
type ActivityKey = 'trainer' | 'review' | 'reader' | 'deck';

interface Activity {
  /** English, like every other piece of chrome. */
  label: string;
  /** One line saying what it is for, under the label. */
  blurb: string;
  href: Href;
}

const ACTIVITIES: Record<ActivityKey, Activity> = {
  trainer: {
    label: 'Cyrillic trainer',
    blurb: 'Type the alphabet until it is second nature',
    href: '/trainer',
  },
  review: { label: 'Review', blurb: 'Today’s cards', href: '/review' },
  reader: { label: 'Reader', blurb: 'Stories to read in Cyrillic', href: '/reader' },
  deck: { label: 'Deck', blurb: 'Browse, edit and add words', href: '/deck' },
};

/**
 * The order the rows are listed in: the stages in path order, with the deck
 * last. The deck is a tool rather than a stage.
 */
const ACTIVITY_ORDER: readonly ActivityKey[] = ['trainer', 'review', 'reader', 'deck'];

/**
 * The activity each stage's primary button points at.
 *
 * Books points at the reader for now: it is the closest thing that exists, and
 * a button that goes nowhere is worse than one that goes somewhere useful. The
 * books screen replaces this entry when it lands.
 */
const STAGE_ACTIVITY: Record<Stage, ActivityKey> = {
  alphabet: 'trainer',
  words: 'review',
  reading: 'reader',
  books: 'reader',
};

/** The stage names, as §3 of the phase-3 spec names them. */
const STAGE_NAME: Record<Stage, string> = {
  alphabet: 'Alphabet',
  words: 'Words',
  reading: 'Reading',
  books: 'Books',
};

export default function DashboardScreen() {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.getDashboard(),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
  });
  const progress = useQuery({
    queryKey: ['progress'],
    queryFn: () => api.getProgress(),
  });

  const stats = dashboard.data;
  const newPerDay = settings.data?.new_per_day ?? DEFAULT_NEW_PER_DAY;
  const newLeftToday = stats
    ? Math.max(0, Math.min(newPerDay - stats.newDoneToday, stats.newAvailable))
    : 0;

  const stage = progress.data?.stage;
  /** Where the stage's one big button goes. */
  const primaryKey = stage ? STAGE_ACTIVITY[stage] : null;

  // Anything the top of the screen already covers is not repeated as a row:
  // reviews are always covered by the habit card, and the stage's own activity
  // by its primary button.
  const promoted = new Set<ActivityKey>(['review']);
  if (primaryKey) promoted.add(primaryKey);
  const rows = ACTIVITY_ORDER.filter((key) => !promoted.has(key));

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={dashboard.isRefetching}
          onRefresh={() => {
            void dashboard.refetch();
            void settings.refetch();
            void progress.refetch();
          }}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.content}>
        {/* No spinner of its own while it loads: the card below is already
            showing one, and two of them for one screen is a fidget. */}
        {progress.isError ? (
          <ErrorCard
            message={errorMessage(progress.error, 'Could not work out which stage you are on.')}
            onRetry={() => void progress.refetch()}
          />
        ) : progress.data && stage && primaryKey ? (
          <StageHeader stage={stage} goal={progress.data.nextGoal} primaryKey={primaryKey} />
        ) : null}

        {dashboard.isPending ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : dashboard.isError ? (
          <ErrorCard
            message={errorMessage(dashboard.error, 'Could not load your progress.')}
            onRetry={() => void dashboard.refetch()}
          />
        ) : (
          <>
            <ReviewCard
              due={stats?.dueCount ?? 0}
              newLeftToday={newLeftToday}
              newPerDay={newPerDay}
              streakDays={stats?.streakDays ?? 0}
            />
            <Text style={styles.deckLine} testID="deck-line">
              {stats?.newAvailable ?? 0} cards not yet studied
            </Text>
          </>
        )}

        <View style={styles.activities}>
          {rows.map((key) => (
            <ActivityButton key={key} activityKey={key} activity={ACTIVITIES[key]} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * The stage the learner is on, its one goal line, and the single action that
 * moves it along.
 *
 * `goal` is rendered exactly as `computeProgress` wrote it — the wording of the
 * goal is that module's job, not this screen's.
 */
function StageHeader({
  stage,
  goal,
  primaryKey,
}: {
  stage: Stage;
  goal: string;
  primaryKey: ActivityKey;
}) {
  const router = useRouter();
  const activity = ACTIVITIES[primaryKey];

  return (
    <View style={styles.stageCard} testID="stage-card">
      <Text style={styles.stageLabel}>Where you are</Text>
      <Text style={styles.stageName} testID="stage-name">
        {STAGE_NAME[stage]}
      </Text>
      <Text style={styles.stageGoal} testID="stage-goal">
        {goal}
      </Text>

      <Pressable
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={activity.label}
        testID="stage-primary"
        onPress={() => router.push(activity.href)}
      >
        <Text style={styles.primaryButtonLabel}>{activity.label}</Text>
        <Text style={styles.primaryButtonBlurb}>{activity.blurb}</Text>
      </Pressable>
    </View>
  );
}

/**
 * The daily habit, on screen at every stage: what is due, what is left of
 * today's new cards, and the streak. Tapping it starts a session, which is why
 * the numbers and the way in are one card rather than two.
 */
function ReviewCard({
  due,
  newLeftToday,
  newPerDay,
  streakDays,
}: {
  due: number;
  newLeftToday: number;
  newPerDay: number;
  streakDays: number;
}) {
  const router = useRouter();

  return (
    <Pressable
      style={({ pressed }) => [styles.reviewCard, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={ACTIVITIES.review.label}
      testID="review-card"
      onPress={() => router.push('/review')}
    >
      <View style={styles.statRow}>
        <Stat label="Due" value={due} testID="stat-due" />
        <Stat
          label="New today"
          value={newLeftToday}
          testID="stat-new"
          caption={`of ${newPerDay}`}
        />
        <Stat
          label="Streak"
          value={streakDays}
          testID="stat-streak"
          caption={streakDays === 1 ? 'day' : 'days'}
          accent
        />
      </View>
      <View style={styles.reviewFooter}>
        <View style={styles.activityText}>
          <Text style={styles.activityLabel}>{ACTIVITIES.review.label}</Text>
          <Text style={styles.activityBlurb}>{ACTIVITIES.review.blurb}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </Pressable>
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

function ActivityButton({
  activityKey,
  activity,
}: {
  activityKey: ActivityKey;
  activity: Activity;
}) {
  const router = useRouter();

  return (
    <Pressable
      style={({ pressed }) => [styles.activity, pressed && styles.activityPressed]}
      accessibilityRole="button"
      accessibilityLabel={activity.label}
      testID={`activity-${activityKey}`}
      onPress={() => router.push(activity.href)}
    >
      <View style={styles.activityText}>
        <Text style={styles.activityLabel}>{activity.label}</Text>
        <Text style={styles.activityBlurb}>{activity.blurb}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
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
  stageCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  stageLabel: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase' },
  stageName: { fontSize: 34, fontWeight: '700', color: colors.primary },
  stageGoal: { fontSize: 15, color: colors.text, marginBottom: spacing.sm },
  primaryButton: {
    minHeight: touchTarget + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
  },
  primaryButtonLabel: { color: colors.primaryOn, fontSize: 22, fontWeight: '700' },
  primaryButtonBlurb: { color: colors.primaryOn, fontSize: 13, opacity: 0.85 },
  pressed: { opacity: 0.8 },
  reviewCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statValue: { fontSize: 34, fontWeight: '700', color: colors.primary },
  statValueAccent: { color: colors.accent },
  statLabel: { fontSize: 13, color: colors.text, marginTop: spacing.xs },
  statCaption: { fontSize: 12, color: colors.textMuted },
  reviewFooter: {
    minHeight: touchTarget - 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  deckLine: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: -spacing.md,
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
  activityPressed: { opacity: 0.8 },
  activityText: { flexShrink: 1, gap: 2 },
  activityLabel: { fontSize: 20, fontWeight: '600', color: colors.text },
  activityBlurb: { fontSize: 13, color: colors.textMuted },
  chevron: { fontSize: 28, color: colors.primary },
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
