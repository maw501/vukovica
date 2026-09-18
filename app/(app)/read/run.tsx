/**
 * The "Read it" drill — one theme's words, in Cyrillic, one at a time.
 *
 * The card face shows `sr_cyr` and nothing else. That is the exercise: read the
 * shapes out loud, say what the word means, and only then turn it over to find
 * the English, the Latin and the sentence it lives in. Anything else on the
 * front would be something to read *instead* of the Cyrillic.
 *
 * Like the letters drill there is no schedule and no allowance: `rate_read`
 * tallies the reading, pays the same 2 XP a review pays in the same transaction,
 * and nothing it writes can make a word unavailable. Unlike the letters drill a
 * theme can run to a hundred words, so a sitting is twenty (`READ_RUN_SIZE`) and
 * "Keep going" starts the next twenty from the ones this sitting has not
 * reached.
 *
 * Nothing here touches the review queue. Reading a word aloud is not answering
 * it, and "known" stays something Mark says outright ("I already know this" on
 * the Deck and in a review) rather than something this screen infers.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SpeakButton } from '@/components/SpeakButton';
import { WordFace } from '@/components/WordFace';
import { api } from '@/lib/api';
import { playAudioPath } from '@/lib/audio';
import { errorMessage } from '@/lib/errors';
import { isKnown } from '@/lib/library';
import {
  MINE_THEME,
  buildRun,
  remainingCount,
  runSummary,
  statsByCard,
  themeCards,
  themeLabel,
  type RunTally,
} from '@/lib/readDrill';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import type { CardRow, ReadStatRow } from '@/lib/types';
import { XP_AWARDS } from '@/lib/xp';

/** One rating, as the screen has to be able to send it again after a failure. */
interface Rating {
  cardId: string;
  gotIt: boolean;
}

/**
 * How long after an answer the next card refuses to be turned over.
 *
 * "Got it" and "Show" occupy the same place on the screen, one card apart, so a
 * double tap would otherwise land the second tap on the next word's reveal —
 * which here does not merely spoil the card, it *plays the clip*, saying the
 * word out loud before it has been read. A quarter of a second sits above the
 * gap between two taps of one accidental double, and below the gap between two
 * answers anybody means.
 */
const ANSWER_SETTLE_MS = 250;

export default function ReadRunScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ theme?: string }>();
  // A link with no theme on it means the words he already knows — the one theme
  // that is his rather than the deck's, and what the My words header links to.
  const theme = params.theme || MINE_THEME;
  const mine = theme === MINE_THEME;

  // The deck for a domain theme; My words for `mine`. Both are lists the app
  // already caches under these keys, so arriving from the picker or from the My
  // words screen usually costs no round trip at all.
  const deck = useQuery({
    queryKey: ['cards'],
    queryFn: () => api.listCards(),
    enabled: !mine,
  });
  const library = useQuery({
    queryKey: ['library'],
    queryFn: () => api.getLibrary(),
    enabled: mine,
  });
  const stats = useQuery({ queryKey: ['read-stats'], queryFn: () => api.listReadStats() });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() });

  /** The run's words, fixed for its lifetime. Null while one is being built. */
  const [run, setRun] = useState<CardRow[] | null>(null);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [tally, setTally] = useState<RunTally>({ gotIt: 0, notYet: 0 });
  /** Every word answered in this sitting, so "Keep going" moves on. */
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  /** Ratings that never reached the database, in the order they were given. */
  const [failures, setFailures] = useState<Rating[]>([]);
  /** True for a beat after an answer, while the buttons refuse to be tapped. */
  const [settling, setSettling] = useState(false);
  // State for the greying-out, a ref for the refusal itself: two taps can land
  // in one frame, and a state update is not visible to the second of them.
  const settleUntil = useRef(0);

  const pool = useMemo(() => {
    if (mine) {
      const entries = (library.data ?? []).filter((entry) => isKnown(entry.userCard));
      return entries.map((entry) => entry.card);
    }
    return themeCards({ theme, cards: deck.data ?? [] });
  }, [deck.data, library.data, mine, theme]);

  const tallies = useMemo(() => statsByCard(stats.data ?? []), [stats.data]);
  const loaded = (mine ? library.data : deck.data) !== undefined && stats.data !== undefined;

  /**
   * Build the run once the words and the tallies are both in.
   *
   * `run === null` is the signal to build, so "Keep going" is one `setRun(null)`
   * away — and because the tallies are patched in the cache as each rating is
   * saved, the next run is ordered by what just happened rather than by what was
   * true when the screen opened.
   */
  useEffect(() => {
    if (run !== null || !loaded) return;
    setRun(buildRun({ cards: pool, stats: tallies, seen }));
    setPosition(0);
    setRevealed(false);
    setTally({ gotIt: 0, notYet: 0 });
  }, [loaded, pool, run, seen, tallies]);

  /**
   * One reading, written down.
   *
   * The tally in the cache is patched from the row the function returns rather
   * than refetched: doing a read after every rating would put a round trip
   * between the answer and the next card.
   */
  const rate = useMutation({
    mutationFn: ({ cardId, gotIt }: Rating) => api.rateRead(cardId, gotIt),
    onSuccess: (row) => {
      queryClient.setQueryData<ReadStatRow[]>(['read-stats'], (current) => [
        ...(current ?? []).filter((existing) => existing.card_id !== row.card_id),
        row,
      ]);
      // The ring and the streak are both read off `xp_events`, which `rate_read`
      // has just written to...
      void queryClient.invalidateQueries({ queryKey: ['xp'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      // The picker's "N words · M solid" is counted from these same tallies, but
      // it is deliberately NOT refreshed here. `/read` is still mounted under
      // this screen, so an invalidation would refetch it there and then — and
      // that query reads the whole deck and the whole of My words, which is
      // three requests and something like fifteen hundred rows between one card
      // and the next. The counts are nobody's business until the run ends, and
      // the effect below refreshes them once, there.
    },
    onError: (_error, variables) => {
      setFailures((current) => [...current, variables]);
    },
  });

  // `mutate` is stable, but the mutation object is not; a ref keeps `answer`
  // from being rebuilt (and the card below re-rendered) after every rating.
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const answer = useCallback((card: CardRow, gotIt: boolean) => {
    if (Date.now() < settleUntil.current) return;
    settleUntil.current = Date.now() + ANSWER_SETTLE_MS;
    setSettling(true);

    rateRef.current.mutate({ cardId: card.id, gotIt });
    setSeen((current) => new Set(current).add(card.id));
    setTally((current) => ({
      gotIt: current.gotIt + (gotIt ? 1 : 0),
      notYet: current.notYet + (gotIt ? 0 : 1),
    }));
    setPosition((current) => current + 1);
    setRevealed(false);
  }, []);

  /** Turn the card over — unless an answer has only just been given. */
  const reveal = useCallback(() => {
    if (Date.now() < settleUntil.current) return;
    setRevealed(true);
  }, []);

  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setSettling(false), ANSWER_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settling]);

  /**
   * Send every rating that has not landed yet, once more.
   *
   * The list is cleared first and refilled by `rate.onError`, so a retry that
   * fails again leaves the banner exactly as it was rather than dropping the
   * rating on the floor.
   */
  const retryFailures = useCallback(() => {
    const pending = failures;
    setFailures([]);
    for (const rating of pending) rateRef.current.mutate(rating);
  }, [failures]);

  const card = run?.[position];
  const ttsEnabled = settings.data?.tts_enabled ?? true;
  const left = remainingCount(pool, seen);

  /**
   * Start the next run. Never refused: a word is always available to practise.
   *
   * Once the sitting has been through the whole theme there is nothing left to
   * move on to, so the sitting starts over rather than offering an empty run.
   * Unsaved ratings are sent again on the way out rather than thrown away — they
   * were real work, and they earned XP and moved a streak.
   */
  const keepGoing = useCallback(() => {
    retryFailures();
    if (left === 0) setSeen(new Set());
    setRun(null);
  }, [left, retryFailures]);

  const done = useCallback(() => {
    retryFailures();
    router.replace('/read');
  }, [retryFailures, router]);

  /**
   * Refresh the picker's counts once, when the run ends.
   *
   * This is what `rate_read`'s `onSuccess` deliberately does not do per rating:
   * one refetch of a heavy query at a moment when nobody is waiting on the next
   * card, instead of one between every two words.
   */
  const finished = run !== null && position >= run.length;
  useEffect(() => {
    if (!finished) return;
    void queryClient.invalidateQueries({ queryKey: ['read-themes'] });
  }, [finished, queryClient]);

  /**
   * Play the word the moment it is turned over.
   *
   * The clip is the answer to "did I say that right?", which is the question the
   * reveal asks, so waiting for a second tap would put the check one tap further
   * away than the drill it belongs to. A card with no clip, a browser that
   * refuses, or playback switched off in Settings all simply do nothing.
   */
  useEffect(() => {
    if (!revealed || !ttsEnabled || !card?.audio_path) return;
    void playAudioPath(card.audio_path);
  }, [card?.audio_path, revealed, ttsEnabled]);

  // The error branch comes FIRST, deliberately. A failed query is no longer
  // pending, but the effect above will not build a run without its data, so
  // `run` stays null for ever — put the pending branch first and the screen
  // spins for ever while this message sits below it, unreachable.
  const loadError = mine ? library.error : deck.error;
  if (loadError || stats.isError) {
    return (
      <View style={styles.centred}>
        <Text style={styles.error} testID="read-run-error">
          {errorMessage(
            loadError ?? stats.error,
            'Could not load these words. Nothing is lost — try again.',
          )}
        </Text>
        <Pressable
          style={styles.textButton}
          onPress={() => {
            if (mine) void library.refetch();
            else void deck.refetch();
            void stats.refetch();
          }}
          accessibilityRole="button"
        >
          <Text style={styles.textButtonLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!loaded || settings.isPending || run === null) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // A theme with nothing in it: "My words" before anything has been learnt, or a
  // domain whose cards have been deleted since the picker was drawn.
  if (pool.length === 0) {
    return (
      <View style={styles.centred} testID="read-run-empty">
        <Text style={styles.summaryTitle}>Nothing to read yet</Text>
        <Text style={styles.muted}>
          {mine
            ? 'Words land in My words as you learn them — or say “I already know this” on a word in the deck.'
            : 'This theme has no words in it.'}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={() => router.replace('/read')}
          accessibilityRole="button"
          testID="read-run-pick"
        >
          <Text style={styles.primaryButtonText}>Pick another theme</Text>
        </Pressable>
      </View>
    );
  }

  if (!card) {
    return (
      <RunSummary
        theme={theme}
        tally={tally}
        left={left}
        failures={failures.length}
        onRetry={retryFailures}
        onKeepGoing={keepGoing}
        onDone={done}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.progress} testID="read-progress">
            {position + 1} of {run.length}
          </Text>
          <Text style={styles.themeName} testID="read-theme-name">
            {themeLabel(theme)}
          </Text>
        </View>

        {failures.length > 0 ? (
          <View style={styles.banner} testID="read-save-error">
            <Text style={styles.bannerText}>
              {failures.length} answer{failures.length === 1 ? '' : 's'} could not be saved.
            </Text>
            <Pressable style={styles.bannerButton} onPress={retryFailures} accessibilityRole="button">
              <Text style={styles.bannerButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {/*
          The speaker button is a sibling of the tap area, not a child of it: on
          web a `Pressable` is a real <button>, and a button inside a button is
          invalid HTML as well as an ambiguous tap. It is also only offered once
          the card is turned over — hearing the word before reading it would
          answer the question the card is asking.
        */}
        <View style={styles.card}>
          <Pressable
            style={styles.cardTap}
            onPress={reveal}
            disabled={revealed || settling}
            accessibilityRole="button"
            accessibilityLabel="Show what it says"
            testID="read-card"
          >
            <WordFace card={card} revealed={revealed} />
          </Pressable>

          {revealed ? (
            <View style={styles.speakRow}>
              <SpeakButton path={card.audio_path} enabled={ttsEnabled} testID="speak-word" />
            </View>
          ) : null}
        </View>

        {revealed ? (
          <View style={styles.answers}>
            <Pressable
              style={({ pressed }) => [
                styles.answerButton,
                styles.notYet,
                settling && styles.buttonSettling,
                pressed && !settling && styles.pressed,
              ]}
              onPress={() => answer(card, false)}
              disabled={settling}
              accessibilityRole="button"
              accessibilityState={{ disabled: settling }}
              testID="read-not-yet"
            >
              <Text style={[styles.answerLabel, { color: colors.accent }]}>Not yet</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.answerButton,
                styles.gotIt,
                settling && styles.buttonSettling,
                pressed && !settling && styles.pressed,
              ]}
              onPress={() => answer(card, true)}
              disabled={settling}
              accessibilityRole="button"
              accessibilityState={{ disabled: settling }}
              testID="read-got-it"
            >
              <Text style={[styles.answerLabel, { color: colors.primary }]}>Got it</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              settling && styles.buttonSettling,
              pressed && !settling && styles.pressed,
            ]}
            onPress={reveal}
            disabled={settling}
            accessibilityRole="button"
            accessibilityState={{ disabled: settling }}
            testID="read-reveal"
          >
            <Text style={styles.primaryButtonText}>Show</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

/**
 * The end of a run: what it came to, and the way straight back in.
 *
 * "Keep going" is the big button, deliberately — the drill is meant to be run
 * again and again, and twenty is a stopping point offered rather than imposed.
 * Once the sitting has been through the whole theme it says so, and starting
 * over is still one tap away.
 */
function RunSummary({
  theme,
  tally,
  left,
  failures,
  onRetry,
  onKeepGoing,
  onDone,
}: {
  theme: string;
  tally: RunTally;
  /** Words of this theme the sitting has not reached yet. */
  left: number;
  failures: number;
  onRetry: () => void;
  onKeepGoing: () => void;
  onDone: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.content} testID="read-summary">
        {/* A run with nothing in it is not reachable: an empty theme is caught
            before the run is built, and every other run has at least one word
            in it to answer. */}
        <Text style={styles.summaryTitle}>
          {tally.notYet === 0 ? 'Every one of them!' : 'Run finished'}
        </Text>
        {/*
          The tally counts every answer given, saved or not — it is the record of
          the run, and a failed write does not un-answer a card. So when some of
          them are still stuck, the line says so rather than quietly overstating
          what reached the database. The banner below offers the retry.
        */}
        <Text style={styles.summaryLine} testID="read-summary-line">
          {runSummary(tally)}
          {failures > 0 ? ` · ${failures} not saved yet` : ''}
        </Text>
        <Text style={styles.muted} testID="read-summary-left">
          {left > 0
            ? `${left} more ${left === 1 ? 'word' : 'words'} in ${themeLabel(theme)}`
            : `That is every word in ${themeLabel(theme)} — go round again whenever you like.`}
        </Text>

        {failures > 0 ? (
          <View style={styles.banner} testID="read-save-error">
            <Text style={styles.bannerText}>
              {failures} answer{failures === 1 ? '' : 's'} could not be saved.
            </Text>
            <Pressable style={styles.bannerButton} onPress={onRetry} accessibilityRole="button">
              <Text style={styles.bannerButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={onKeepGoing}
          accessibilityRole="button"
          testID="read-keep-going"
        >
          <Text style={styles.primaryButtonText}>{left > 0 ? 'Keep going' : 'Go again'}</Text>
        </Pressable>

        <Pressable
          style={styles.textButton}
          onPress={onDone}
          accessibilityRole="button"
          testID="read-done"
        >
          <Text style={styles.textButtonLabel}>Done</Text>
        </Pressable>

        <Text style={styles.footnote}>
          Every answer is worth {XP_AWARDS.review} XP, the same as a review, and today counts
          towards your streak either way.
        </Text>
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
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progress: { fontSize: 13, color: colors.textMuted },
  themeName: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 260,
    justifyContent: 'center',
  },
  cardTap: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.sm },
  speakRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  answers: { flexDirection: 'row', gap: spacing.sm },
  answerButton: {
    flex: 1,
    minHeight: touchTarget + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 2,
    backgroundColor: colors.surface,
  },
  notYet: { borderColor: colors.accent },
  gotIt: { borderColor: colors.primary },
  answerLabel: { fontSize: 17, fontWeight: '700' },
  primaryButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: { color: colors.primaryOn, fontSize: 17, fontWeight: '600' },
  summaryTitle: { fontSize: 32, fontWeight: '700', color: colors.text, textAlign: 'center' },
  summaryLine: { fontSize: 16, color: colors.textMuted, textAlign: 'center' },
  muted: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
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
  pressed: { opacity: 0.8 },
  // The beat after an answer: visibly not tappable, rather than silently inert.
  buttonSettling: { opacity: 0.45 },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  footnote: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
});
