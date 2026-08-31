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

import { XpRing } from '@/components/XpRing';
import { api, DEFAULT_NEW_PER_DAY } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { deckAllowance } from '@/lib/queue';
import type { Stage } from '@/lib/stages';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { DAILY_GOAL } from '@/lib/xp';

/** The eight places the dashboard can send the learner. */
type ActivityKey =
  | 'trainer'
  | 'letters'
  | 'review'
  | 'grammar'
  | 'reader'
  | 'books'
  | 'deck'
  | 'requests';

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
    blurb: 'Type whole words back — proves your letters',
    href: '/trainer',
  },
  letters: {
    label: 'Letters',
    blurb: 'Learn the alphabet — flashcards with audio, five a day',
    // Same review screen, filtered to `kind = 'letter'`. Word reviews and
    // letter reviews never share a session queue (spec §4).
    href: '/review?deck=letters',
  },
  review: { label: 'Review', blurb: 'Today’s cards', href: '/review' },
  grammar: {
    label: 'Grammar',
    blurb: 'Drill the endings of everyday phrases',
    href: '/grammar',
  },
  reader: { label: 'Reader', blurb: 'Stories to read in Cyrillic', href: '/reader' },
  books: {
    label: 'Books',
    blurb: 'Read the real books on your shelf',
    href: '/books',
  },
  deck: { label: 'Deck', blurb: 'Browse, edit and add words', href: '/deck' },
  requests: {
    label: 'Requests',
    blurb: 'Ask how to say something in Serbian',
    href: '/requests',
  },
};

/**
 * The order the rows are listed in: the stages in path order, then the two
 * tools. Neither the deck nor the capture queue is a stage — they are what the
 * stages are worked with. Letters sits with the trainer, because both are the
 * alphabet, and it comes first, because the flashcards are where the alphabet is
 * learned and the trainer is where it is proved. Grammar sits after Review,
 * because conjugations are what the words are put to work in and it is read
 * before it is read *with*.
 */
const ACTIVITY_ORDER: readonly ActivityKey[] = [
  'letters',
  'trainer',
  'review',
  'grammar',
  'reader',
  'books',
  'deck',
  'requests',
];

/**
 * The activity each stage's primary button points at.
 *
 * Alphabet leads with the letters deck, not the trainer: a beginner who has met
 * none of the thirty needs the flashcards that teach them, and the trainer —
 * which drills whole words — is the test that comes after, one row down.
 */
const STAGE_ACTIVITY: Record<Stage, ActivityKey> = {
  alphabet: 'letters',
  words: 'review',
  reading: 'reader',
  books: 'books',
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
  // The letters deck's own figures. A separate query rather than part of
  // `getDashboard`, because the streak is deck-independent and paginates —
  // there is no sense fetching it twice to label one tile.
  const letters = useQuery({
    queryKey: ['deck-stats', 'letters'],
    queryFn: () => api.getDeckStats('letters'),
  });
  // Today's ring and the level. Its own query, shared verbatim with the
  // progress screen, so opening that screen re-uses this entry rather than
  // asking again.
  const xp = useQuery({ queryKey: ['xp'], queryFn: () => api.getXpSummary() });
  // The capture queue, for the Requests row's "waiting" count. The same
  // `['requests']` list the queue screen shows rather than a count query, so
  // opening it from here costs no round trip.
  const requests = useQuery({ queryKey: ['requests'], queryFn: () => api.listRequests() });

  const stats = dashboard.data;
  const newPerDay = settings.data?.new_per_day ?? DEFAULT_NEW_PER_DAY;
  const newLeftToday = stats
    ? Math.max(0, Math.min(newPerDay - stats.newDoneToday, stats.newAvailable))
    : 0;

  const lettersDue = letters.data?.dueCount ?? 0;
  // The letters allowance is fixed rather than the user's setting, so it comes
  // from `deckAllowance` here rather than from the fetched stats — no second
  // read of a row this screen already has.
  const lettersNewLeft = letters.data
    ? Math.max(
        0,
        Math.min(
          deckAllowance('letters', newPerDay) - letters.data.newDoneToday,
          letters.data.newAvailable,
        ),
      )
    : 0;

  const requestsPending = (requests.data ?? []).filter((row) => row.status === 'pending').length;

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
            void letters.refetch();
            void xp.refetch();
            void requests.refetch();
          }}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.content}>
        {/* No spinner of its own while it loads: the card below is already
            showing one, and two of them for one screen is a fidget. The header
            renders whatever it has -- the streak and the ring do not wait on
            the stage, and the stage failing must not take them down with it. */}
        <DashboardHeader
          streakDays={stats?.streakDays ?? 0}
          // null, not 0, when the ledger could not be read: "0 of 30 XP today"
          // is what a day with no work done looks like, and a failed query must
          // not be able to impersonate one.
          todayXp={xp.isError ? null : (xp.data?.today ?? 0)}
          stage={stage ?? null}
          goal={progress.data?.nextGoal ?? null}
          primaryKey={primaryKey}
        />
        {progress.isError ? (
          <ErrorCard
            message={errorMessage(progress.error, 'Could not work out which stage you are on.')}
            onRetry={() => void progress.refetch()}
          />
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
            />
            <Text style={styles.deckLine} testID="deck-line">
              {stats?.newAvailable ?? 0} cards not yet studied
            </Text>
          </>
        )}

        <View style={styles.activities}>
          {rows.map((key) =>
            key === 'letters' ? (
              <ActivityButton
                key={key}
                activityKey={key}
                activity={ACTIVITIES[key]}
                badge={lettersDue > 0 ? String(lettersDue) : undefined}
                blurb={
                  letters.isError
                    ? 'Could not count the letters due.'
                    : letters.data
                      ? lettersBlurb(lettersDue, lettersNewLeft, letters.data.newAvailable)
                      : undefined
                }
              />
            ) : key === 'requests' ? (
              <ActivityButton
                key={key}
                activityKey={key}
                activity={ACTIVITIES[key]}
                badge={requestsPending > 0 ? String(requestsPending) : undefined}
                blurb={
                  requests.isError
                    ? 'Could not count what is waiting.'
                    : requests.data
                      ? requestsBlurb(requestsPending, requests.data.length)
                      : undefined
                }
              />
            ) : (
              <ActivityButton key={key} activityKey={key} activity={ACTIVITIES[key]} />
            ),
          )}
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * What the dashboard leads with: the streak, today's XP ring, the stage and its
 * one goal line, and the single action that moves it along.
 *
 * Deliberately compact (spec §10). Every other figure the app counts — the
 * streak record, the XP total and level, the ladders — lives on the progress
 * screen, which the top row of this card is the way in to. Repeating them here
 * would make the first thing seen each morning a report rather than a prompt.
 *
 * `goal` is rendered exactly as `computeProgress` wrote it — the wording of the
 * goal is that module's job, not this screen's. Both it and `stage` are null
 * while the progress query is loading, or if it failed; the streak and the ring
 * still show, because they come from elsewhere.
 */
function DashboardHeader({
  streakDays,
  todayXp,
  stage,
  goal,
  primaryKey,
}: {
  streakDays: number;
  /** Today's XP, or null when the ledger could not be read at all. */
  todayXp: number | null;
  stage: Stage | null;
  goal: string | null;
  primaryKey: ActivityKey | null;
}) {
  const router = useRouter();
  const activity = primaryKey ? ACTIVITIES[primaryKey] : null;
  const xpSpoken =
    todayXp === null ? 'today’s XP unavailable' : `${todayXp} of ${DAILY_GOAL} XP today`;

  return (
    <View style={styles.stageCard} testID="stage-card">
      <Pressable
        style={({ pressed }) => [styles.headerStats, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Progress. ${streakDays} day streak, ${xpSpoken}.`}
        testID="header-progress"
        onPress={() => router.push('/progress')}
      >
        <View style={styles.headerStat} testID="stat-streak">
          <Text style={styles.headerStatValue}>{streakDays}</Text>
          <Text style={styles.headerStatLabel}>
            day{streakDays === 1 ? '' : 's'} in a row
          </Text>
        </View>
        <View style={styles.headerStat} testID="stat-xp">
          {todayXp === null ? (
            // A dash, not an empty ring: an unfilled ring reads as "nothing done
            // today", which is a claim this screen is in no position to make.
            <>
              <Text style={styles.headerStatValue} testID="xp-unavailable">
                —
              </Text>
              <Text style={styles.headerStatLabel}>XP today unavailable</Text>
            </>
          ) : (
            <>
              {/* The ring is a disc with a hole in it, so the hole has to be
                  painted the colour of what it sits on. */}
              <XpRing today={todayXp} size={60} hole={colors.background} />
              <Text style={styles.headerStatLabel}>of {DAILY_GOAL} XP today</Text>
            </>
          )}
        </View>
        {/* Says out loud what the row is: two numbers and a chevron would leave
            the way to the rest of them to be guessed at. */}
        <View style={styles.headerLink}>
          <Text style={styles.headerLinkText}>Progress</Text>
          <Text style={styles.chevron}>›</Text>
        </View>
      </Pressable>

      <Text style={styles.stageLabel}>Where you are</Text>
      <Text style={styles.stageName} testID="stage-name">
        {stage ? STAGE_NAME[stage] : '—'}
      </Text>
      <Text style={styles.stageGoal} testID="stage-goal">
        {goal ?? 'Working out where you are…'}
      </Text>

      {activity ? (
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
      ) : null}
    </View>
  );
}

/**
 * The daily habit, on screen at every stage: what is due and what is left of
 * today's new cards. Tapping it starts a session, which is why the numbers and
 * the way in are one card rather than two.
 *
 * The streak used to sit here too. It has moved up into the header, where it
 * belongs beside the XP ring — the same figure in two cards on one screen is
 * clutter, not emphasis.
 */
function ReviewCard({
  due,
  newLeftToday,
  newPerDay,
}: {
  due: number;
  newLeftToday: number;
  newPerDay: number;
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
  testID,
}: {
  label: string;
  value: number;
  caption?: string;
  testID?: string;
}) {
  return (
    <View style={styles.stat} testID={testID}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {caption ? <Text style={styles.statCaption}>{caption}</Text> : null}
    </View>
  );
}

/**
 * The Letters row's second line: what is actually waiting, rather than what the
 * deck is for.
 *
 * `newAvailable` separates "today's five are done" from "the whole azbuka is
 * in circulation" — and an unseeded deck reads as the latter, which is true:
 * there is nothing due, and nothing more to introduce.
 */
function lettersBlurb(due: number, newLeft: number, newAvailable: number): string {
  const parts: string[] = [];
  if (due > 0) parts.push(`${due} due`);
  if (newLeft > 0) parts.push(`${newLeft} new`);
  if (parts.length > 0) return parts.join(' · ');
  return newAvailable > 0 ? 'Nothing due — more letters tomorrow' : 'Nothing due today';
}

/**
 * The Requests row's second line: what is still waiting to be answered.
 *
 * "Waiting" rather than "pending" because the queue is answered by hand between
 * sessions — the honest thing to say is that nothing has come back yet, not that
 * a job is running.
 */
function requestsBlurb(pending: number, total: number): string {
  if (pending > 0) return `${pending} waiting to be answered`;
  if (total > 0) return 'All answered';
  return ACTIVITIES.requests.blurb;
}

function ActivityButton({
  activityKey,
  activity,
  badge,
  blurb,
}: {
  activityKey: ActivityKey;
  activity: Activity;
  /** A count worth seeing before tapping, e.g. the letters deck's due cards. */
  badge?: string;
  /** Overrides `activity.blurb` when the row has something live to say. */
  blurb?: string;
}) {
  const router = useRouter();
  const line = blurb ?? activity.blurb;

  return (
    <Pressable
      style={({ pressed }) => [styles.activity, pressed && styles.activityPressed]}
      accessibilityRole="button"
      // The live blurb rather than the badge: "3 due · 2 new" and "2 waiting to
      // be answered" both say what the number means, which a bare count read
      // aloud as "3 due" would only get right for one of the two rows.
      accessibilityLabel={badge ? `${activity.label}, ${line}` : activity.label}
      testID={`activity-${activityKey}`}
      onPress={() => router.push(activity.href)}
    >
      <View style={styles.activityText}>
        <Text style={styles.activityLabel}>{activity.label}</Text>
        <Text style={styles.activityBlurb}>{line}</Text>
      </View>
      {badge ? (
        <Text style={styles.badge} testID={`activity-${activityKey}-badge`}>
          {badge}
        </Text>
      ) : null}
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
  headerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  headerStat: { flex: 1, alignItems: 'center', gap: 2 },
  headerLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerLinkText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  headerStatValue: { fontSize: 32, fontWeight: '700', color: colors.accent },
  headerStatLabel: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
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
  badge: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primaryOn,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    minWidth: 28,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginRight: spacing.sm,
    overflow: 'hidden',
  },
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
