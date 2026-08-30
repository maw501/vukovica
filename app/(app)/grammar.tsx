/**
 * The grammar section's contents page: twelve topics in teaching order, each
 * with what the user has got right on it so far.
 *
 * The topics are seeded content (`supabase/migrations/20260830170000_seed_grammar.sql`),
 * so there is nothing here to create or edit — this screen lists and opens. The
 * accuracy beside each one comes back on the same read as the topic itself, so
 * the list is one round trip however long it grows.
 *
 * English chrome throughout, as everywhere else in the app: the Serbian lives in
 * the drill's prompts and answers, and in the examples inside a topic's
 * explanation. A topic's own title is the exception the content makes for
 * itself — it names the verb being conjugated (волети — to love), which is the
 * one thing about the topic that has to be in Cyrillic.
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

import { api, type GrammarTopicEntry } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { topicAccuracy } from '@/lib/grammar';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';

export default function GrammarScreen() {
  const topics = useQuery({
    queryKey: ['grammar-topics'],
    queryFn: () => api.listGrammarTopics(),
  });

  const rows = topics.data ?? [];

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={topics.isRefetching}
          onRefresh={() => void topics.refetch()}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.content}>
        <Text style={styles.blurb}>
          Ten questions a topic. Type the missing word in Cyrillic or Latin — either is
          accepted.
        </Text>

        {topics.isPending ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : topics.isError ? (
          <View style={styles.centred}>
            <Text style={styles.error} testID="grammar-error">
              {errorMessage(topics.error, 'Could not load the grammar topics.')}
            </Text>
            <Pressable style={styles.textButton} onPress={() => void topics.refetch()}>
              <Text style={styles.textButtonLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.centred}>
            <Text style={styles.emptyTitle}>No topics yet</Text>
            <Text style={styles.muted} testID="grammar-empty">
              The grammar topics ship with the app. Pull down to check again.
            </Text>
          </View>
        ) : (
          rows.map((topic) => <TopicRow key={topic.id} topic={topic} />)
        )}
      </View>
    </ScrollView>
  );
}

function TopicRow({ topic }: { topic: GrammarTopicEntry }) {
  const router = useRouter();
  const accuracy = topicAccuracy(topic.stat ?? undefined);
  const attempts = topic.stat?.attempts ?? 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={() => router.push(`/grammar/${topic.slug}`)}
      accessibilityRole="button"
      accessibilityLabel={
        accuracy === null
          ? `${topic.title_en}. Not drilled yet.`
          : `${topic.title_en}. ${accuracy}% right of ${attempts} answers.`
      }
      testID={`grammar-topic-${topic.slug}`}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{topic.title_en}</Text>
        <Text style={styles.rowMeta} testID={`grammar-accuracy-${topic.slug}`}>
          {/* "Not drilled yet" rather than 0%: an untouched topic and one every
              answer of which was wrong are different things. */}
          {accuracy === null
            ? 'Not drilled yet'
            : `${accuracy}% right · ${attempts} answered`}
        </Text>
      </View>
      {accuracy === null ? null : (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{accuracy}%</Text>
        </View>
      )}
      <Text style={styles.chevron}>›</Text>
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
  rowText: { flexShrink: 1, gap: 2 },
  rowTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
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
  chevron: { fontSize: 28, color: colors.primary },
  error: { color: colors.danger, fontSize: 14 },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
