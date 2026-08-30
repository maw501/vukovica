/**
 * The reader's library.
 *
 * Two sections over one query: what is still to read, and what has been read.
 * They come from the same `['stories']` list rather than two filtered queries,
 * so finishing a story moves it between them without the two ever disagreeing
 * about a row.
 *
 * Stories are seeded rather than generated (phase 3 removed the `story` Edge
 * Function), so this screen only lists and opens them — there is nothing here
 * that can fail beyond the read itself.
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

import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import type { StoryRow } from '@/lib/types';

export default function ReaderScreen() {
  const stories = useQuery({ queryKey: ['stories'], queryFn: () => api.listStories() });

  const all = stories.data ?? [];
  const unread = all.filter((story) => story.finished_at === null);
  const finished = all.filter((story) => story.finished_at !== null);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={stories.isRefetching}
          onRefresh={() => void stories.refetch()}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.content}>
        {stories.isPending ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : stories.isError ? (
          <View style={styles.centred}>
            <Text style={styles.error} testID="reader-error">
              {errorMessage(stories.error, 'Could not load your stories.')}
            </Text>
            <Pressable style={styles.textButton} onPress={() => void stories.refetch()}>
              <Text style={styles.textButtonLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : all.length === 0 ? (
          <View style={styles.centred}>
            <Text style={styles.emptyTitle}>Nothing to read yet</Text>
            <Text style={styles.muted} testID="reader-empty">
              Stories are added to your library for you. Pull down to check for new ones.
            </Text>
          </View>
        ) : (
          <>
            <Section
              title="To read"
              count={unread.length}
              stories={unread}
              empty="Everything here has been read."
              testID="reader-unread"
            />
            <Section
              title="Read"
              count={finished.length}
              stories={finished}
              empty="Nothing finished yet."
              testID="reader-finished"
            />
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Section({
  title,
  count,
  stories,
  empty,
  testID,
}: {
  title: string;
  count: number;
  stories: readonly StoryRow[];
  empty: string;
  testID: string;
}) {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSubtitle}>{count}</Text>
      </View>
      {stories.length === 0 ? (
        <Text style={styles.muted} testID={`${testID}-empty`}>
          {empty}
        </Text>
      ) : (
        stories.map((story) => <StoryRowItem key={story.id} story={story} />)
      )}
    </View>
  );
}

function StoryRowItem({ story }: { story: StoryRow }) {
  const router = useRouter();

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={() => router.push(`/story/${story.id}`)}
      accessibilityRole="button"
      accessibilityLabel={story.title_cyr}
      testID={`story-row-${story.id}`}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{story.title_cyr}</Text>
        <Text style={styles.rowMeta}>{story.word_count} words</Text>
      </View>
      <LevelBadge level={story.level} />
    </Pressable>
  );
}

/** The difficulty band, as a chip. `stories.level` is checked 1-3 in the database. */
function LevelBadge({ level }: { level: number }) {
  return (
    <View style={styles.badge} testID={`level-badge-${level}`}>
      <Text style={styles.badgeText}>Level {level}</Text>
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
  loading: { marginVertical: spacing.xl },
  centred: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { fontSize: 26, fontWeight: '700', color: colors.text, textAlign: 'center' },
  muted: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  section: { gap: spacing.sm },
  sectionHeader: { gap: 2 },
  sectionTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
  sectionSubtitle: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase' },
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
  rowText: { flexShrink: 1, gap: 2 },
  rowTitle: { fontSize: 20, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 13, color: colors.textMuted },
  badge: {
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  error: { color: colors.danger, fontSize: 14 },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
