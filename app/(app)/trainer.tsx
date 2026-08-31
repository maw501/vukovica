/**
 * The Cyrillic typing trainer.
 *
 * Ten words a round, drawn from the deck and weighted towards the letters the
 * user gets wrong (`pickDrillWords`), in either direction: read Cyrillic and
 * type Latin, or read Latin and type Cyrillic. Every answer is marked letter by
 * letter and the marks are written straight through to `drill_stats`, one
 * request per word, so leaving mid-round costs nothing already earned.
 *
 * The round is snapshotted into state when it starts and never rebuilt under
 * the user's thumb: the letter counts change with every answer, but the words
 * in front of the user do not.
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
  TextInput,
  View,
} from 'react-native';

import { ScriptText } from '@/components/ScriptText';
import { api } from '@/lib/api';
import {
  KEYBOARD_ONLY_CYRILLIC,
  LATIN_ACCENTS,
  cyrillicInput,
  mergeDrillStats,
  pickDrillWords,
  scoreAttempt,
  segmentExpected,
  tallyAttempts,
  weakestLetters,
  type AttemptScore,
  type LetterDelta,
  type LetterResult,
} from '@/lib/drills';
import { errorMessage } from '@/lib/errors';
import { LETTER_TOTAL, masteredLetters } from '@/lib/stages';
import type { ScriptRole } from '@/lib/script';
import { colors, contentMaxWidth, radius, script, spacing, touchTarget } from '@/lib/theme';
import { cyrToLat } from '@/lib/transliterate';
import type { CardRow, DrillStatRow } from '@/lib/types';

/** Words per round. Long enough to be practice, short enough to finish. */
const ROUND_SIZE = 10;
/** How many letters the round summary singles out. */
const SUMMARY_LETTERS = 5;

/** Which way round the drill runs. */
type Mode = 'cyr-lat' | 'lat-cyr';

const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: 'cyr-lat', label: 'Cyrillic → Latin', hint: 'Read the Cyrillic, type the Latin' },
  { mode: 'lat-cyr', label: 'Latin → Cyrillic', hint: 'Read the Latin, type the Cyrillic' },
];

/** The answer the user is being asked for, in the script they must type it in. */
function expectedAnswer(card: CardRow, mode: Mode): string {
  return mode === 'cyr-lat' ? cyrToLat(card.sr_cyr) : card.sr_cyr;
}

/** The word as shown at the top of the card. */
function prompt(card: CardRow, mode: Mode): string {
  return mode === 'cyr-lat' ? card.sr_cyr : cyrToLat(card.sr_cyr);
}

/**
 * Which script the drill is *asking for*, and so which the typed answer, the
 * marked answer and the input itself are in. The prompt is the other one.
 *
 * Both directions are on screen at once — the word to read at the top, the
 * answer being typed below it — so styling them by role rather than by position
 * is what stops the two blurring into each other mid-round.
 */
function answerRole(mode: Mode): ScriptRole {
  return mode === 'cyr-lat' ? 'lat' : 'cyr';
}

/** The script the prompt is in: the opposite of the answer's. */
function promptRole(mode: Mode): ScriptRole {
  return mode === 'cyr-lat' ? 'cyr' : 'lat';
}

export default function TrainerScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const cards = useQuery({ queryKey: ['cards'], queryFn: () => api.listCards() });
  const stats = useQuery({ queryKey: ['drill-stats'], queryFn: () => api.listDrillStats() });

  const [mode, setMode] = useState<Mode>('cyr-lat');
  /** The round's words, fixed for its lifetime. Null means "build me one". */
  const [round, setRound] = useState<CardRow[] | null>(null);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState('');
  /** The mark for the word on screen, or null while it is still being typed. */
  const [marked, setMarked] = useState<AttemptScore | null>(null);
  /** Every word's per-letter marks, for the round summary. */
  const [results, setResults] = useState<LetterResult[][]>([]);
  /** Letter counts whose write failed, kept so they can be retried. */
  const [unsaved, setUnsaved] = useState<LetterDelta[][]>([]);

  const inputRef = useRef<TextInput>(null);
  /** Writes run one after another, so two words never race for a letter's row. */
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  /**
   * Whether the round on screen has already been paid its XP. A round earns its
   * ten points once, when it is finished — not per word, and not again each time
   * the summary re-renders.
   */
  const roundAwarded = useRef(false);
  /**
   * The letters already mastered when this round started, so the summary can
   * tell a letter mastered *here* from one mastered weeks ago.
   */
  const masteredAtRoundStart = useRef<ReadonlySet<string>>(new Set());

  const startRound = useCallback(() => {
    setRound(null);
    setIndex(0);
    setTyped('');
    setMarked(null);
    setResults([]);
    roundAwarded.current = false;
  }, []);

  // Build a round as soon as the deck and the stats are both in hand, and never
  // while a fetch is in flight — a round built from half-loaded stats would be
  // biased by the wrong numbers.
  useEffect(() => {
    if (round !== null) return;
    if (!cards.data || !stats.data) return;
    if (cards.isFetching || stats.isFetching) return;
    masteredAtRoundStart.current = masteredLetters(stats.data);
    setRound(pickDrillWords(cards.data, stats.data, ROUND_SIZE));
  }, [cards.data, cards.isFetching, round, stats.data, stats.isFetching]);

  const save = useMutation({
    mutationFn: (deltas: LetterDelta[]) => {
      const run = saveChain.current.then(() => api.recordDrillAttempts(deltas));
      // The chain has to survive a failed link, or one network blip would stall
      // every later save in the round.
      saveChain.current = run.then(
        () => undefined,
        () => setUnsaved((current) => [...current, deltas]),
      );
      return run;
    },
    onSuccess: (rows) => {
      // The function answers with the new totals for the letters it touched, so
      // the cache can be brought up to date exactly, without a refetch. It is
      // what the *next* round's bias is computed from.
      queryClient.setQueryData<DrillStatRow[]>(['drill-stats'], (current) =>
        mergeDrillStats(current ?? [], rows),
      );
      // Letters mastered here move the dashboard's stage and goal. The
      // dashboard is inactive while this screen is up, so this marks its
      // progress stale rather than refetching -- it reloads on the way back.
      void queryClient.invalidateQueries({ queryKey: ['progress'] });
    },
  });

  /**
   * The round's XP, awarded the moment the last word is answered — i.e. when
   * `index` has walked off the end of the round.
   *
   * A round abandoned half way earns nothing, which is the point: the tariff is
   * for a round, and the letter counts every answered word wrote are the reward
   * for the words themselves. The ref is set before the request goes out, so
   * neither a re-render nor StrictMode's double effect can pay twice; a failed
   * insert simply loses the ten points, exactly as it does in a review.
   */
  useEffect(() => {
    if (roundAwarded.current) return;
    if (round === null || round.length === 0) return;
    if (index < round.length) return;
    roundAwarded.current = true;
    void api
      .awardXp('drill')
      .then(() => queryClient.invalidateQueries({ queryKey: ['xp'] }))
      .catch(() => undefined);
  }, [index, queryClient, round]);

  const retryUnsaved = useCallback(() => {
    // Read and clear, then fire: mutating inside the state updater would run
    // the writes twice under StrictMode, and these writes *add*.
    const pending = unsaved;
    setUnsaved([]);
    for (const deltas of pending) save.mutate(deltas);
  }, [save, unsaved]);

  const card = round?.[index];

  const check = useCallback(() => {
    // An empty answer is a mis-hit Enter, not a wrong answer: scoring it would
    // mark every letter of the word wrong for nothing.
    if (!card || marked || typed.trim() === '') return;
    const score = scoreAttempt(expectedAnswer(card, mode), typed);
    setMarked(score);
    setResults((current) => [...current, score.perLetter]);
    save.mutate(tallyAttempts([score.perLetter]));
  }, [card, marked, mode, save, typed]);

  const next = useCallback(() => {
    setMarked(null);
    setTyped('');
    setIndex((current) => current + 1);
    inputRef.current?.focus();
  }, []);

  const appendLetter = useCallback(
    (letter: string) => {
      if (marked) return;
      setTyped((current) => (mode === 'lat-cyr' ? cyrillicInput(current + letter) : current + letter));
      inputRef.current?.focus();
    },
    [marked, mode],
  );

  const changeMode = useCallback(
    (next_: Mode) => {
      if (next_ === mode) return;
      setMode(next_);
      // A round is built for one direction; switching restarts it. Nothing is
      // lost — every word answered so far is already in the database.
      startRound();
    },
    [mode, startRound],
  );

  const goHome = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const roundDeltas = useMemo(() => tallyAttempts(results), [results]);

  /**
   * The alphabet mastered so far, from the same `drill-stats` cache the round is
   * built from. Every answer merges its new totals into that cache, so the count
   * climbs as the round is played rather than only on the next visit — and the
   * rule for what counts as mastered stays in `lib/stages.ts`, where the
   * dashboard reads it from too.
   */
  const mastered = useMemo(() => masteredLetters(stats.data ?? []), [stats.data]);

  // Errors first: a failed query never produces data, so `round` would stay
  // null and a loading check ahead of this one would spin for ever.
  if (cards.isError || stats.isError) {
    const error = cards.error ?? stats.error;
    return (
      <View style={styles.centred}>
        <Text style={styles.error} testID="trainer-error">
          {errorMessage(error, 'Could not load the trainer.')}
        </Text>
        <Pressable
          style={styles.textButton}
          onPress={() => {
            void cards.refetch();
            void stats.refetch();
          }}
          accessibilityRole="button"
        >
          <Text style={styles.textButtonLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (round === null) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (round.length === 0) {
    return (
      <View style={styles.centred}>
        <Text style={styles.error} testID="trainer-empty">
          There are no single words in the deck to drill yet. Add a word and come back.
        </Text>
        <Pressable style={styles.textButton} onPress={goHome} accessibilityRole="button">
          <Text style={styles.textButtonLabel}>Back to the dashboard</Text>
        </Pressable>
      </View>
    );
  }

  // Rendered on the drill *and* on the summary: switching direction between
  // rounds should not mean starting one in the wrong direction first.
  const modeSwitch = (
    <View>
      <View style={styles.modes}>
        {MODES.map((option) => {
          const active = option.mode === mode;
          return (
            <Pressable
              key={option.mode}
              style={[styles.mode, active && styles.modeActive]}
              onPress={() => changeMode(option.mode)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              testID={`mode-${option.mode}`}
            >
              <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.modeHint}>{MODES.find((option) => option.mode === mode)?.hint}</Text>
    </View>
  );

  // The whole point of the trainer, in one line: how much of Vuk's alphabet is
  // in hand. Rendered on the drill and on the summary alike.
  const masteryBar = (
    <View style={styles.mastery} testID="letter-mastery">
      <Text style={styles.masteryLabel}>
        Mastered {mastered.size}/{LETTER_TOTAL}
      </Text>
      <View style={styles.masteryTrack}>
        <View
          style={[styles.masteryFill, { width: `${(mastered.size / LETTER_TOTAL) * 100}%` }]}
        />
      </View>
    </View>
  );

  const banner =
    unsaved.length > 0 ? (
      <View style={styles.banner} testID="save-error">
        <Text style={styles.bannerText}>
          {unsaved.length} word{unsaved.length === 1 ? '' : 's'} could not be scored on the server.
        </Text>
        <Pressable style={styles.bannerButton} onPress={retryUnsaved} accessibilityRole="button">
          <Text style={styles.bannerButtonText}>Retry</Text>
        </Pressable>
      </View>
    ) : null;

  if (!card) {
    const right = results.filter((perLetter) => perLetter.every((entry) => entry.correct)).length;
    return (
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content} testID="drill-summary">
          <Text style={styles.summaryTitle}>
            {right === results.length ? 'Perfect round!' : 'Round finished'}
          </Text>
          <Text style={styles.summaryScore} testID="drill-score">
            {right} / {results.length}
          </Text>
          <Text style={styles.summarySubtitle}>words spelled exactly right</Text>

          {masteryBar}

          <MasteredLetters
            deltas={roundDeltas}
            mastered={mastered}
            before={masteredAtRoundStart.current}
          />

          <WeakLetters deltas={roundDeltas} />

          {banner}
          {modeSwitch}

          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={startRound}
            accessibilityRole="button"
            testID="drill-again"
          >
            <Text style={styles.primaryButtonText}>Another round</Text>
          </Pressable>
          <Pressable
            style={styles.textButton}
            onPress={goHome}
            accessibilityRole="button"
            testID="drill-done"
          >
            <Text style={styles.textButtonLabel}>Back to the dashboard</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  const expected = expectedAnswer(card, mode);
  const keys = mode === 'lat-cyr' ? KEYBOARD_ONLY_CYRILLIC : LATIN_ACCENTS;

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.content}>
        {modeSwitch}

        {masteryBar}

        <Text style={styles.progress} testID="drill-progress">
          {index + 1} of {round.length}
        </Text>

        {banner}

        <View style={styles.card}>
          <ScriptText role={promptRole(mode)} style={styles.promptWord} testID="drill-prompt">
            {prompt(card, mode)}
          </ScriptText>
          <ScriptText role="en" style={styles.promptEn}>
            {card.en}
          </ScriptText>

          <TextInput
            ref={inputRef}
            // The box is typed into in one script, and says which by looking
            // like it: terracotta sans for Latin, dark serif for Cyrillic.
            style={[
              styles.input,
              script[answerRole(mode)],
              marked ? (marked.correct ? styles.inputRight : styles.inputWrong) : null,
            ]}
            value={typed}
            onChangeText={(text) => {
              // Frozen once marked: the answer stays on screen next to the
              // correction until the user moves on.
              if (marked) return;
              setTyped(mode === 'lat-cyr' ? cyrillicInput(text) : text);
            }}
            onSubmitEditing={() => (marked ? next() : check())}
            blurOnSubmit={false}
            placeholder={mode === 'lat-cyr' ? 'Type it in Cyrillic' : 'Type it in Latin'}
            accessibilityLabel="Your answer"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            testID="drill-input"
          />

          <View style={styles.keys}>
            {keys.map((letter) => (
              <Pressable
                key={letter}
                style={({ pressed }) => [styles.key, pressed && styles.pressed]}
                onPress={() => appendLetter(letter)}
                accessibilityRole="button"
                accessibilityLabel={`Type ${letter}`}
                testID={`key-${letter}`}
              >
                <Text style={styles.keyLabel}>{letter}</Text>
              </Pressable>
            ))}
          </View>

          {marked ? (
            <View style={styles.feedback} testID="drill-feedback">
              <Text style={[styles.verdict, marked.correct ? styles.verdictRight : styles.verdictWrong]}>
                {marked.correct ? 'Correct' : 'Not quite'}
              </Text>
              <MarkedAnswer expected={expected} score={marked} role={answerRole(mode)} />
              <ScriptText role={promptRole(mode)} style={styles.otherScript}>
                {mode === 'cyr-lat' ? card.sr_cyr : cyrToLat(card.sr_cyr)}
              </ScriptText>
            </View>
          ) : null}
        </View>

        {marked ? (
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={next}
            accessibilityRole="button"
            testID="drill-next"
          >
            <Text style={styles.primaryButtonText}>
              {index + 1 === round.length ? 'Finish' : 'Next word'}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              typed.trim() === '' && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={typed.trim() === ''}
            onPress={check}
            accessibilityRole="button"
            testID="drill-check"
          >
            <Text style={styles.primaryButtonText}>Check</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

/**
 * Which of the letters just drilled are mastered — the round measured against
 * the goal of the Alphabet stage rather than against itself.
 *
 * Only letters this round actually touched are listed: the rest of the alphabet
 * is the header's business. A letter that crossed the bar *during* the round is
 * called out, because that is the moment worth noticing.
 */
function MasteredLetters({
  deltas,
  mastered,
  before,
}: {
  deltas: LetterDelta[];
  mastered: ReadonlySet<string>;
  before: ReadonlySet<string>;
}) {
  const letters = deltas.map((delta) => delta.letter).filter((letter) => mastered.has(letter));

  return (
    <View style={styles.weakCard} testID="drill-mastered">
      <Text style={styles.weakTitle}>Mastered letters</Text>
      {letters.length === 0 ? (
        <Text style={styles.weakEmpty}>
          No letter from this round is mastered yet — each needs 8 tries at 90%.
        </Text>
      ) : (
        <View style={styles.weakRow}>
          {letters.map((letter) => {
            const isNew = !before.has(letter);
            return (
              <View key={letter} style={styles.masteredLetter} testID={`mastered-${letter}`}>
                <Text style={styles.masteredLetterCyr}>{letter}</Text>
                <Text style={styles.masteredLetterMark}>{isNew ? 'new' : '✓'}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** The round's own misses, worst first — what to look at before the next one. */
function WeakLetters({ deltas }: { deltas: LetterDelta[] }) {
  const weak = weakestLetters(deltas, SUMMARY_LETTERS);

  return (
    <View style={styles.weakCard} testID="drill-weak">
      <Text style={styles.weakTitle}>Letters to watch</Text>
      {weak.length === 0 ? (
        <Text style={styles.weakEmpty}>Not one letter missed this round.</Text>
      ) : (
        <View style={styles.weakRow}>
          {weak.map((letter) => {
            const delta = deltas.find((entry) => entry.letter === letter);
            return (
              <View key={letter} style={styles.weakLetter} testID={`weak-${letter}`}>
                <Text style={styles.weakLetterCyr}>{letter}</Text>
                <Text style={styles.weakLetterCount}>
                  {delta ? `${delta.correct}/${delta.attempts}` : ''}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/**
 * The right answer with the missed letters called out.
 *
 * `segmentExpected` is what makes this possible in the Latin direction: the
 * marks come back per Cyrillic letter, and the segments say which slice of the
 * Latin spelling ("dž") each of them owns.
 */
function MarkedAnswer({
  expected,
  score,
  role,
}: {
  expected: string;
  score: AttemptScore;
  /** Which script the expected answer is in — `lat` or `cyr`, never `en`. */
  role: ScriptRole;
}) {
  const segments = segmentExpected(expected);
  let letterIndex = 0;

  return (
    // The role goes on the wrapper and the letters inherit it, so a missed
    // letter's red-and-underlined mark is the only thing that has to override.
    <ScriptText role={role} style={styles.answer} testID="drill-answer">
      {segments.map((segment, index) => {
        if (segment.letter === null) {
          return <Text key={index}>{segment.text}</Text>;
        }
        const result = score.perLetter[letterIndex];
        letterIndex += 1;
        return (
          <Text key={index} style={result?.correct ? null : styles.answerLetterWrong}>
            {segment.text}
          </Text>
        );
      })}
    </ScriptText>
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
  modes: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  mode: {
    flex: 1,
    minHeight: touchTarget - 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  modeActive: { backgroundColor: colors.primary },
  modeLabel: { fontSize: 15, fontWeight: '600', color: colors.textMuted },
  modeLabelActive: { color: colors.primaryOn },
  modeHint: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
  progress: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Colour and face come from `script`; only size, weight and layout live here.
  promptWord: { fontSize: 40, fontWeight: '700', textAlign: 'center' },
  promptEn: { fontSize: 15, marginBottom: spacing.sm },
  input: {
    alignSelf: 'stretch',
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 24,
    textAlign: 'center',
    color: colors.text,
    backgroundColor: colors.background,
  },
  inputRight: { borderColor: '#2F7A4D' },
  inputWrong: { borderColor: colors.accent },
  keys: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs },
  key: {
    minWidth: touchTarget - 12,
    minHeight: touchTarget - 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  keyLabel: { fontSize: 20, color: colors.text },
  feedback: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  verdict: { fontSize: 16, fontWeight: '700' },
  verdictRight: { color: '#2F7A4D' },
  verdictWrong: { color: colors.accent },
  answer: { fontSize: 28, letterSpacing: 1 },
  answerLetterWrong: { color: colors.accent, fontWeight: '700', textDecorationLine: 'underline' },
  otherScript: { fontSize: 15 },
  primaryButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryButtonText: { color: colors.primaryOn, fontSize: 17, fontWeight: '600' },
  buttonDisabled: { backgroundColor: colors.disabled },
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
  summaryScore: { fontSize: 48, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  summarySubtitle: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginTop: -spacing.sm },
  weakCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  weakTitle: { fontSize: 13, color: colors.textMuted, textTransform: 'uppercase' },
  weakEmpty: { fontSize: 15, color: colors.text },
  weakRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  weakLetter: {
    minWidth: touchTarget,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  weakLetterCyr: { fontSize: 26, fontWeight: '700', color: colors.accent },
  weakLetterCount: { fontSize: 12, color: colors.textMuted },
  masteredLetter: {
    minWidth: touchTarget,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  masteredLetterCyr: { fontSize: 26, fontWeight: '700', color: colors.primary },
  masteredLetterMark: { fontSize: 12, color: colors.textMuted },
  mastery: { gap: spacing.xs },
  masteryLabel: { fontSize: 15, fontWeight: '600', color: colors.text, textAlign: 'center' },
  masteryTrack: {
    height: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.disabled,
    overflow: 'hidden',
  },
  masteryFill: { height: 6, borderRadius: radius.sm, backgroundColor: colors.primary },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
});
