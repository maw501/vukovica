/**
 * One grammar topic: the explanation, then a drill over its items.
 *
 * The shape Mark asked for — "drill my conjugations for simple phrases and
 * words". A topic is read first and drilled second, so the screen has two
 * halves: `explain_md` rendered as plain paragraphs and bullets, and a ten-item
 * run of fill-in-the-blank prompts underneath a Start button.
 *
 * The blank is the whole design. Each prompt is an English cue and a Serbian
 * frame with one word missing (`I am at home — ја ___ код куће`), so what is
 * being tested is the ending, not vocabulary recall, and the answer can be typed
 * in either script — `checkAnswer` transliterates a Latin-typed answer before
 * comparing (spec §3).
 *
 * A run is scored once, when it finishes: one `bump_grammar_stats` call and one
 * XP award, both guarded by the same ref the trainer uses, so neither a
 * re-render nor StrictMode's double effect can pay twice. A run abandoned half
 * way records nothing, which is the same bargain the trainer's rounds make.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import {
  RUN_SIZE,
  checkAnswer,
  explainBlocks,
  pickRun,
  promptParts,
  topicAccuracy,
} from '@/lib/grammar';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import type { GrammarItemRow } from '@/lib/types';
import { XP_AWARDS } from '@/lib/xp';

export default function GrammarTopicScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  // The same `['grammar-topics']` list the contents page shows — so arriving
  // from it costs no round trip, and a topic opened by URL simply loads the
  // list. The accuracy line below is read from the same rows.
  const topics = useQuery({
    queryKey: ['grammar-topics'],
    queryFn: () => api.listGrammarTopics(),
  });
  const topic = (topics.data ?? []).find((row) => row.slug === slug);

  const items = useQuery({
    queryKey: ['grammar-items', topic?.id],
    queryFn: () => api.listGrammarItems(topic!.id),
    enabled: topic !== undefined,
  });

  /** The run's items, fixed for its lifetime. Null means "not drilling". */
  const [run, setRun] = useState<GrammarItemRow[] | null>(null);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState('');
  /** The verdict on the item on screen, or null while it is still being typed. */
  const [marked, setMarked] = useState<boolean | null>(null);
  /** Right or wrong per answered item, in order — the run's score. */
  const [results, setResults] = useState<boolean[]>([]);
  /** True when the finished run's score could not be written to the server. */
  const [saveFailed, setSaveFailed] = useState(false);

  const inputRef = useRef<TextInput>(null);
  /**
   * Whether the run on screen has already been recorded and paid. A run is
   * scored once, when it is finished — not per item, and not again each time the
   * summary re-renders. Set before the requests go out, so neither a re-render
   * nor StrictMode's double effect can fire twice.
   */
  const runRecorded = useRef(false);

  const startRun = useCallback(() => {
    setRun(pickRun(items.data ?? [], RUN_SIZE));
    setIndex(0);
    setTyped('');
    setMarked(null);
    setResults([]);
    setSaveFailed(false);
    runRecorded.current = false;
  }, [items.data]);

  const item = run?.[index];

  const check = useCallback(() => {
    // An empty answer is a mis-hit Enter, not a wrong answer: scoring it would
    // mark the item wrong for nothing.
    if (!item || marked !== null || typed.trim() === '') return;
    const right = checkAnswer(typed, item.answer_cyr);
    setMarked(right);
    setResults((current) => [...current, right]);
  }, [item, marked, typed]);

  const next = useCallback(() => {
    setMarked(null);
    setTyped('');
    setIndex((current) => current + 1);
    inputRef.current?.focus();
  }, []);

  /**
   * The run's score, written to the topic's counters.
   *
   * Its own function so the summary can offer it again after a failure: the
   * counters are what the run was *for*, and losing ten answers to one network
   * blip is worth a button. Re-running it adds the same run a second time if the
   * first call actually landed and only its response was lost — the same bargain
   * the trainer's retry makes, and the same one the alternative (silently losing
   * the run) loses.
   */
  const recordRun = useCallback(
    (topicId: string, attempts: number, correct: number) => {
      setSaveFailed(false);
      void api
        .recordGrammarRun(topicId, attempts, correct)
        .then(() => queryClient.invalidateQueries({ queryKey: ['grammar-topics'] }))
        .catch(() => setSaveFailed(true));
    },
    [queryClient],
  );

  /**
   * The finished run, written down: the topic's counters and the XP for the run.
   *
   * Both fire the moment the last item is answered — i.e. when `index` has
   * walked off the end of the run. The counters are the real write and the XP is
   * a garnish on it, exactly as in a review: a failed award costs its fifteen
   * points and nothing else, while a failed bump is worth saying out loud,
   * because the accuracy on the contents page is what the run was for.
   */
  useEffect(() => {
    if (runRecorded.current) return;
    if (!topic || run === null || run.length === 0) return;
    if (index < run.length) return;
    runRecorded.current = true;

    recordRun(topic.id, results.length, results.filter(Boolean).length);
    void api
      .awardXp('grammar')
      .then(() => queryClient.invalidateQueries({ queryKey: ['xp'] }))
      .catch(() => undefined);
  }, [index, queryClient, recordRun, results, run, topic]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/grammar');
  }, [router]);

  if (!topic) {
    return (
      <View style={styles.centred}>
        {topics.isPending || topics.isFetching ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Text style={styles.muted} testID="topic-missing">
              {topics.isError
                ? errorMessage(topics.error, 'Could not load the grammar topics.')
                : 'There is no grammar topic by that name.'}
            </Text>
            <Pressable style={styles.textButton} onPress={() => void topics.refetch()}>
              <Text style={styles.textButtonLabel}>Try again</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const accuracy = topicAccuracy(topic.stat ?? undefined);
  const header = <Stack.Screen options={{ title: topic.title_en }} />;

  // ---- The explanation, and the way into a run -----------------------------
  if (run === null) {
    const pool = items.data ?? [];

    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        {header}
        <View style={styles.content}>
          <Text style={styles.title} testID="topic-title">
            {topic.title_en}
          </Text>
          <Text style={styles.meta} testID="topic-accuracy">
            {accuracy === null
              ? 'Not drilled yet'
              : `${accuracy}% right · ${topic.stat?.attempts ?? 0} answered`}
          </Text>

          <View style={styles.explainCard} testID="topic-explain">
            {explainBlocks(topic.explain_md).map((block, blockIndex) =>
              block.kind === 'bullet' ? (
                <View key={blockIndex} style={styles.bullet}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>{block.text}</Text>
                </View>
              ) : (
                <Text key={blockIndex} style={styles.paragraph}>
                  {block.text}
                </Text>
              ),
            )}
          </View>

          {items.isPending ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          ) : items.isError ? (
            <View style={styles.centredBlock}>
              <Text style={styles.error} testID="topic-items-error">
                {errorMessage(items.error, 'Could not load this topic’s questions.')}
              </Text>
              <Pressable style={styles.textButton} onPress={() => void items.refetch()}>
                <Text style={styles.textButtonLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : pool.length === 0 ? (
            <Text style={styles.muted} testID="topic-empty">
              This topic has no questions yet.
            </Text>
          ) : (
            <>
              <Pressable
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                onPress={startRun}
                accessibilityRole="button"
                testID="topic-start"
              >
                <Text style={styles.primaryButtonText}>Start drill</Text>
              </Pressable>
              <Text style={styles.muted}>
                {Math.min(RUN_SIZE, pool.length)} question
                {Math.min(RUN_SIZE, pool.length) === 1 ? '' : 's'} from this topic’s{' '}
                {pool.length}. Type the missing word in Cyrillic or Latin — either is
                accepted. Worth {XP_AWARDS.grammar} XP.
              </Text>
            </>
          )}
        </View>
      </ScrollView>
    );
  }

  // ---- The summary ---------------------------------------------------------
  if (!item) {
    const right = results.filter(Boolean).length;
    const missed = run.filter((_, position) => results[position] === false);

    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        {header}
        <View style={styles.content} testID="run-summary">
          <Text style={styles.summaryTitle}>
            {right === results.length ? 'Perfect run!' : 'Run finished'}
          </Text>
          <Text style={styles.summaryScore} testID="run-score">
            {right} / {results.length}
          </Text>
          <Text style={styles.summarySubtitle}>answered right</Text>

          <View style={styles.missCard} testID="run-missed">
            <Text style={styles.missTitle}>To look at again</Text>
            {missed.length === 0 ? (
              <Text style={styles.muted}>Not one missed. Straight through.</Text>
            ) : (
              missed.map((row) => (
                <View key={row.id} style={styles.miss}>
                  <FilledPrompt item={row} />
                  {row.note ? <Text style={styles.note}>{row.note}</Text> : null}
                </View>
              ))
            )}
          </View>

          {saveFailed ? (
            <View style={styles.centredBlock} testID="run-save-error">
              <Text style={styles.error}>
                This run could not be added to your score for the topic.
              </Text>
              <Pressable
                style={styles.textButton}
                onPress={() =>
                  recordRun(topic.id, results.length, results.filter(Boolean).length)
                }
                accessibilityRole="button"
                testID="run-save-retry"
              >
                <Text style={styles.textButtonLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={startRun}
            accessibilityRole="button"
            testID="run-again"
          >
            <Text style={styles.primaryButtonText}>Another run</Text>
          </Pressable>
          <Pressable
            style={styles.textButton}
            onPress={() => setRun(null)}
            accessibilityRole="button"
            testID="run-explain"
          >
            <Text style={styles.textButtonLabel}>Read the explanation again</Text>
          </Pressable>
          <Pressable
            style={styles.textButton}
            onPress={goBack}
            accessibilityRole="button"
            testID="run-done"
          >
            <Text style={styles.textButtonLabel}>Back to the topics</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // ---- One question --------------------------------------------------------
  const parts = promptParts(item.prompt);

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      {header}
      <View style={styles.content}>
        <Text style={styles.progress} testID="run-progress">
          {index + 1} of {run.length}
        </Text>

        <View style={styles.card}>
          <Text style={styles.prompt} testID="run-prompt">
            {parts.before}
            {/* The blank is filled with the right answer once the item is
                marked, so the sentence is read whole either way — right after a
                correct answer, and as the correction after a miss. */}
            <Text style={marked === null ? styles.blank : marked ? styles.blankRight : styles.blankWrong}>
              {marked === null ? '____' : item.answer_cyr}
            </Text>
            {parts.after}
          </Text>

          <TextInput
            ref={inputRef}
            style={[
              styles.input,
              marked === null ? null : marked ? styles.inputRight : styles.inputWrong,
            ]}
            value={typed}
            onChangeText={(text) => {
              // Frozen once marked: what was typed stays on screen next to the
              // answer until the user moves on.
              if (marked !== null) return;
              setTyped(text);
            }}
            onSubmitEditing={() => (marked === null ? check() : next())}
            blurOnSubmit={false}
            placeholder="Type the missing word"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Your answer"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            testID="run-input"
          />

          {marked === null ? null : (
            <View style={styles.feedback} testID="run-feedback">
              <Text style={[styles.verdict, marked ? styles.verdictRight : styles.verdictWrong]}>
                {marked ? 'Correct' : 'Not quite'}
              </Text>
              {/* The answer and its note are shown on a miss — that is the
                  teaching moment. A correct answer already has the sentence
                  above it, so it gets the note alone. */}
              {marked ? null : (
                <Text style={styles.answer} testID="run-answer">
                  {item.answer_cyr}
                </Text>
              )}
              {item.note ? (
                <Text style={styles.note} testID="run-note">
                  {item.note}
                </Text>
              ) : null}
            </View>
          )}
        </View>

        {marked === null ? (
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              typed.trim() === '' && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={typed.trim() === ''}
            onPress={check}
            accessibilityRole="button"
            testID="run-check"
          >
            <Text style={styles.primaryButtonText}>Check</Text>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={next}
            accessibilityRole="button"
            testID="run-next"
          >
            <Text style={styles.primaryButtonText}>
              {index + 1 === run.length ? 'Finish' : 'Next question'}
            </Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

/** A missed prompt with its blank filled in — the sentence as it should read. */
function FilledPrompt({ item }: { item: GrammarItemRow }) {
  const parts = promptParts(item.prompt);

  return (
    <Text style={styles.missPrompt}>
      {parts.before}
      <Text style={styles.missAnswer}>{item.answer_cyr}</Text>
      {parts.after}
    </Text>
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
  centredBlock: { alignItems: 'center', gap: spacing.sm },
  loading: { marginVertical: spacing.lg },
  title: { fontSize: 26, fontWeight: '700', color: colors.primary },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: -spacing.sm },
  explainCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  paragraph: { fontSize: 16, lineHeight: 24, color: colors.text },
  bullet: { flexDirection: 'row', gap: spacing.xs },
  bulletDot: { fontSize: 16, lineHeight: 24, color: colors.textMuted },
  bulletText: { flex: 1, fontSize: 16, lineHeight: 24, color: colors.text },
  progress: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  prompt: { fontSize: 22, lineHeight: 34, color: colors.text, textAlign: 'center' },
  blank: { color: colors.textMuted },
  blankRight: { color: '#2F7A4D', fontWeight: '700' },
  blankWrong: { color: colors.accent, fontWeight: '700' },
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
  feedback: { alignItems: 'center', gap: spacing.xs },
  verdict: { fontSize: 16, fontWeight: '700' },
  verdictRight: { color: '#2F7A4D' },
  verdictWrong: { color: colors.accent },
  answer: { fontSize: 30, fontWeight: '700', color: colors.text },
  note: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  summaryTitle: { fontSize: 32, fontWeight: '700', color: colors.text, textAlign: 'center' },
  summaryScore: { fontSize: 48, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  summarySubtitle: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: -spacing.sm,
  },
  missCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  missTitle: { fontSize: 13, color: colors.textMuted, textTransform: 'uppercase' },
  miss: { gap: 2 },
  missPrompt: { fontSize: 16, lineHeight: 24, color: colors.text },
  missAnswer: { color: colors.primary, fontWeight: '700' },
  primaryButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryButtonText: { color: colors.primaryOn, fontSize: 17, fontWeight: '600' },
  buttonDisabled: { backgroundColor: colors.disabled },
  muted: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
