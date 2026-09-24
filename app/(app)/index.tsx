/**
 * Home: three things to do, and a way to everything else.
 *
 * This used to be eleven equal tiles, and with nothing standing out Mark
 * avoided the screen. It is now Letters, Practise and My words, with every
 * other screen one quiet "More" link away. Nothing was removed from the app —
 * every route still works — it just no longer competes for the first tap.
 *
 * Which card is the big one is the only decision (`lib/home.ts`): the letters
 * while any of the thirty are still to learn, then Practise. Once the letters
 * are done their card shrinks to a one-line link rather than disappearing, so
 * a run to keep them fresh is still one tap away.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
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
import {
  LETTERS_DONE_LINK,
  lettersLeading,
  lettersProgressLine,
  myWordsLine,
  practiseLine,
} from '@/lib/home';
import { LETTER_TOTAL } from '@/lib/stages';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { DAILY_GOAL } from '@/lib/xp';

export default function DashboardScreen() {
  const router = useRouter();

  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.getDashboard(),
  });
  // The letters count and the known-word count, both from the one read the
  // progress screen makes — so neither card can quote a number that screen
  // disagrees with.
  const progress = useQuery({
    queryKey: ['progress'],
    queryFn: () => api.getProgress(),
  });
  // Today's ring. Its own query, shared verbatim with the progress screen, so
  // opening that screen re-uses this entry rather than asking again.
  const xp = useQuery({ queryKey: ['xp'], queryFn: () => api.getXpSummary() });

  const mastered = progress.data?.letterMastery.mastered;
  const leading = lettersLeading(mastered);
  const known = progress.data?.knownWords;

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={dashboard.isRefetching}
          onRefresh={() => {
            void dashboard.refetch();
            void progress.refetch();
            void xp.refetch();
          }}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.content}>
        <DashboardHeader
          streakDays={dashboard.data?.streakDays ?? 0}
          // null, not 0, when the ledger could not be read: "0 of 30 XP today"
          // is what a day with no work done looks like, and a failed query must
          // not be able to impersonate one.
          todayXp={xp.isError ? null : (xp.data?.today ?? 0)}
        />

        {progress.isError ? (
          <ErrorCard
            message={errorMessage(progress.error, 'Could not count your letters and words.')}
            onRetry={() => void progress.refetch()}
          />
        ) : null}
        {dashboard.isError ? (
          <ErrorCard
            message={errorMessage(dashboard.error, 'Could not load what is waiting today.')}
            onRetry={() => void dashboard.refetch()}
          />
        ) : null}

        {leading ? (
          <LettersCard
            line={
              progress.isPending
                ? null
                : progress.isError
                  ? 'Drill the thirty letters, with real recordings'
                  : lettersProgressLine(mastered ?? 0)
            }
            mastered={mastered ?? 0}
            onPress={() => router.push('/letters')}
          />
        ) : null}

        <BigCard
          title="Practise"
          line={dashboard.isPending ? null : practiseLine(dashboard.data?.dueCount)}
          // The main thing once the letters are done; a strong second before.
          primary={!leading}
          testID="home-practise"
          onPress={() => router.push('/practise')}
        />

        <MyWordsCard
          line={progress.isPending ? null : myWordsLine(progress.isError ? 0 : known)}
          onOpen={() => router.push('/library')}
          onAdd={() => router.push('/add')}
        />

        {!leading ? (
          <QuietLink
            label={LETTERS_DONE_LINK}
            testID="home-letters-done"
            onPress={() => router.push('/letters')}
          />
        ) : null}

        <QuietLink label="More" testID="home-more" onPress={() => router.push('/more')} />
      </View>
    </ScrollView>
  );
}

/**
 * The streak and today's XP ring, and the way in to the progress screen.
 *
 * Deliberately compact (spec §10). Every other figure the app counts — the
 * streak record, the XP total and level, the ladders — lives on the progress
 * screen, which this row is the way in to. Repeating them here would make the
 * first thing seen each morning a report rather than a prompt.
 */
function DashboardHeader({
  streakDays,
  todayXp,
}: {
  streakDays: number;
  /** Today's XP, or null when the ledger could not be read at all. */
  todayXp: number | null;
}) {
  const router = useRouter();
  const xpSpoken =
    todayXp === null ? 'today’s XP unavailable' : `${todayXp} of ${DAILY_GOAL} XP today`;

  return (
    <Pressable
      style={({ pressed }) => [styles.headerStats, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Progress. ${streakDays} day streak, ${xpSpoken}.`}
      testID="header-progress"
      onPress={() => router.push('/progress')}
    >
      <View style={styles.headerStat} testID="stat-streak">
        <Text style={styles.headerStatValue}>{streakDays}</Text>
        <Text style={styles.headerStatLabel}>day{streakDays === 1 ? '' : 's'} in a row</Text>
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
            <XpRing today={todayXp} size={60} hole={colors.surface} />
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
  );
}

/**
 * The first job while any letters are left: how far along he is, a bar that
 * shows it without reading, and the button into the drill.
 */
function LettersCard({
  line,
  mastered,
  onPress,
}: {
  /** null while the count is still loading. */
  line: string | null;
  mastered: number;
  onPress: () => void;
}) {
  const share = Math.max(0, Math.min(1, mastered / LETTER_TOTAL));
  return (
    <Pressable
      style={({ pressed }) => [styles.bigCard, styles.bigCardPrimary, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={line ? `Letters, ${line}` : 'Letters'}
      testID="home-letters"
      onPress={onPress}
    >
      <Text style={[styles.bigTitle, styles.onPrimary]}>Letters</Text>
      {line === null ? (
        <ActivityIndicator color={colors.primaryOn} style={styles.lineSpinner} />
      ) : (
        <Text style={[styles.bigLine, styles.onPrimary]} testID="home-letters-line">
          {line}
        </Text>
      )}
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${share * 100}%` }]} />
      </View>
    </Pressable>
  );
}

/** A card that is one tap: Practise, primary or not. */
function BigCard({
  title,
  line,
  primary,
  testID,
  onPress,
}: {
  title: string;
  /** null while the count is still loading. */
  line: string | null;
  primary: boolean;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.bigCard,
        primary ? styles.bigCardPrimary : styles.bigCardSecondary,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={line ? `${title}, ${line}` : title}
      testID={testID}
      onPress={onPress}
    >
      <View style={styles.bigRow}>
        <View style={styles.bigText}>
          <Text style={[styles.bigTitle, primary ? styles.onPrimary : styles.onSurface]}>
            {title}
          </Text>
          {line === null ? (
            <ActivityIndicator
              color={primary ? colors.primaryOn : colors.primary}
              style={styles.lineSpinner}
            />
          ) : (
            <Text
              style={[styles.bigLine, primary ? styles.onPrimary : styles.muted]}
              testID={`${testID}-line`}
            >
              {line}
            </Text>
          )}
        </View>
        <Text style={[styles.bigChevron, primary ? styles.onPrimary : styles.onSurfacePrimary]}>
          ›
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * My words, and the way to put one on it.
 *
 * The add button is a sibling of the card rather than inside it: on web a
 * `Pressable` is a real <button>, and a button inside a button is invalid HTML
 * as well as an ambiguous tap.
 */
function MyWordsCard({
  line,
  onOpen,
  onAdd,
}: {
  line: string | null;
  onOpen: () => void;
  onAdd: () => void;
}) {
  return (
    <View style={styles.wordsRow}>
      <Pressable
        style={({ pressed }) => [
          styles.bigCard,
          styles.bigCardSecondary,
          styles.grow,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={line ? `My words, ${line}` : 'My words'}
        testID="home-my-words"
        onPress={onOpen}
      >
        <Text style={[styles.bigTitle, styles.onSurface]}>My words</Text>
        {line === null ? (
          <ActivityIndicator color={colors.primary} style={styles.lineSpinner} />
        ) : (
          <Text style={[styles.bigLine, styles.muted]} testID="home-my-words-line">
            {line}
          </Text>
        )}
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Add a word"
        testID="home-add-word"
        onPress={onAdd}
      >
        <Text style={styles.addButtonLabel}>+ Add a word</Text>
      </Pressable>
    </View>
  );
}

function QuietLink({
  label,
  testID,
  onPress,
}: {
  label: string;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.quietLink, pressed && styles.pressed]}
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
    >
      <Text style={styles.quietLinkText}>{label}</Text>
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
    gap: spacing.md,
  },
  headerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  headerStat: { flex: 1, alignItems: 'center', gap: 2 },
  headerLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerLinkText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  headerStatValue: { fontSize: 32, fontWeight: '700', color: colors.accent },
  headerStatLabel: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  bigCard: {
    minHeight: touchTarget + 40,
    justifyContent: 'center',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  bigCardPrimary: { backgroundColor: colors.primary },
  bigCardSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  bigRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bigText: { flexShrink: 1, gap: spacing.xs },
  bigTitle: { fontSize: 28, fontWeight: '700' },
  bigLine: { fontSize: 15 },
  bigChevron: { fontSize: 36 },
  onPrimary: { color: colors.primaryOn },
  onSurface: { color: colors.text },
  onSurfacePrimary: { color: colors.primary },
  muted: { color: colors.textMuted },
  lineSpinner: { alignSelf: 'flex-start' },
  bar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  barFill: { height: '100%', backgroundColor: colors.primaryOn },
  wordsRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  grow: { flex: 1 },
  addButton: {
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    maxWidth: 120,
  },
  addButtonLabel: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  quietLink: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  quietLinkText: { fontSize: 17, fontWeight: '600', color: colors.primary },
  chevron: { fontSize: 28, color: colors.primary },
  pressed: { opacity: 0.8 },
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
