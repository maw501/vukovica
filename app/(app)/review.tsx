/**
 * The review session — the daily loop the whole app exists for.
 *
 * A session is built **once**, from one `getQueue()` read, and then lives in
 * memory: `lib/session.ts` owns the running order (including re-showing a card
 * answered Again), and every answer is written straight through by
 * `api.submitReview`. Re-entering the screen builds a fresh session, so the
 * queue on screen is never a stale copy of the database.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { api, type DashboardStats, type QueueEntry } from '@/lib/api';
import { audioSupported, playText } from '@/lib/audio';
import { errorMessage } from '@/lib/errors';
import { formatInterval } from '@/lib/format';
import { gradeIntervals, newUserCard, type ReviewGrade } from '@/lib/fsrs';
import {
  answerCurrent,
  createSession,
  currentCardId,
  isSessionComplete,
  sessionProgress,
  sessionTotalAnswers,
  type SessionState,
} from '@/lib/session';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { cyrToLat } from '@/lib/transliterate';
import type { UserCardRow } from '@/lib/types';

const GRADES: { grade: ReviewGrade; label: string; colour: string }[] = [
  { grade: 1, label: 'Again', colour: colors.accent },
  { grade: 2, label: 'Hard', colour: '#B4731F' },
  { grade: 3, label: 'Good', colour: colors.primary },
  { grade: 4, label: 'Easy', colour: '#2F7A4D' },
];

/** What a single answer needs in order to be saved and counted. */
interface GradeVars {
  cardId: string;
  grade: ReviewGrade;
  /** Whether this answer should move the dashboard's "new today" figure. */
  countsAsNew: boolean;
  /** Whether it should decrement the dashboard's Due figure. */
  countsAsDue: boolean;
}

export default function ReviewScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const queue = useQuery({
    queryKey: ['queue'],
    queryFn: () => api.getQueue(),
    // Always refetched on mount (the root default is 30s), never mid-session:
    // a session that reshuffled itself under the user's thumb would be worse
    // than a slightly stale one.
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() });

  const [session, setSession] = useState<SessionState | null>(null);
  const [entries, setEntries] = useState<ReadonlyMap<string, QueueEntry>>(new Map());
  const [revealed, setRevealed] = useState(false);
  const [failures, setFailures] = useState<GradeVars[]>([]);

  /**
   * The latest saved row per card. A card answered Again comes round again in
   * the same session, and its second grade has to start from the row the first
   * grade produced — otherwise FSRS reschedules from scratch and the log claims
   * `state_before = 'new'` a second time, quietly spending two of the day's
   * new-card budget on one card.
   */
  const latestRows = useRef(new Map<string, UserCardRow | null>());
  /** Saves run one at a time, so `latestRows` is current before the next starts. */
  const submitChain = useRef<Promise<unknown>>(Promise.resolve());
  /** Cards already answered this session, for the dashboard's optimistic maths. */
  const answered = useRef(new Set<string>());

  // Build the session the first time the queue arrives, and never again while
  // the screen is mounted. `entries` is snapshotted with it so a background
  // refetch cannot make the card being looked at disappear.
  useEffect(() => {
    if (!queue.data || session !== null) return;
    setEntries(new Map(queue.data.map((entry) => [entry.cardId, entry])));
    latestRows.current = new Map(queue.data.map((entry) => [entry.cardId, entry.userCard]));
    answered.current = new Set();
    setSession(createSession(queue.data.map((entry) => entry.cardId)));
  }, [queue.data, session]);

  const submit = useMutation({
    mutationFn: ({ cardId, grade }: GradeVars) => {
      const run = submitChain.current.then(async () => {
        const saved = await api.submitReview({
          cardId,
          grade,
          userCard: latestRows.current.get(cardId) ?? null,
        });
        latestRows.current.set(cardId, saved);
        return saved;
      });
      // The chain must survive a failed link, or one network blip would stall
      // every later save in the session.
      submitChain.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    onMutate: async ({ countsAsNew, countsAsDue }: GradeVars) => {
      await queryClient.cancelQueries({ queryKey: ['dashboard'] });
      queryClient.setQueryData<DashboardStats>(['dashboard'], (previous) =>
        previous
          ? {
              dueCount: countsAsDue ? Math.max(0, previous.dueCount - 1) : previous.dueCount,
              newAvailable: countsAsNew
                ? Math.max(0, previous.newAvailable - 1)
                : previous.newAvailable,
              newDoneToday: countsAsNew ? previous.newDoneToday + 1 : previous.newDoneToday,
              // Answering anything today makes the streak at least 1.
              streakDays: Math.max(previous.streakDays, 1),
            }
          : previous,
      );
    },
    onError: (_error, variables) => {
      setFailures((current) => [...current, variables]);
    },
    onSettled: () => {
      // Inactive while this screen is up, so this marks it stale rather than
      // refetching -- the dashboard reloads when the user goes back to it.
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const cardId = session ? currentCardId(session) : null;
  const entry = cardId ? entries.get(cardId) : undefined;

  const grade = useCallback(
    (value: ReviewGrade) => {
      if (!session || !entry) return;
      const id = entry.cardId;
      const first = !answered.current.has(id);
      answered.current.add(id);

      submit.mutate({
        cardId: id,
        grade: value,
        // Only the first answer of a card moves the dashboard: an Again re-show
        // is the same card again, not another due card and not another new one.
        countsAsNew: first && entry.isNew,
        countsAsDue: first && !entry.isNew,
      });

      setSession(answerCurrent(session, value));
      setRevealed(false);
    },
    [entry, session, submit],
  );

  const retryFailures = useCallback(() => {
    const pending = failures;
    setFailures([]);
    for (const variables of pending) {
      // The optimistic dashboard patch already happened on the first attempt.
      submit.mutate({ ...variables, countsAsNew: false, countsAsDue: false });
    }
  }, [failures, submit]);

  /**
   * Back to the dashboard. `router.back()` alone is not enough: opening
   * `/review` as a deep link (or a PWA reload on this route) leaves nothing on
   * the stack to go back to, and the button would silently do nothing.
   */
  const goHome = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const restart = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
    setSession(null);
    setRevealed(false);
  }, [queryClient]);

  if (queue.isPending || settings.isPending || session === null) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (queue.isError) {
    return (
      <View style={styles.centred}>
        <Text style={styles.error} testID="queue-error">
          {errorMessage(queue.error, 'Could not load your cards.')}
        </Text>
        <Pressable style={styles.textButton} onPress={() => void queue.refetch()}>
          <Text style={styles.textButtonLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const showLatin = settings.data?.show_latin ?? true;
  const ttsEnabled = settings.data?.tts_enabled ?? true;

  if (isSessionComplete(session)) {
    return (
      <Summary
        session={session}
        onDone={goHome}
        onMore={restart}
        failures={failures.length}
        onRetry={retryFailures}
      />
    );
  }

  if (!entry) {
    // Unreachable: the session's ids come from `entries`. Better a message than
    // a blank screen if it ever happens.
    return (
      <View style={styles.centred}>
        <Text style={styles.error}>That card is no longer available.</Text>
        <Pressable style={styles.textButton} onPress={restart}>
          <Text style={styles.textButtonLabel}>Rebuild the session</Text>
        </Pressable>
      </View>
    );
  }

  const { position, total } = sessionProgress(session);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        <View style={styles.progressRow}>
          <Text style={styles.progress} testID="progress">
            {position} of {total}
          </Text>
          {entry.isNew ? (
            <Text style={styles.newBadge} testID="new-badge">
              new
            </Text>
          ) : null}
        </View>

        {failures.length > 0 ? (
          <View style={styles.banner} testID="save-error">
            <Text style={styles.bannerText}>
              {failures.length} answer{failures.length === 1 ? '' : 's'} could not be saved.
            </Text>
            <Pressable style={styles.bannerButton} onPress={retryFailures} accessibilityRole="button">
              <Text style={styles.bannerButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {/*
          The speaker buttons are siblings of the tap area, not children of it:
          on web a `Pressable` is a real <button>, and a button inside a button
          is invalid HTML (React says so out loud) as well as an ambiguous tap.
        */}
        <View style={styles.card}>
          <Pressable
            style={styles.cardTap}
            onPress={() => setRevealed(true)}
            disabled={revealed}
            accessibilityRole="button"
            accessibilityLabel="Show the answer"
            testID="card"
          >
            <Text style={styles.cyrillic} testID="card-cyr">
              {entry.card.sr_cyr}
            </Text>

            {revealed ? (
              <View style={styles.answer} testID="card-answer">
                {showLatin ? (
                  <Text style={styles.latin} testID="card-lat">
                    {cyrToLat(entry.card.sr_cyr)}
                  </Text>
                ) : null}
                <Text style={styles.english} testID="card-en">
                  {entry.card.en}
                </Text>
                <View style={styles.metaRow}>
                  {[entry.card.pos, entry.card.gender, entry.card.aspect]
                    .filter((value): value is string => Boolean(value))
                    .map((value) => (
                      <Text key={value} style={styles.meta}>
                        {value}
                      </Text>
                    ))}
                </View>

                <View style={styles.divider} />

                <Text style={styles.exampleCyr} testID="card-example-cyr">
                  {entry.card.example_cyr}
                </Text>
                {showLatin ? (
                  <Text style={styles.exampleLat}>{cyrToLat(entry.card.example_cyr)}</Text>
                ) : null}
                <Text style={styles.exampleEn}>{entry.card.example_en}</Text>
              </View>
            ) : (
              <Text style={styles.hint}>Tap to show the answer</Text>
            )}
          </Pressable>

          <View style={styles.speakRow}>
            <SpeakButton
              text={entry.card.sr_cyr}
              label="word"
              enabled={ttsEnabled}
              testID="speak-word"
            />
            {revealed ? (
              <SpeakButton
                text={entry.card.example_cyr}
                label="example"
                enabled={ttsEnabled}
                testID="speak-example"
              />
            ) : null}
          </View>
        </View>

        {revealed ? (
          <GradeButtons entry={entry} latestRow={latestRows.current.get(entry.cardId) ?? null} onGrade={grade} />
        ) : (
          <Pressable
            style={({ pressed }) => [styles.revealButton, pressed && styles.pressed]}
            onPress={() => setRevealed(true)}
            accessibilityRole="button"
            testID="reveal"
          >
            <Text style={styles.revealButtonText}>Show answer</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

function GradeButtons({
  entry,
  latestRow,
  onGrade,
}: {
  entry: QueueEntry;
  latestRow: UserCardRow | null;
  onGrade: (grade: ReviewGrade) => void;
}) {
  // Recomputed per card: the row a preview starts from changes as the session
  // goes on (an Again-graded card comes back already in `learning`).
  const intervals = useMemo(() => {
    // A preview never leaves this component, so the ids on the synthesised row
    // are immaterial -- FSRS looks only at the scheduling columns.
    const row = latestRow ?? newUserCard('', entry.cardId);
    return gradeIntervals(row);
  }, [entry.cardId, latestRow]);

  return (
    <View style={styles.grades}>
      {GRADES.map(({ grade, label, colour }) => (
        <Pressable
          key={grade}
          style={({ pressed }) => [styles.grade, { borderColor: colour }, pressed && styles.pressed]}
          onPress={() => onGrade(grade)}
          accessibilityRole="button"
          accessibilityLabel={label}
          testID={`grade-${grade}`}
        >
          <Text style={[styles.gradeLabel, { color: colour }]}>{label}</Text>
          <Text style={styles.gradeInterval}>{formatInterval(intervals[grade])}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Speaker button. It removes itself as soon as it learns there is no audio —
 * no TTS key on the server, an unsupported platform, or a browser that refused
 * to play — rather than sitting there doing nothing when pressed.
 */
function SpeakButton({
  text,
  label,
  enabled,
  testID,
}: {
  text: string;
  /** What the clip is ("word" / "example"), so two speakers are tellable apart. */
  label: string;
  enabled: boolean;
  testID: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'unavailable'>('idle');

  // A new card means a new sentence to try; forget a previous failure.
  useEffect(() => setState('idle'), [text]);

  if (!enabled || !audioSupported() || state === 'unavailable') return null;

  return (
    <Pressable
      style={({ pressed }) => [styles.speak, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Play ${text}`}
      testID={testID}
      onPress={() => {
        setState('busy');
        void playText(text).then((played) => setState(played ? 'idle' : 'unavailable'));
      }}
    >
      <Text style={styles.speakIcon}>{state === 'busy' ? '…' : '🔊'}</Text>
      <Text style={styles.speakLabel}>{label}</Text>
    </Pressable>
  );
}

function Summary({
  session,
  onDone,
  onMore,
  failures,
  onRetry,
}: {
  session: SessionState;
  onDone: () => void;
  onMore: () => void;
  failures: number;
  onRetry: () => void;
}) {
  const total = sessionTotalAnswers(session);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.content} testID="summary">
        <Text style={styles.summaryTitle}>{total === 0 ? 'Nothing to study' : 'Браво!'}</Text>
        <Text style={styles.summarySubtitle} testID="summary-total">
          {total === 0
            ? 'No cards are due right now. Come back later, or add new words to the deck.'
            : `${total} answer${total === 1 ? '' : 's'} in this session`}
        </Text>

        {total > 0 ? (
          <View style={styles.summaryRow}>
            {GRADES.map(({ grade, label, colour }) => (
              <View key={grade} style={styles.summaryStat} testID={`summary-count-${grade}`}>
                <Text style={[styles.summaryValue, { color: colour }]}>{session.counts[grade]}</Text>
                <Text style={styles.summaryLabel}>{label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {failures > 0 ? (
          <View style={styles.banner} testID="save-error">
            <Text style={styles.bannerText}>
              {failures} answer{failures === 1 ? '' : 's'} could not be saved.
            </Text>
            <Pressable style={styles.bannerButton} onPress={onRetry} accessibilityRole="button">
              <Text style={styles.bannerButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.revealButton, pressed && styles.pressed]}
          onPress={onDone}
          accessibilityRole="button"
          testID="summary-done"
        >
          <Text style={styles.revealButtonText}>Back to the dashboard</Text>
        </Pressable>
        <Pressable style={styles.textButton} onPress={onMore} accessibilityRole="button" testID="summary-more">
          <Text style={styles.textButtonLabel}>Check for more cards</Text>
        </Pressable>
      </View>
    </ScrollView>
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
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  progress: { fontSize: 13, color: colors.textMuted },
  newBadge: {
    fontSize: 11,
    textTransform: 'uppercase',
    color: colors.primaryOn,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 220,
    justifyContent: 'center',
  },
  cardTap: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.sm },
  cyrillic: { fontSize: 44, fontWeight: '700', color: colors.text, textAlign: 'center' },
  hint: { fontSize: 13, color: colors.textMuted, marginTop: spacing.md },
  answer: { alignItems: 'center', gap: spacing.xs, alignSelf: 'stretch' },
  latin: { fontSize: 20, color: colors.textMuted },
  english: { fontSize: 24, fontWeight: '600', color: colors.primary, textAlign: 'center' },
  metaRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  meta: {
    fontSize: 12,
    color: colors.textMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  divider: { height: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginVertical: spacing.sm },
  exampleCyr: { fontSize: 18, color: colors.text, textAlign: 'center' },
  exampleLat: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  exampleEn: { fontSize: 14, color: colors.textMuted, textAlign: 'center', fontStyle: 'italic' },
  speakRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  speak: {
    minWidth: touchTarget + 12,
    minHeight: touchTarget - 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakIcon: { fontSize: 22 },
  speakLabel: { fontSize: 11, color: colors.textMuted },
  revealButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  revealButtonText: { color: colors.primaryOn, fontSize: 17, fontWeight: '600' },
  grades: { flexDirection: 'row', gap: spacing.sm },
  grade: {
    flex: 1,
    minHeight: touchTarget + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 2,
    backgroundColor: colors.surface,
    paddingHorizontal: 2,
  },
  gradeLabel: { fontSize: 15, fontWeight: '700' },
  gradeInterval: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  pressed: { opacity: 0.8 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerText: { flex: 1, color: colors.danger, fontSize: 13 },
  bannerButton: { minHeight: touchTarget - 12, justifyContent: 'center', paddingHorizontal: spacing.sm },
  bannerButtonText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  summaryTitle: { fontSize: 32, fontWeight: '700', color: colors.text, textAlign: 'center' },
  summarySubtitle: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  summaryRow: { flexDirection: 'row', gap: spacing.sm },
  summaryStat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  summaryValue: { fontSize: 28, fontWeight: '700' },
  summaryLabel: { fontSize: 12, color: colors.textMuted },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
});
