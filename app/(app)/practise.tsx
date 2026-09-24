/**
 * Practise — pick some words, then pick how to go over them.
 *
 * This replaces four doors on the home screen (the Cyrillic trainer, Read it,
 * Review and learning from the Deck) with one, because four equal choices with
 * four different ideas of *which* words was a wall rather than a way in. Here
 * the two questions are asked one at a time, and the answer to the first goes
 * to whichever way answers the second, as `?theme=` (`lib/practise.ts`).
 *
 * The sets are the Read it picker's, unchanged: "My words" first, then every
 * domain the deck actually has (`buildThemes`), so a new theme shows up the day
 * its first card lands. The last set picked is remembered, so coming back here
 * after a round goes straight to "how?" for the same words.
 *
 * The daily flashcard session keeps its one-tap path at the top: it is the one
 * habit that is about the whole deck rather than a set, and the dashboard's
 * figures say whether there is anything in it.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { DEFAULT_NEW_PER_DAY, api, type Theme } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import {
  MINE_THEME,
  WAYS,
  dailyReviewCount,
  readLastSet,
  wayHref,
  writeLastSet,
  type PractiseWay,
} from '@/lib/practise';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';

/** "1 word", "60 words". */
function wordCount(total: number): string {
  return `${total} ${total === 1 ? 'word' : 'words'}`;
}

export default function PractiseScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();

  /**
   * The sets, under the key the Read aloud run refreshes when it ends.
   *
   * `fetchQuery` over the three lists the app already caches, exactly as the old
   * picker did: each answers from `['cards']`, `['read-stats']` or `['library']`
   * while fresh, so arriving here from home or from a run costs no round trip,
   * and the ways opened from here find those lists warm in return.
   */
  const themes = useQuery({
    queryKey: ['read-themes'],
    queryFn: () =>
      api.listThemes({
        listCards: () =>
          queryClient.fetchQuery({ queryKey: ['cards'], queryFn: () => api.listCards() }),
        listReadStats: () =>
          queryClient.fetchQuery({ queryKey: ['read-stats'], queryFn: () => api.listReadStats() }),
        getLibrary: () =>
          queryClient.fetchQuery({ queryKey: ['library'], queryFn: () => api.getLibrary() }),
      }),
  });
  // The dashboard's own keys, so the daily line quotes the number home shows
  // and, arriving from home, costs nothing.
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api.getDashboard() });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() });

  /** The set being practised; null while the list is showing. */
  const [chosen, setChosen] = useState<string | null>(() => readLastSet());

  const rows = themes.data ?? [];
  // A remembered set that has since emptied, or disappeared from the deck, is
  // not a set to offer ways into: fall back to the list.
  const set = rows.find((theme) => theme.domain === chosen && theme.total > 0) ?? null;

  const choose = useCallback((theme: Theme) => {
    setChosen(theme.domain);
    writeLastSet(theme.domain);
  }, []);

  const open = useCallback(
    (way: PractiseWay, theme: string) => router.push(wayHref(way, theme)),
    [router],
  );

  const daily = dashboard.data
    ? dailyReviewCount(dashboard.data, settings.data?.new_per_day ?? DEFAULT_NEW_PER_DAY)
    : 0;

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={themes.isRefetching}
          onRefresh={() => void themes.refetch()}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.content}>
        {daily > 0 ? (
          <Pressable
            style={({ pressed }) => [styles.daily, pressed && styles.pressed]}
            onPress={() => router.push('/review')}
            accessibilityRole="button"
            accessibilityLabel={`Today’s flashcards. ${daily} waiting.`}
            testID="practise-daily"
          >
            <Text style={styles.dailyText}>
              Today’s flashcards · <Text style={styles.dailyCount}>{daily}</Text> waiting
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ) : null}

        {themes.isPending ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : themes.isError ? (
          <View style={styles.centred}>
            <Text style={styles.error} testID="practise-error">
              {errorMessage(themes.error, 'Could not load your words.')}
            </Text>
            <Pressable style={styles.textButton} onPress={() => void themes.refetch()}>
              <Text style={styles.textButtonLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : set ? (
          <Ways set={set} onChange={() => setChosen(null)} onOpen={open} />
        ) : (
          <>
            <Text style={styles.heading}>Which words?</Text>
            {rows.map((theme) => (
              <SetRow key={theme.domain} theme={theme} onPick={() => choose(theme)} />
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

/**
 * One set on the list. "My words" is the one that can be empty, and then it
 * says how to fill it rather than opening three ways into nothing.
 */
function SetRow({ theme, onPick }: { theme: Theme; onPick: () => void }) {
  const empty = theme.total === 0;
  const mine = theme.domain === MINE_THEME;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        mine && !empty && styles.rowMine,
        empty && styles.rowDisabled,
        pressed && !empty && styles.pressed,
      ]}
      onPress={onPick}
      disabled={empty}
      accessibilityRole="button"
      accessibilityState={{ disabled: empty }}
      accessibilityLabel={
        empty ? `${theme.label}. Nothing here yet.` : `${theme.label}. ${wordCount(theme.total)}.`
      }
      testID={`practise-set-${theme.domain}`}
    >
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, empty && styles.rowTitleDisabled]}>{theme.label}</Text>
        <Text style={styles.rowMeta} testID={`practise-set-meta-${theme.domain}`}>
          {empty
            ? mine
              ? 'Nothing here yet — tick words you know in My words'
              : 'No words yet'
            : wordCount(theme.total)}
        </Text>
      </View>
      {empty ? null : <Text style={styles.chevron}>›</Text>}
    </Pressable>
  );
}

/** The second question, for the set just picked: three big, one-line buttons. */
function Ways({
  set,
  onChange,
  onOpen,
}: {
  set: Theme;
  onChange: () => void;
  onOpen: (way: PractiseWay, theme: string) => void;
}) {
  return (
    <>
      <View style={styles.chosen} testID="practise-chosen">
        <View style={styles.rowText}>
          <Text style={styles.chosenLabel}>{set.label}</Text>
          <Text style={styles.rowMeta}>{wordCount(set.total)}</Text>
        </View>
        <Pressable
          style={styles.changeButton}
          onPress={onChange}
          accessibilityRole="button"
          accessibilityLabel="Pick other words"
          testID="practise-change"
        >
          <Text style={styles.textButtonLabel}>Change</Text>
        </Pressable>
      </View>

      <Text style={styles.heading}>How?</Text>
      {WAYS.map((option) => (
        <Pressable
          key={option.way}
          style={({ pressed }) => [styles.way, pressed && styles.pressed]}
          onPress={() => onOpen(option.way, set.domain)}
          accessibilityRole="button"
          accessibilityLabel={`${option.label}. ${option.blurb}`}
          testID={`practise-way-${option.way}`}
        >
          <Text style={styles.wayLabel}>{option.label}</Text>
          <Text style={styles.wayBlurb}>{option.blurb}</Text>
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: spacing.md },
  content: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    gap: spacing.sm,
  },
  loading: { marginVertical: spacing.xl },
  centred: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.sm,
  },
  daily: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  dailyText: { flexShrink: 1, fontSize: 15, color: colors.text },
  dailyCount: { fontWeight: '700', color: colors.primary },
  row: {
    minHeight: touchTarget + 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowMine: { borderColor: colors.primary },
  rowDisabled: { backgroundColor: colors.background, borderColor: colors.disabled },
  rowText: { flexShrink: 1, gap: 2 },
  rowTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  rowTitleDisabled: { color: colors.textMuted },
  rowMeta: { fontSize: 13, color: colors.textMuted },
  chevron: { fontSize: 28, color: colors.primary },
  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chosenLabel: { fontSize: 22, fontWeight: '700', color: colors.text },
  changeButton: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  // The three ways are the screen's whole point once a set is picked: full
  // width, primary colour, big enough to hit without looking.
  way: {
    minHeight: touchTarget + 28,
    justifyContent: 'center',
    gap: 2,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  wayLabel: { fontSize: 22, fontWeight: '700', color: colors.primaryOn },
  wayBlurb: { fontSize: 14, color: colors.primaryOn, opacity: 0.9 },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
