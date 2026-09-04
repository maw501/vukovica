/**
 * The progress screen: everything that has been earned, in one place.
 *
 * The dashboard header deliberately shows only what the next five minutes need
 * — streak, today's ring, the stage and its one goal. This is where the rest
 * lives: the streak record, the XP total and level, and every ladder the app
 * counts. Nothing here is an action; it is the answer to "how am I doing?".
 *
 * Three queries, all shared with other screens: `['progress']` and `['xp']` are
 * already warm from the dashboard, so arriving here usually costs one round trip
 * (`['progress-report']`) rather than four.
 */

import { useQuery } from '@tanstack/react-query';
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
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { KNOWN_MILESTONES, STORY_MILESTONES } from '@/lib/stages';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { DAILY_GOAL, levelProgress } from '@/lib/xp';

export default function ProgressScreen() {
  const progress = useQuery({ queryKey: ['progress'], queryFn: () => api.getProgress() });
  const xp = useQuery({ queryKey: ['xp'], queryFn: () => api.getXpSummary() });
  const report = useQuery({
    queryKey: ['progress-report'],
    queryFn: () => api.getProgressReport(),
  });

  const queries = [progress, xp, report];
  const pending = queries.some((query) => query.isPending);
  const failed = queries.find((query) => query.isError);
  const refetchAll = () => {
    for (const query of queries) void query.refetch();
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={queries.some((query) => query.isRefetching)}
          onRefresh={refetchAll}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.content}>
        {/* One error card for the screen: the three reads fail for the same
            reasons (signed out, offline), and three identical messages stacked
            up would say nothing extra. */}
        {failed ? (
          <View style={styles.card} testID="progress-error">
            <Text style={styles.errorText}>
              {errorMessage(failed.error, 'Could not load your progress.')}
            </Text>
            <Pressable style={styles.retry} onPress={refetchAll} accessibilityRole="button">
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {pending && !failed ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : null}

        {report.data ? (
          <Section title="Streak" testID="section-streak">
            <View style={styles.figures}>
              <Figure
                value={report.data.streakDays}
                label="Current"
                caption={report.data.streakDays === 1 ? 'day' : 'days'}
                accent
                testID="streak-current"
              />
              <Figure
                value={report.data.longestStreakDays}
                label="Longest"
                caption={report.data.longestStreakDays === 1 ? 'day' : 'days'}
                testID="streak-longest"
              />
            </View>
          </Section>
        ) : null}

        {xp.data ? <XpSection total={xp.data.total} today={xp.data.today} /> : null}

        {progress.data ? (
          <>
            <Section title="Alphabet" testID="section-letters">
              <Bar
                value={progress.data.letterMastery.mastered}
                target={progress.data.letterMastery.total}
                unit="letters mastered"
                testID="letters-mastered"
              />
              <Text style={styles.note}>
                A letter counts as mastered once you get it right three times in a row in the
                letters drill, or after 8 tries in the trainer at 90% right.
              </Text>
            </Section>

            <Section title="Words" testID="section-words">
              <Bar
                value={progress.data.knownWords}
                target={progress.data.knownMilestone}
                unit="words known"
                testID="words-known"
              />
              <Ladder
                rungs={KNOWN_MILESTONES}
                count={progress.data.knownWords}
                testID="words-ladder"
              />
              <Text style={styles.note}>
                A word is known once it has graduated out of learning in reviews.
              </Text>
            </Section>

            <Section title="Reading" testID="section-reading">
              <Bar
                value={progress.data.storiesRead}
                target={progress.data.storyMilestone}
                unit="stories finished"
                testID="stories-finished"
              />
              <Ladder
                rungs={STORY_MILESTONES}
                count={progress.data.storiesRead}
                testID="stories-ladder"
              />
            </Section>

            <Section title="Books and requests" testID="section-books">
              <View style={styles.figures}>
                <Figure
                  value={progress.data.booksFinished}
                  label="Books finished"
                  testID="books-finished"
                />
                {/* Gated on its own query, like the Streak section above: this
                    figure comes from `['progress-report']`, and a "0" shown
                    while that is still loading (or after it failed) would read
                    as "nothing has been answered" rather than "not known yet". */}
                {report.data ? (
                  <Figure
                    value={report.data.requestsFulfilled}
                    label="Requests answered"
                    testID="requests-fulfilled"
                  />
                ) : null}
              </View>
            </Section>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** XP: the ring for today, and the level the lifetime total has reached. */
function XpSection({ total, today }: { total: number; today: number }) {
  const level = levelProgress(total);

  return (
    <Section title="XP" testID="section-xp">
      <View style={styles.xpRow}>
        <XpRing today={today} />
        <View style={styles.xpText}>
          <Text style={styles.xpToday} testID="xp-today">
            {today} of {DAILY_GOAL} XP today
          </Text>
          <Text style={styles.xpTotal} testID="xp-total">
            {total} XP in all — level {level.level}
          </Text>
        </View>
      </View>
      <Bar
        value={level.into}
        target={level.needed}
        unit={`XP towards level ${level.level + 1}`}
        testID="xp-level"
      />
    </Section>
  );
}

function Section({
  title,
  children,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  testID: string;
}) {
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

/** One number with its label, in a row of two or three. */
function Figure({
  value,
  label,
  caption,
  accent,
  testID,
}: {
  value: number;
  label: string;
  caption?: string;
  accent?: boolean;
  testID: string;
}) {
  return (
    <View style={styles.figure} testID={testID}>
      <Text style={[styles.figureValue, accent && styles.figureValueAccent]}>{value}</Text>
      <Text style={styles.figureLabel}>{label}</Text>
      {caption ? <Text style={styles.figureCaption}>{caption}</Text> : null}
    </View>
  );
}

/** "12 / 30 letters mastered", with the bar underneath. */
function Bar({
  value,
  target,
  unit,
  testID,
}: {
  value: number;
  target: number;
  unit: string;
  testID: string;
}) {
  // `target` comes from a ladder rung or a constant, so it is never zero — the
  // guard is for the division, not for a case that happens.
  const fraction = target > 0 ? Math.min(1, Math.max(0, value / target)) : 1;

  return (
    <View style={styles.bar} testID={testID}>
      <Text style={styles.barLabel}>
        <Text style={styles.barValue}>
          {value} / {target}
        </Text>{' '}
        {unit}
      </Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${fraction * 100}%` }]} />
      </View>
    </View>
  );
}

/**
 * A milestone ladder, every rung shown at once: the ones passed are the record,
 * and the ones ahead are what the count is walking towards.
 */
function Ladder({
  rungs,
  count,
  testID,
}: {
  rungs: readonly number[];
  count: number;
  testID: string;
}) {
  return (
    <View style={styles.ladder} testID={testID}>
      {rungs.map((rung) => {
        const reached = count >= rung;
        return (
          <View
            key={rung}
            style={[styles.rung, reached && styles.rungReached]}
            testID={`${testID}-${rung}`}
          >
            <Text style={[styles.rungValue, reached && styles.rungValueReached]}>{rung}</Text>
            <Text style={styles.rungMark}>{reached ? '✓' : '·'}</Text>
          </View>
        );
      })}
    </View>
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
  loading: { marginVertical: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase' },
  figures: { flexDirection: 'row', gap: spacing.sm },
  figure: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  figureValue: { fontSize: 34, fontWeight: '700', color: colors.primary },
  figureValueAccent: { color: colors.accent },
  figureLabel: { fontSize: 13, color: colors.text, marginTop: spacing.xs },
  figureCaption: { fontSize: 12, color: colors.textMuted },
  xpRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  xpText: { flexShrink: 1, gap: 2 },
  xpToday: { fontSize: 17, fontWeight: '600', color: colors.text },
  xpTotal: { fontSize: 14, color: colors.textMuted },
  bar: { gap: spacing.xs },
  barLabel: { fontSize: 14, color: colors.textMuted },
  barValue: { fontSize: 15, fontWeight: '700', color: colors.text },
  barTrack: {
    height: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.disabled,
    overflow: 'hidden',
  },
  barFill: { height: 8, borderRadius: radius.sm, backgroundColor: colors.primary },
  note: { fontSize: 12, color: colors.textMuted },
  ladder: { flexDirection: 'row', gap: spacing.sm },
  rung: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
  },
  rungReached: { borderColor: colors.primary },
  rungValue: { fontSize: 17, fontWeight: '700', color: colors.textMuted },
  rungValueReached: { color: colors.primary },
  rungMark: { fontSize: 12, color: colors.textMuted },
  errorText: { color: colors.danger, fontSize: 14 },
  retry: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
});
