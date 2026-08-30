/**
 * Home dashboard: which stage of the path the learner is on and its one goal,
 * the daily review habit, and the way in to every other activity.
 *
 * The stage decides emphasis only — nothing here is ever locked. Whatever the
 * stage, the review/streak card stays put (reviews are the daily habit) and
 * every activity keeps a row, in stage order, with chat last until it is the
 * stage itself.
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
import type { Stage } from '@/lib/stages';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';

/** The five places the dashboard can send the learner. */
type ActivityKey = 'trainer' | 'review' | 'reader' | 'chat' | 'deck';

interface Activity {
  /** Serbian label -- the point of the app is to make Cyrillic ordinary. */
  cyr: string;
  en: string;
  /** null until the screen exists; the row renders disabled until then. */
  href: Href | null;
}

const ACTIVITIES: Record<ActivityKey, Activity> = {
  trainer: { cyr: 'Ћирилица', en: 'Cyrillic trainer', href: '/trainer' },
  review: { cyr: 'Учи', en: 'Review', href: '/review' },
  // Wired up in Task 4 of this phase; until then the row says СКОРО and the
  // Читање primary button falls back to reviews.
  reader: { cyr: 'Читање', en: 'Reader', href: null },
  chat: { cyr: 'Разговор', en: 'Chat with tutor', href: '/chat' },
  deck: { cyr: 'Шпил', en: 'Deck', href: '/deck' },
};

/**
 * The order the rows are listed in: the four stages in path order, with the
 * deck slotted in before chat. The deck is a tool rather than a stage, and chat
 * is deliberately last — it is demoted until Разговор, at which point it is the
 * primary button and drops out of this list entirely.
 */
const ACTIVITY_ORDER: readonly ActivityKey[] = ['trainer', 'review', 'reader', 'deck', 'chat'];

/** The activity each stage's primary button points at. */
const STAGE_ACTIVITY: Record<Stage, ActivityKey> = {
  azbuka: 'trainer',
  reci: 'review',
  citanje: 'reader',
  razgovor: 'chat',
};

/** Stage names are only ever shown in Cyrillic; `nextGoal` carries the English. */
const STAGE_NAME: Record<Stage, string> = {
  azbuka: 'Азбука',
  reci: 'Речи',
  citanje: 'Читање',
  razgovor: 'Разговор',
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
  /** What the stage wants next... */
  const primaryKey = stage ? STAGE_ACTIVITY[stage] : null;
  /**
   * ...and where the button can actually go, which is not always the same: a
   * stage whose screen has not been built yet falls back to reviews, which are
   * useful at every stage.
   */
  const buttonKey: ActivityKey | null =
    primaryKey === null ? null : ACTIVITIES[primaryKey].href ? primaryKey : 'review';

  // Anything the top of the screen already covers is not repeated as a row.
  // Reviews are always covered by the habit card, and so is the stage's own
  // activity when the button really goes there — but a fallen-back button does
  // not cover it, so an unbuilt Читање keeps a СКОРО row of its own rather than
  // vanishing at exactly the stage it belongs to.
  const promoted = new Set<ActivityKey>(['review']);
  if (buttonKey) promoted.add(buttonKey);
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
            message={
              progress.error instanceof Error
                ? progress.error.message
                : 'Could not work out which stage you are on.'
            }
            onRetry={() => void progress.refetch()}
          />
        ) : progress.data && stage && primaryKey && buttonKey ? (
          <StageHeader
            stage={stage}
            goal={progress.data.nextGoal}
            primaryKey={primaryKey}
            buttonKey={buttonKey}
          />
        ) : null}

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
  buttonKey,
}: {
  stage: Stage;
  goal: string;
  primaryKey: ActivityKey;
  buttonKey: ActivityKey;
}) {
  const router = useRouter();
  const activity = ACTIVITIES[buttonKey];
  const fellBack = buttonKey !== primaryKey;

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
        accessibilityLabel={activity.en}
        testID="stage-primary"
        onPress={() => {
          // Non-null for every key the button can carry: the fallback is only
          // ever picked because the stage's own screen has no href yet.
          if (activity.href) router.push(activity.href);
        }}
      >
        <Text style={styles.primaryButtonCyr}>{activity.cyr}</Text>
        <Text style={styles.primaryButtonEn}>{activity.en}</Text>
      </Pressable>

      {fellBack ? (
        <Text style={styles.stageFallback} testID="stage-fallback">
          {ACTIVITIES[primaryKey].cyr} is not built yet — keep the words coming in the meantime.
        </Text>
      ) : null}
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
      accessibilityLabel={ACTIVITIES.review.en}
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
          <Text style={styles.activityCyr}>{ACTIVITIES.review.cyr}</Text>
          <Text style={styles.activityEn}>{ACTIVITIES.review.en}</Text>
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
      testID={`activity-${activityKey}`}
      onPress={() => {
        if (activity.href) router.push(activity.href);
      }}
    >
      <View style={styles.activityText}>
        <Text style={[styles.activityCyr, !enabled && styles.mutedText]}>{activity.cyr}</Text>
        <Text style={styles.activityEn}>{activity.en}</Text>
      </View>
      {enabled ? <Text style={styles.chevron}>›</Text> : <Text style={styles.soon}>СКОРО</Text>}
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
  stageFallback: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  primaryButton: {
    minHeight: touchTarget + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
  },
  primaryButtonCyr: { color: colors.primaryOn, fontSize: 22, fontWeight: '700' },
  primaryButtonEn: { color: colors.primaryOn, fontSize: 13, opacity: 0.85 },
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
