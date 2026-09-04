/**
 * The review session — the daily loop the whole app exists for.
 *
 * A session is built **once**, from one `getQueue()` read, and then lives in
 * memory: `lib/session.ts` owns the running order (including re-showing a card
 * answered Again), and every answer is written straight through by
 * `api.submitReview`. Re-entering the screen builds a fresh session, so the
 * queue on screen is never a stale copy of the database.
 *
 * Words, and only words. The letters used to ride on this screen as a second
 * deck — same FSRS, same grade buttons, five new a day — and they have their own
 * screen now (`app/(app)/letters.tsx`), because an alphabet is something to
 * drill on demand rather than something to be told to come back tomorrow for.
 * `/review?deck=letters` still works: it redirects there, so every link and
 * bookmark that was made while the deck existed still lands somewhere sensible.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { MarkKnownButton } from '@/components/MarkKnownButton';
import { ScriptText } from '@/components/ScriptText';
import { SpeakButton } from '@/components/SpeakButton';
import { api, type DashboardStats, type QueueEntry } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
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
  skipCurrent,
  type SessionState,
} from '@/lib/session';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { cyrToLat } from '@/lib/transliterate';
import type { CardRow, UserCardRow } from '@/lib/types';

const GRADES: { grade: ReviewGrade; label: string; colour: string }[] = [
  { grade: 1, label: 'Again', colour: colors.accent },
  { grade: 2, label: 'Hard', colour: '#B4731F' },
  { grade: 3, label: 'Good', colour: colors.primary },
  { grade: 4, label: 'Easy', colour: '#2F7A4D' },
];

/** What to say when the session had nothing in it. */
const NOTHING_DUE =
  'No cards are due right now. Come back later, or add new words to the deck.';

/**
 * Where the dashboard keeps the figures this screen moves: inside the habit
 * card's `['dashboard']` entry, which comes back with the streak in one call.
 */
const STATS_KEY = ['dashboard'] as const;

/** Asked before walking away from answers that never reached the database. */
function confirmLeavingUnsaved(count: number): Promise<boolean> {
  const answers = count === 1 ? '1 answer' : `${count} answers`;
  return confirmAction({
    title: 'Unsaved answers',
    message:
      `${answers} could not be saved. Leaving now discards ${count === 1 ? 'it' : 'them'} — ` +
      `${count === 1 ? 'that card' : 'those cards'} will simply come round again in a later ` +
      'session. Leave anyway?',
    confirmLabel: 'Leave',
    destructive: true,
  });
}

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
  const navigation = useNavigation();
  const queryClient = useQueryClient();

  // The letters used to be `?deck=letters` on this screen. The parameter is
  // still read, for one purpose only: sending an old link to the drill that
  // replaced it. Every other value (including none at all) is the word deck,
  // which is now the only deck there is.
  const params = useLocalSearchParams<{ deck?: string }>();
  const wantsLetters = (Array.isArray(params.deck) ? params.deck[0] : params.deck) === 'letters';

  const queue = useQuery({
    queryKey: ['queue'],
    queryFn: () => api.getQueue(),
    // Always refetched on mount (the root default is 30s), never mid-session:
    // a session that reshuffled itself under the user's thumb would be worse
    // than a slightly stale one.
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
    // Nothing on the redirect path needs the settings row; asking for it while
    // this screen is on its way out would be a round trip for a screen nobody
    // is going to see.
    enabled: !wantsLetters,
  });

  const [session, setSession] = useState<SessionState | null>(null);
  const [entries, setEntries] = useState<ReadonlyMap<string, QueueEntry>>(new Map());
  const [revealed, setRevealed] = useState(false);
  const [failures, setFailures] = useState<GradeVars[]>([]);
  /** True between "check for more cards" and the rebuilt session appearing. */
  const [restarting, setRestarting] = useState(false);
  /**
   * Words declared known this session, so the summary can say what became of
   * them. Deliberately not part of `SessionState`: they are not answers, and
   * the grade tallies must not learn to count something that was never graded.
   */
  const [markedKnown, setMarkedKnown] = useState(0);

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
  /**
   * Answers that did not save, as the *chain* knows them. `failures` mirrors
   * this for rendering, but React state is not a truthful answer to "is anything
   * lost?" the instant a save settles — a `setState` after the screen has gone is
   * a silent no-op, and the leave guard has to be sure.
   */
  const failuresRef = useRef<GradeVars[]>([]);

  // Build the session when the queue arrives, and not while a fetch is in
  // flight: `restart` clears the session on purpose, and a build against the
  // previous array would re-present cards that were just answered and re-seed
  // `latestRows` with their pre-grade rows. `entries` is snapshotted with the
  // session so a later refetch cannot make the card on screen disappear.
  useEffect(() => {
    if (!queue.data || queue.isFetching || session !== null) return;
    setEntries(new Map(queue.data.map((entry) => [entry.cardId, entry])));
    latestRows.current = new Map(queue.data.map((entry) => [entry.cardId, entry.userCard]));
    answered.current = new Set();
    setMarkedKnown(0);
    setSession(createSession(queue.data.map((entry) => entry.cardId)));
  }, [queue.data, queue.isFetching, session]);

  const submit = useMutation({
    mutationFn: (variables: GradeVars) => {
      const { cardId, grade } = variables;
      const run = submitChain.current.then(async () => {
        const saved = await api.submitReview({
          cardId,
          grade,
          userCard: latestRows.current.get(cardId) ?? null,
        });
        latestRows.current.set(cardId, saved);
        // XP for the answer, both decks alike: a letter answered is a card
        // answered (spec §10 sets one review tariff, not one per deck).
        //
        // Awaited so `onSettled`'s invalidation cannot race the insert, but
        // never allowed to fail the answer: the review itself is saved by this
        // point, and losing two points is not worth telling the user their
        // answer did not save.
        await api.awardXp('review').catch(() => undefined);
        return saved;
      });
      // The chain must survive a failed link, or one network blip would stall
      // every later save in the session. Recording the failure here rather than
      // in `onError` means it is on the books by the time the chain settles,
      // which is what `goHome` waits for.
      submitChain.current = run.then(
        () => undefined,
        () => {
          failuresRef.current = [...failuresRef.current, variables];
          setFailures(failuresRef.current);
        },
      );
      return run;
    },
    onMutate: async ({ countsAsNew, countsAsDue }: GradeVars) => {
      await queryClient.cancelQueries({ queryKey: STATS_KEY });
      const previous = queryClient.getQueryData<DashboardStats>(STATS_KEY);
      // Spread rather than rebuild: the entry is a `DashboardStats`, which
      // carries the streak this patch has no business dropping.
      queryClient.setQueryData<DashboardStats>(STATS_KEY, (current) =>
        current
          ? {
              ...current,
              dueCount: countsAsDue ? Math.max(0, current.dueCount - 1) : current.dueCount,
              newAvailable: countsAsNew
                ? Math.max(0, current.newAvailable - 1)
                : current.newAvailable,
              newDoneToday: countsAsNew ? current.newDoneToday + 1 : current.newDoneToday,
              // Answering anything today makes the streak at least 1.
              streakDays: Math.max(current.streakDays, 1),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      // Undo the optimistic patch: a save that failed must not leave the
      // dashboard claiming the card was answered, however briefly.
      if (context?.previous) queryClient.setQueryData(STATS_KEY, context.previous);
    },
    onSettled: () => {
      // Inactive while this screen is up, so this marks it stale rather than
      // refetching -- the dashboard reloads when the user goes back to it.
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      // A card graduating to 'review' is a word learnt, which moves the Words
      // goal and can move the stage itself.
      void queryClient.invalidateQueries({ queryKey: ['progress'] });
      // ...and every answer moves the XP ring, whether or not it graduated.
      void queryClient.invalidateQueries({ queryKey: ['xp'] });
    },
  });

  /**
   * Leaving with answers that never saved.
   *
   * The loss is bounded — `submit_review` is atomic, so a failed answer wrote
   * nothing and the card simply comes round again — but it is the user's effort,
   * and it should not disappear without a word. Covers the header back button
   * and `goHome` alike, since both dispatch through the navigator.
   */
  const leaveConfirmed = useRef(false);
  useEffect(() => {
    if (failures.length === 0) return;
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      // Second time round: the user has already said yes, let it through rather
      // than asking again forever.
      if (leaveConfirmed.current) return;
      event.preventDefault();
      void confirmLeavingUnsaved(failures.length).then((leave) => {
        if (!leave) return;
        leaveConfirmed.current = true;
        navigation.dispatch(event.data.action);
      });
    });
    return unsubscribe;
  }, [navigation, failures.length]);

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

  /**
   * "I already know this": the word has just been parked as known for a season,
   * so it leaves this session there and then.
   *
   * No grade is recorded and nothing is re-queued — `mark_known` has already
   * written the row, and a grade on top of it would reschedule from FSRS and
   * undo exactly the parking that was asked for. The dashboard, the Words ladder
   * and My words are refreshed by the button itself.
   */
  const markKnown = useCallback(() => {
    setMarkedKnown((current) => current + 1);
    setSession((current) => (current ? skipCurrent(current) : current));
    setRevealed(false);
  }, []);

  const retryFailures = useCallback(() => {
    const pending = failuresRef.current;
    failuresRef.current = [];
    setFailures([]);
    for (const variables of pending) {
      // The optimistic dashboard patch already happened on the first attempt.
      submit.mutate({ ...variables, countsAsNew: false, countsAsDue: false });
    }
  }, [submit]);

  /**
   * Back to the dashboard. `router.back()` alone is not enough: opening
   * `/review` as a deep link (or a PWA reload on this route) leaves nothing on
   * the stack to go back to, and the button would silently do nothing.
   *
   * Waiting on the chain first is what makes the leave guard honest — a save
   * still in flight has not failed *yet*, and its `setFailures` would land on a
   * screen that is already gone.
   */
  const goHome = useCallback(async () => {
    await submitChain.current;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  /**
   * Start a fresh session against the *current* database state.
   *
   * The order matters and is the whole point: let pending saves land, refetch
   * the queue for real, and only then clear the session.
   * `invalidateQueries` would leave the answered cards sitting in the cache, and
   * clearing the session re-renders immediately — the build effect would run
   * against that stale array, re-present cards just answered, and re-seed
   * `latestRows` with `userCard: null` for the new ones. Re-grading from there
   * writes a second `state_before = 'new'` log and rolls the FSRS row back.
   */
  const restart = useCallback(() => {
    setRestarting(true);
    void submitChain.current
      .then(() => queryClient.refetchQueries({ queryKey: ['queue'], exact: true }))
      .then(() => {
        // A refetch that failed leaves the old data in place; rebuilding from it
        // is exactly what this function exists to avoid. The query's own error
        // state renders instead.
        if (queryClient.getQueryState(['queue'])?.status === 'error') return;
        setSession(null);
        setRevealed(false);
      })
      .finally(() => setRestarting(false));
  }, [queryClient]);

  // Every hook above has run before this, deliberately: a redirect returned
  // from the middle of the hook list would change the order between renders.
  if (wantsLetters) return <Redirect href="/letters" />;

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
        markedKnown={markedKnown}
        emptyMessage={NOTHING_DUE}
        onDone={() => void goHome()}
        onMore={restart}
        restarting={restarting}
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
            <WordFace card={entry.card} revealed={revealed} showLatin={showLatin} />
          </Pressable>

          <View style={styles.speakRow}>
            <SpeakButton
              path={entry.card.audio_path}
              enabled={ttsEnabled}
              testID="speak-word"
            />
          </View>
        </View>

        {revealed ? (
          <>
            <GradeButtons entry={entry} latestRow={latestRows.current.get(entry.cardId) ?? null} onGrade={grade} />
            {/* Under the grades, not among them: this is not a fifth answer.
                Keyed by the card so a failure on one word does not leave its
                error message sitting under the next. */}
            <MarkKnownButton
              key={entry.cardId}
              cardId={entry.cardId}
              onMarked={markKnown}
              testID="review-mark-known"
            />
          </>
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

/**
 * A word card: the headword, and on reveal its Latin form, gloss, grammar
 * metadata and example sentence. Unchanged from before the letters deck landed.
 */
function WordFace({
  card,
  revealed,
  showLatin,
}: {
  card: CardRow;
  revealed: boolean;
  showLatin: boolean;
}) {
  return (
    <>
      <ScriptText role="cyr" style={styles.cyrillic} testID="card-cyr">
        {card.sr_cyr}
      </ScriptText>

      {revealed ? (
        <View style={styles.answer} testID="card-answer">
          {showLatin ? (
            <ScriptText role="lat" style={styles.latin} testID="card-lat">
              {cyrToLat(card.sr_cyr)}
            </ScriptText>
          ) : null}
          <ScriptText role="en" style={styles.english} testID="card-en">
            {card.en}
          </ScriptText>
          <View style={styles.metaRow}>
            {[card.pos, card.gender, card.aspect]
              .filter((value): value is string => Boolean(value))
              .map((value) => (
                <Text key={value} style={styles.meta}>
                  {value}
                </Text>
              ))}
          </View>

          <View style={styles.divider} />

          <ScriptText role="cyr" style={styles.exampleCyr} testID="card-example-cyr">
            {card.example_cyr}
          </ScriptText>
          {showLatin ? (
            <ScriptText role="lat" style={styles.exampleLat}>
              {cyrToLat(card.example_cyr)}
            </ScriptText>
          ) : null}
          <ScriptText role="en" style={styles.exampleEn}>
            {card.example_en}
          </ScriptText>
        </View>
      ) : (
        <Text style={styles.hint}>Tap to show the answer</Text>
      )}
    </>
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

function Summary({
  session,
  markedKnown,
  emptyMessage,
  onDone,
  onMore,
  restarting,
  failures,
  onRetry,
}: {
  session: SessionState;
  /** Words declared known rather than answered; not part of the grade tallies. */
  markedKnown: number;
  /**
   * What to say when the session had nothing in it — including an empty letters
   * deck, before the seed migration has run anywhere.
   */
  emptyMessage: string;
  onDone: () => void;
  onMore: () => void;
  /** The queue is being refetched; a new session appears when it lands. */
  restarting: boolean;
  failures: number;
  onRetry: () => void;
}) {
  const total = sessionTotalAnswers(session);
  // A session spent entirely marking words known is not an empty session, so
  // "Nothing to study" would be a lie — and neither is it answers, so it gets
  // its own line rather than being folded into the count.
  const didSomething = total > 0 || markedKnown > 0;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.content} testID="summary">
        <Text style={styles.summaryTitle}>{didSomething ? 'Well done!' : 'Nothing to study'}</Text>
        <Text style={styles.summarySubtitle} testID="summary-total">
          {didSomething
            ? `${total} answer${total === 1 ? '' : 's'} in this session`
            : emptyMessage}
        </Text>
        {markedKnown > 0 ? (
          <Text style={styles.summarySubtitle} testID="summary-known">
            {markedKnown} word{markedKnown === 1 ? '' : 's'} marked as known
          </Text>
        ) : null}

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
        <Pressable
          style={styles.textButton}
          onPress={onMore}
          disabled={restarting}
          accessibilityRole="button"
          testID="summary-more"
        >
          <Text style={styles.textButtonLabel}>
            {restarting ? 'Checking…' : 'Check for more cards'}
          </Text>
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
  // Colour and face come from `script` (see components/ScriptText.tsx) wherever
  // the text is content rather than chrome; what is left here is the size,
  // weight and alignment, which the three-script scheme deliberately leaves
  // alone.
  cyrillic: { fontSize: 44, fontWeight: '700', textAlign: 'center' },
  hint: { fontSize: 13, color: colors.textMuted, marginTop: spacing.md },
  answer: { alignItems: 'center', gap: spacing.xs, alignSelf: 'stretch' },
  latin: { fontSize: 20 },
  english: { fontSize: 24, fontWeight: '600', textAlign: 'center' },
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
  exampleCyr: { fontSize: 18, textAlign: 'center' },
  exampleLat: { fontSize: 14, textAlign: 'center' },
  exampleEn: { fontSize: 14, textAlign: 'center', fontStyle: 'italic' },
  speakRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
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
