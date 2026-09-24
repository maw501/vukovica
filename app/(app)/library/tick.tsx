/**
 * Tick the words you know — the deck a theme at a time, one tap a word.
 *
 * Mark came to the app already knowing a fair amount of Serbian by ear, and
 * started it with nothing in My words. Grading hundreds of cards through review
 * to get the known ones out of the way is not a job anyone does, so this is the
 * fast way: pick a theme, see every word in it with its Cyrillic, Latin and
 * English, tap the ones you have. A tap is `mark_known` — the same "I already
 * know this" the review screen and the Deck offer — and it shows as ticked the
 * moment it is tapped, not when the server answers.
 *
 * Two views on one route: with no `theme` it lists the themes and how much of
 * each is known; with one, it lists that theme's words.
 *
 * There is no un-tick. The app has no way to take a word back out of My words
 * (only `mark_known`, no inverse), and adding one is SQL this change does not
 * need: a mis-tapped word is parked, not lost, and comes back round in review
 * in a few months, where a wrong answer puts it back into learning.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ScriptText } from '@/components/ScriptText';
import { api, type LibraryEntry } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { themeCards, themeLabel } from '@/lib/readDrill';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { knownCardIds, knownOfLine, tickThemes, withMarkedKnown } from '@/lib/tick';
import { cyrToLat } from '@/lib/transliterate';
import type { CardRow } from '@/lib/types';

export default function TickScreen() {
  const params = useLocalSearchParams<{ theme?: string }>();
  const theme = params.theme?.trim() || null;

  // The deck and My words: the same two cached lists the Deck, Read it and My
  // words screens fill, so arriving here from any of them costs no round trip.
  const cards = useQuery({ queryKey: ['cards'], queryFn: () => api.listCards() });
  const library = useQuery({ queryKey: ['library'], queryFn: () => api.getLibrary() });

  const knownIds = useMemo(() => knownCardIds(library.data ?? []), [library.data]);

  if (cards.isPending || library.isPending) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (cards.isError || library.isError) {
    return (
      <View style={styles.centred}>
        <Text style={styles.error} testID="tick-error">
          {errorMessage(cards.error ?? library.error, 'Could not load the words.')}
        </Text>
        <Pressable
          style={styles.textButton}
          accessibilityRole="button"
          onPress={() => {
            void cards.refetch();
            void library.refetch();
          }}
        >
          <Text style={styles.textButtonLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return theme ? (
    <ThemeWords theme={theme} cards={cards.data} knownIds={knownIds} />
  ) : (
    <ThemeList cards={cards.data} knownIds={knownIds} />
  );
}

/** Every theme, and how much of each he has ticked. */
function ThemeList({
  cards,
  knownIds,
}: {
  cards: readonly CardRow[];
  knownIds: ReadonlySet<string>;
}) {
  const router = useRouter();
  const themes = useMemo(() => tickThemes({ cards, knownIds }), [cards, knownIds]);

  return (
    <FlatList
      data={themes}
      keyExtractor={(item) => item.domain}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        <Text style={styles.intro}>
          Pick a theme, then tap every word you already know. They go straight into My words.
        </Text>
      }
      ListEmptyComponent={
        <Text style={styles.muted} testID="tick-no-themes">
          The deck has no words yet.
        </Text>
      }
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${item.label}, ${knownOfLine(item.known, item.total)}`}
          testID={`tick-theme-${item.domain}`}
          onPress={() =>
            router.push({ pathname: '/library/tick', params: { theme: item.domain } })
          }
        >
          <View style={styles.rowText}>
            <Text style={styles.themeLabel}>{item.label}</Text>
            <Text style={styles.muted}>{knownOfLine(item.known, item.total)}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      )}
    />
  );
}

/**
 * One theme's words, each a single tap to tick.
 *
 * Optimistic: the tick appears on the tap, and only a failure takes it away
 * again (with a line saying so). What the server hands back is written straight
 * into the `['library']` cache (`withMarkedKnown`) rather than refetching all of
 * My words per tap — this screen is tapped at speed. The counts elsewhere in the
 * app (home, progress, the review queue, the Read it picker) are marked stale
 * once, when he leaves, rather than refetched after every word.
 */
function ThemeWords({
  theme,
  cards,
  knownIds,
}: {
  theme: string;
  cards: readonly CardRow[];
  knownIds: ReadonlySet<string>;
}) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() });
  const showLatin = settings.data?.show_latin ?? true;

  const words = useMemo(() => themeCards({ theme, cards }), [cards, theme]);
  /** Tapped and not yet confirmed — shown as ticked meanwhile. */
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const [failure, setFailure] = useState<string | null>(null);
  /** Whether anything was ticked, so leaving knows whether to refresh the counts. */
  const dirty = useRef(false);

  useEffect(
    () => () => {
      if (!dirty.current) return;
      void queryClient.invalidateQueries({ queryKey: ['progress'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
      void queryClient.invalidateQueries({ queryKey: ['read-themes'] });
    },
    [queryClient],
  );

  const tick = useMutation({
    mutationFn: (card: CardRow) => api.markKnown(card.id),
    // Options-level callbacks, not `mutate`'s: these fire for every tap, where
    // the per-call ones would only fire for the most recent of several in flight.
    onMutate: (card) => {
      setFailure(null);
      setInFlight((current) => new Set(current).add(card.id));
    },
    onSuccess: (row, card) => {
      dirty.current = true;
      queryClient.setQueryData<LibraryEntry[]>(['library'], (current) =>
        withMarkedKnown(current, card, row),
      );
    },
    onError: (error, card) => {
      console.warn('mark_known failed:', errorMessage(error, 'no message'));
      setFailure(`Couldn’t save ${card.sr_cyr}. Tap it again.`);
    },
    onSettled: (_row, _error, card) => {
      setInFlight((current) => {
        const next = new Set(current);
        next.delete(card.id);
        return next;
      });
    },
  });

  const ticked = (card: CardRow) => knownIds.has(card.id) || inFlight.has(card.id);
  const knownHere = words.filter(ticked).length;

  return (
    <FlatList
      data={words}
      keyExtractor={(card) => card.id}
      contentContainerStyle={styles.listContent}
      extraData={inFlight}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title} testID="tick-theme-title">
            {themeLabel(theme)}
          </Text>
          <Text style={styles.count} testID="tick-count">
            {knownOfLine(knownHere, words.length)}
          </Text>
          <Text style={styles.muted}>
            Tap the words you already know. Ticked one by mistake? It will come back round in a
            few months to check.
          </Text>
          {failure ? (
            <Text style={styles.error} testID="tick-failure">
              {failure}
            </Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.muted} testID="tick-empty">
          No words in this theme yet.
        </Text>
      }
      renderItem={({ item }) => {
        const on = ticked(item);
        return (
          <Pressable
            style={({ pressed }) => [styles.row, on && styles.rowTicked, pressed && styles.pressed]}
            // A known word stays known: there is no un-tick to offer (see the
            // comment at the top of this file).
            disabled={on}
            onPress={() => tick.mutate(item)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: on }}
            accessibilityLabel={`${item.sr_cyr}, ${item.en}`}
            testID={`tick-word-${item.sr_cyr}`}
          >
            <View style={styles.rowText}>
              <ScriptText role="cyr" style={styles.wordCyr}>
                {item.sr_cyr}
              </ScriptText>
              {/* Two roles on one line, so two runs rather than one string: the
                  transliteration is terracotta and the gloss is muted. */}
              <Text style={styles.wordSub}>
                {showLatin ? (
                  <>
                    <ScriptText role="lat">{cyrToLat(item.sr_cyr)}</ScriptText>
                    {' · '}
                  </>
                ) : null}
                <ScriptText role="en">{item.en}</ScriptText>
              </Text>
            </View>
            <View style={[styles.box, on && styles.boxOn]}>
              {on ? <Text style={styles.boxMark}>✓</Text> : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  listContent: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: { gap: spacing.xs, marginBottom: spacing.sm },
  intro: { fontSize: 15, color: colors.text, marginBottom: spacing.sm },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  count: { fontSize: 17, fontWeight: '600', color: colors.primary },
  row: {
    minHeight: touchTarget + 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowTicked: { borderColor: colors.primary },
  rowText: { flexShrink: 1, gap: 2 },
  themeLabel: { fontSize: 18, fontWeight: '600', color: colors.text },
  // Colour and face come from `script`; only size and weight live here.
  wordCyr: { fontSize: 22, fontWeight: '600' },
  wordSub: { fontSize: 14, color: colors.textMuted },
  box: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  boxMark: { color: colors.primaryOn, fontSize: 18, fontWeight: '700' },
  chevron: { fontSize: 28, color: colors.primary },
  muted: { fontSize: 14, color: colors.textMuted },
  error: { color: colors.danger, fontSize: 14 },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
