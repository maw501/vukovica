/**
 * "Read it" — pick a theme, then read its words in Cyrillic.
 *
 * The letters drill taught the thirty shapes; this is the same exercise with
 * whole words, and it is a *reading* drill rather than a vocabulary one. Mark
 * asked to see a word in Cyrillic only, read it out loud, say what it means, and
 * turn it over to check — so nothing on the card face helps, and nothing here is
 * ever locked or rationed.
 *
 * The list is driven by the domains the deck actually has, not by a hard-coded
 * menu: words are written between sessions and arrive as rows, so a new theme
 * shows up the day its first card lands (`lib/domains.ts` only says what to call
 * one). "My words" leads, because the words he already knows are the ones most
 * worth being able to *read*.
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

import { api, type Theme } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { MINE_THEME } from '@/lib/readDrill';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';

export default function ReadScreen() {
  const themes = useQuery({ queryKey: ['read-themes'], queryFn: () => api.listThemes() });

  const rows = themes.data ?? [];

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
        <Text style={styles.title}>Read it</Text>
        <Text style={styles.blurb}>
          Read the word out loud, say what it means, then check.
        </Text>

        {themes.isPending ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : themes.isError ? (
          <View style={styles.centred}>
            <Text style={styles.error} testID="read-error">
              {errorMessage(themes.error, 'Could not load the themes.')}
            </Text>
            <Pressable style={styles.textButton} onPress={() => void themes.refetch()}>
              <Text style={styles.textButtonLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.centred}>
            <Text style={styles.emptyTitle}>No words yet</Text>
            <Text style={styles.muted} testID="read-empty">
              Themes appear here as words arrive in the deck.
            </Text>
          </View>
        ) : (
          rows.map((theme) => <ThemeRow key={theme.domain} theme={theme} />)
        )}
      </View>
    </ScrollView>
  );
}

/**
 * One theme: what it is called, how many words it holds and how many of those
 * have been read right three times running.
 *
 * "My words" is the one row that can be empty, and when it is it says what to do
 * about it rather than opening a run with nothing in it.
 */
function ThemeRow({ theme }: { theme: Theme }) {
  const router = useRouter();
  const empty = theme.total === 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, empty && styles.rowDisabled, pressed && !empty && styles.pressed]}
      onPress={() => router.push(`/read/run?theme=${encodeURIComponent(theme.domain)}`)}
      disabled={empty}
      accessibilityRole="button"
      accessibilityState={{ disabled: empty }}
      accessibilityLabel={
        empty
          ? `${theme.label}. No words yet.`
          : `${theme.label}. ${theme.total} words, ${theme.solid} solid.`
      }
      testID={`read-theme-${theme.domain}`}
    >
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, empty && styles.rowTitleDisabled]}>{theme.label}</Text>
        <Text style={styles.rowMeta} testID={`read-theme-meta-${theme.domain}`}>
          {empty
            ? theme.domain === MINE_THEME
              ? 'Add words first'
              : 'No words yet'
            : `${theme.total} ${theme.total === 1 ? 'word' : 'words'} · ${theme.solid} solid`}
        </Text>
      </View>
      {empty ? null : <Text style={styles.chevron}>›</Text>}
    </Pressable>
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
  title: { fontSize: 30, fontWeight: '700', color: colors.text },
  blurb: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.xs },
  loading: { marginVertical: spacing.xl },
  centred: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { fontSize: 26, fontWeight: '700', color: colors.text, textAlign: 'center' },
  muted: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  row: {
    minHeight: touchTarget + 16,
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
  rowDisabled: { backgroundColor: colors.background, borderColor: colors.disabled },
  rowText: { flexShrink: 1, gap: 2 },
  rowTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  rowTitleDisabled: { color: colors.textMuted },
  rowMeta: { fontSize: 13, color: colors.textMuted },
  chevron: { fontSize: 28, color: colors.primary },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
