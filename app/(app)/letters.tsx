/**
 * The letters drill — the alphabet, on tap, as often as you like.
 *
 * There is no schedule here and there is no allowance. Mark asked for exactly
 * that: "I don't want a spaced repetition system [for the letters]. I want to be
 * able to drill again and again as much as I want. Sorting by how easy / hard I
 * found it is still good but I don't want cards / letters unavailable for
 * practice." So a run is every letter once, in shakiest-first order, and "Go
 * again" is never refused.
 *
 * What the ratings buy is that order, and a "solid" mark at three right in a
 * row: `rate_letter` adds to the letter's tally in `letter_stats` and pays the
 * same 2 XP a word review pays, in one transaction. The ring on the dashboard
 * and the day streak both read that ledger, so a morning spent on the alphabet
 * counts exactly as a morning spent on words.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LetterFace } from '@/components/LetterFace';
import { SpeakButton } from '@/components/SpeakButton';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import {
  buildRun,
  letterKey,
  runSummary,
  statsByLetter,
  trickyCards,
  type RunTally,
} from '@/lib/letters';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import type { CardRow, LetterStatRow } from '@/lib/types';
import { XP_AWARDS } from '@/lib/xp';

/** One rating, as the screen has to be able to send it again after a failure. */
interface Rating {
  letter: string;
  gotIt: boolean;
}

export default function LettersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const cards = useQuery({ queryKey: ['letter-cards'], queryFn: () => api.listLetterCards() });
  const stats = useQuery({ queryKey: ['letter-stats'], queryFn: () => api.listLetterStats() });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() });

  /** The run's letters, fixed for its lifetime. Null while one is being built. */
  const [run, setRun] = useState<CardRow[] | null>(null);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [tally, setTally] = useState<RunTally>({ gotIt: 0, notYet: 0 });
  const [trickyOnly, setTrickyOnly] = useState(false);
  /** Ratings that never reached the database, in the order they were given. */
  const [failures, setFailures] = useState<Rating[]>([]);

  const tallies = useMemo(() => statsByLetter(stats.data ?? []), [stats.data]);
  const tricky = useMemo(
    () => trickyCards(cards.data ?? [], tallies).length,
    [cards.data, tallies],
  );

  /**
   * Build the run once the alphabet and the tallies are both in.
   *
   * `run === null` is the signal to build, so "Go again" is one `setRun(null)`
   * away — and because the tallies are patched in the cache as each rating is
   * saved, the next run is ordered by what just happened rather than by what was
   * true when the screen opened.
   */
  useEffect(() => {
    if (run !== null || !cards.data || !stats.data) return;
    setRun(buildRun({ cards: cards.data, stats: tallies, trickyOnly }));
    setPosition(0);
    setRevealed(false);
    setTally({ gotIt: 0, notYet: 0 });
  }, [cards.data, run, stats.data, tallies, trickyOnly]);

  /**
   * One rating, written down.
   *
   * The tally in the cache is patched from the row the function returns rather
   * than refetched: thirty rows is a small read, but doing it after every rating
   * would put a round trip between the answer and the next card.
   */
  const rate = useMutation({
    mutationFn: ({ letter, gotIt }: Rating) => api.rateLetter(letter, gotIt),
    onSuccess: (row) => {
      queryClient.setQueryData<LetterStatRow[]>(['letter-stats'], (current) => [
        ...(current ?? []).filter((existing) => existing.letter !== row.letter),
        row,
      ]);
      // The ring and the streak are both read off `xp_events`, which
      // `rate_letter` has just written to.
      void queryClient.invalidateQueries({ queryKey: ['xp'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      // ...and the Alphabet stage counts a solid letter as one of its thirty
      // (`masteredLetters`), so the goal line moves on a third "Got it" too.
      void queryClient.invalidateQueries({ queryKey: ['progress'] });
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
    rateRef.current.mutate({ letter: letterKey(card), gotIt });
    setTally((current) => ({
      gotIt: current.gotIt + (gotIt ? 1 : 0),
      notYet: current.notYet + (gotIt ? 0 : 1),
    }));
    setPosition((current) => current + 1);
    setRevealed(false);
  }, []);

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

  /**
   * Start a fresh run. Never refused: that is the whole point of this screen.
   *
   * Unsaved ratings are sent again on the way out rather than thrown away. The
   * old run's answers were real work — they earned XP and moved a streak — and
   * "Go again" is also what the tricky toggle calls, so a silent `setFailures([])`
   * here would lose them to a tap that never mentioned them.
   */
  const goAgain = useCallback(
    (onlyTricky: boolean) => {
      retryFailures();
      setTrickyOnly(onlyTricky);
      setRun(null);
    },
    [retryFailures],
  );

  const goHome = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  // The error branch comes FIRST, deliberately. A failed query is no longer
  // pending, but the effect above will not build a run without its data, so
  // `run` stays null for ever — put the pending branch first and the screen
  // spins for ever while this message sits below it, unreachable.
  if (cards.isError || stats.isError) {
    return (
      <View style={styles.centred}>
        <Text style={styles.error} testID="letters-error">
          {errorMessage(
            cards.error ?? stats.error,
            'Could not load the letters. They are still there — this is only the reading of them.',
          )}
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

  if (cards.isPending || stats.isPending || settings.isPending || run === null) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const card = run[position];
  const ttsEnabled = settings.data?.tts_enabled ?? true;

  if (!card) {
    return (
      <RunSummary
        tally={tally}
        tricky={tricky}
        failures={failures.length}
        onRetry={retryFailures}
        onAgain={() => goAgain(false)}
        onTricky={() => goAgain(true)}
        onDone={goHome}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.progress} testID="letters-progress">
            {position + 1} of {run.length}
          </Text>
          <Link href="/alphabet" style={styles.link} testID="letters-browse">
            <Text style={styles.linkText}>Browse the alphabet</Text>
          </Link>
        </View>

        <TrickyToggle
          on={trickyOnly}
          tricky={tricky}
          onChange={(next) => goAgain(next)}
        />

        {failures.length > 0 ? (
          <View style={styles.banner} testID="letters-save-error">
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
          invalid HTML as well as an ambiguous tap.
        */}
        <View style={styles.card}>
          <Pressable
            style={styles.cardTap}
            onPress={() => setRevealed(true)}
            disabled={revealed}
            accessibilityRole="button"
            accessibilityLabel="Show the answer"
            testID="letter-card"
          >
            <LetterFace card={card} revealed={revealed} />
          </Pressable>

          <View style={styles.speakRow}>
            <SpeakButton path={card.audio_path} enabled={ttsEnabled} testID="speak-letter" />
          </View>
        </View>

        {revealed ? (
          <View style={styles.answers}>
            <Pressable
              style={({ pressed }) => [styles.answerButton, styles.notYet, pressed && styles.pressed]}
              onPress={() => answer(card, false)}
              accessibilityRole="button"
              testID="rate-not-yet"
            >
              <Text style={[styles.answerLabel, { color: colors.accent }]}>Not yet</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.answerButton, styles.gotIt, pressed && styles.pressed]}
              onPress={() => answer(card, true)}
              accessibilityRole="button"
              testID="rate-got-it"
            >
              <Text style={[styles.answerLabel, { color: colors.primary }]}>Got it</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={() => setRevealed(true)}
            accessibilityRole="button"
            testID="letter-reveal"
          >
            <Text style={styles.primaryButtonText}>Show the answer</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

/**
 * The switch that narrows a run to the letters that are not solid yet.
 *
 * Off by default: the drill is for going through the alphabet, and the shaky
 * letters come first anyway. It turns itself off — and says why — once there is
 * nothing tricky left, rather than starting a run with nothing in it.
 */
function TrickyToggle({
  on,
  tricky,
  onChange,
}: {
  on: boolean;
  /** How many letters are not solid yet. */
  tricky: number;
  onChange: (next: boolean) => void;
}) {
  const available = tricky > 0;

  return (
    <View style={styles.toggleRow}>
      <Pressable
        style={({ pressed }) => [
          styles.toggle,
          on && styles.toggleOn,
          !available && styles.toggleDisabled,
          pressed && available && styles.pressed,
        ]}
        onPress={() => available && onChange(!on)}
        disabled={!available}
        accessibilityRole="switch"
        accessibilityState={{ checked: on, disabled: !available }}
        accessibilityLabel="Only the tricky ones"
        testID="tricky-toggle"
      >
        <Text style={[styles.toggleMark, on && styles.toggleMarkOn]}>{on ? '✓' : ''}</Text>
        <Text style={[styles.toggleLabel, !available && styles.toggleLabelDisabled]}>
          Only the tricky ones
        </Text>
      </Pressable>
      <Text style={styles.toggleNote} testID="tricky-note">
        {available
          ? `${tricky} letter${tricky === 1 ? '' : 's'} still to get right three times in a row`
          : 'Every letter is solid — so this runs all thirty.'}
      </Text>
    </View>
  );
}

/**
 * The end of a run: what it came to, and every way straight back in.
 *
 * "Go again" is the big button, deliberately. Nothing on this screen can be
 * unavailable, so the summary is a doorway rather than a stopping point.
 */
function RunSummary({
  tally,
  tricky,
  failures,
  onRetry,
  onAgain,
  onTricky,
  onDone,
}: {
  tally: RunTally;
  tricky: number;
  failures: number;
  onRetry: () => void;
  onAgain: () => void;
  onTricky: () => void;
  onDone: () => void;
}) {
  const total = tally.gotIt + tally.notYet;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.content} testID="letters-summary">
        <Text style={styles.summaryTitle}>
          {total === 0
            ? 'Nothing in this run'
            : tally.notYet === 0
              ? 'Every one of them!'
              : 'Run finished'}
        </Text>
        {/*
          The tally counts every answer given, saved or not — it is the record of
          the run, and a failed write does not un-answer a card. So when some of
          them are still stuck, the line says so rather than quietly overstating
          what reached the database. The banner below offers the retry.
        */}
        <Text style={styles.summaryLine} testID="letters-summary-line">
          {runSummary(tally)}
          {failures > 0 ? ` · ${failures} not saved yet` : ''}
        </Text>

        {failures > 0 ? (
          <View style={styles.banner} testID="letters-save-error">
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
          onPress={onAgain}
          accessibilityRole="button"
          testID="letters-again"
        >
          <Text style={styles.primaryButtonText}>Go again</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.secondaryButton,
            tricky === 0 && styles.secondaryDisabled,
            pressed && tricky > 0 && styles.pressed,
          ]}
          onPress={onTricky}
          disabled={tricky === 0}
          accessibilityRole="button"
          accessibilityState={{ disabled: tricky === 0 }}
          testID="letters-again-tricky"
        >
          <Text
            style={[styles.secondaryLabel, tricky === 0 && styles.secondaryLabelDisabled]}
          >
            Only the tricky ones
          </Text>
          <Text style={styles.secondaryNote}>
            {tricky === 0
              ? 'Every letter is solid — there are none left to pick out.'
              : `${tricky} letter${tricky === 1 ? '' : 's'} still to get right three times in a row`}
          </Text>
        </Pressable>

        <Link href="/alphabet" style={styles.link} testID="letters-summary-browse">
          <Text style={styles.linkText}>Browse the alphabet</Text>
        </Link>

        <Pressable
          style={styles.textButton}
          onPress={onDone}
          accessibilityRole="button"
          testID="letters-done"
        >
          <Text style={styles.textButtonLabel}>Back to the dashboard</Text>
        </Pressable>

        <Text style={styles.footnote}>
          Every answer is worth {XP_AWARDS.review} XP, the same as a word, and today counts
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
  link: { paddingVertical: spacing.xs },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  toggleRow: { gap: spacing.xs },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    minHeight: touchTarget - 8,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toggleOn: { borderColor: colors.primary },
  toggleDisabled: { backgroundColor: colors.background, borderColor: colors.disabled },
  toggleMark: {
    width: 22,
    height: 22,
    lineHeight: 22,
    textAlign: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: 'transparent',
    overflow: 'hidden',
  },
  toggleMarkOn: { color: colors.primaryOn, backgroundColor: colors.primary, borderColor: colors.primary },
  toggleLabel: { fontSize: 15, color: colors.text, fontWeight: '600' },
  toggleLabelDisabled: { color: colors.textMuted },
  toggleNote: { fontSize: 12, color: colors.textMuted },
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
  },
  primaryButtonText: { color: colors.primaryOn, fontSize: 17, fontWeight: '600' },
  secondaryButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: 2,
  },
  secondaryDisabled: { borderColor: colors.disabled },
  secondaryLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  secondaryLabelDisabled: { color: colors.textMuted },
  secondaryNote: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  summaryTitle: { fontSize: 32, fontWeight: '700', color: colors.text, textAlign: 'center' },
  summaryLine: { fontSize: 16, color: colors.textMuted, textAlign: 'center' },
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
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  footnote: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
});
