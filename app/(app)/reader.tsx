/**
 * Читање — the library.
 *
 * Two sections over one query: what is still to read, and what has been read.
 * They come from the same `['stories']` list rather than two filtered queries,
 * so finishing a story moves it between them without the two ever disagreeing
 * about a row.
 *
 * "Нова прича" is the only way a story gets here. The level picker defaults to
 * what the learner's vocabulary suggests (spec §3.3) but never insists — the
 * whole point of the reader is that he chooses what he feels like reading.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import {
  describeStoryError,
  STORY_LEVEL_BLURB,
  STORY_LEVELS,
  suggestedLevel,
  type StoryLevel,
} from '@/lib/reader';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import type { StoryRow } from '@/lib/types';

export default function ReaderScreen() {
  const [composing, setComposing] = useState(false);

  const stories = useQuery({ queryKey: ['stories'], queryFn: () => api.listStories() });
  // Only for the level the picker opens on; the list does not wait on it.
  const progress = useQuery({ queryKey: ['progress'], queryFn: () => api.getProgress() });

  if (composing) {
    return (
      <NewStory
        defaultLevel={suggestedLevel(progress.data?.knownWords ?? 0)}
        onCancel={() => setComposing(false)}
        onCreated={() => setComposing(false)}
      />
    );
  }

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
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={() => setComposing(true)}
          accessibilityRole="button"
          accessibilityLabel="New story"
          testID="reader-new"
        >
          <Text style={styles.primaryButtonCyr}>Нова прича</Text>
          <Text style={styles.primaryButtonEn}>New story</Text>
        </Pressable>

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
            <Text style={styles.emptyCyr}>Читање</Text>
            <Text style={styles.muted} testID="reader-empty">
              Nothing to read yet. Tap Нова прича and one will be written for you, using the
              words you already know.
            </Text>
          </View>
        ) : (
          <>
            <Section
              title="За читање"
              subtitle="To read"
              stories={unread}
              empty="Everything here has been read. Ask for a new one."
              testID="reader-unread"
            />
            <Section
              title="Прочитано"
              subtitle="Read"
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
  subtitle,
  stories,
  empty,
  testID,
}: {
  title: string;
  subtitle: string;
  stories: readonly StoryRow[];
  empty: string;
  testID: string;
}) {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSubtitle}>
          {subtitle} · {stories.length}
        </Text>
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
      <Text style={styles.badgeText}>НИВО {level}</Text>
    </View>
  );
}

/**
 * The "Нова прича" form: which level, and optionally what about.
 *
 * Generation is the one thing here that can fail in a way the user must be told
 * about honestly — `describeStoryError` keeps the "check the key" wording off
 * the failures where the key is not the problem — so the error stays on screen
 * with the form filled in, ready to send again.
 */
function NewStory({
  defaultLevel,
  onCancel,
  onCreated,
}: {
  defaultLevel: StoryLevel;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [level, setLevel] = useState<StoryLevel>(defaultLevel);
  const [topic, setTopic] = useState('');

  const create = useMutation({
    mutationFn: () => api.createStory(level, topic),
    onSuccess: async (story) => {
      // Awaited before navigating: the reading view looks the story up in this
      // very list, and a push onto a stale cache would land on "not found".
      await queryClient.invalidateQueries({ queryKey: ['stories'] });
      onCreated();
      router.push(`/story/${story.id}`);
    },
  });

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.content}>
        <Text style={styles.formTitle}>Нова прича</Text>

        <Text style={styles.fieldLabel}>Level</Text>
        <View style={styles.levelRow}>
          {STORY_LEVELS.map((option) => (
            <Pressable
              key={option}
              style={({ pressed }) => [
                styles.levelChip,
                level === option && styles.levelChipSelected,
                pressed && styles.pressed,
              ]}
              onPress={() => setLevel(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: level === option }}
              testID={`new-story-level-${option}`}
            >
              <Text style={[styles.levelChipCyr, level === option && styles.levelChipTextOn]}>
                НИВО {option}
              </Text>
              <Text style={[styles.levelChipBlurb, level === option && styles.levelChipTextOn]}>
                {STORY_LEVEL_BLURB[option]}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.muted} testID="new-story-suggestion">
          {defaultLevel === level
            ? `Level ${defaultLevel} suits how many words you know.`
            : `Suggested for you: level ${defaultLevel}.`}
        </Text>

        <Text style={styles.fieldLabel}>What about? (optional)</Text>
        <TextInput
          style={styles.input}
          value={topic}
          onChangeText={setTopic}
          placeholder="a cat in the garden"
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          testID="new-story-topic"
        />

        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            create.isPending && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
          disabled={create.isPending}
          onPress={() => create.mutate()}
          accessibilityRole="button"
          testID="new-story-write"
        >
          <Text style={styles.primaryButtonCyr}>
            {create.isPending ? 'Пише…' : 'Напиши причу'}
          </Text>
          <Text style={styles.primaryButtonEn}>
            {create.isPending ? 'Writing…' : 'Write the story'}
          </Text>
        </Pressable>

        {create.isError ? (
          <View style={styles.errorCard} testID="new-story-error">
            <Text style={styles.error}>{describeStoryError(create.error)}</Text>
            <Pressable
              style={styles.textButton}
              onPress={() => create.mutate()}
              disabled={create.isPending}
              accessibilityRole="button"
              testID="new-story-retry"
            >
              <Text style={styles.textButtonLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          style={styles.textButton}
          onPress={onCancel}
          accessibilityRole="button"
          testID="new-story-cancel"
        >
          <Text style={styles.textButtonLabel}>Back to the library</Text>
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
  loading: { marginVertical: spacing.xl },
  centred: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyCyr: { fontSize: 34, fontWeight: '700', color: colors.primary },
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
  formTitle: { fontSize: 26, fontWeight: '700', color: colors.text },
  fieldLabel: { fontSize: 13, color: colors.textMuted },
  levelRow: { gap: spacing.sm },
  levelChip: {
    minHeight: touchTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  levelChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  levelChipCyr: { fontSize: 17, fontWeight: '600', color: colors.text },
  levelChipBlurb: { fontSize: 13, color: colors.textMuted },
  levelChipTextOn: { color: colors.primaryOn },
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
  },
  primaryButton: {
    minHeight: touchTarget + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
  },
  primaryButtonCyr: { color: colors.primaryOn, fontSize: 22, fontWeight: '700' },
  primaryButtonEn: { color: colors.primaryOn, fontSize: 13, opacity: 0.85 },
  buttonDisabled: { backgroundColor: colors.disabled },
  errorCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  error: { color: colors.danger, fontSize: 14 },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
