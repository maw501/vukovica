/**
 * The reading view: one story, big Cyrillic, every word tappable.
 *
 * **No Latin in the story itself** (spec §3.3). Decoding Cyrillic is the whole
 * exercise, so `settings.show_latin` deliberately does not reach the body — the
 * transliteration a learner can lean on everywhere else is exactly what would
 * stop him reading. The sheet a tap opens is a different matter: it is the
 * answer, not the exercise.
 *
 * The body is rendered as a single `<Text>` whose children are the tokens from
 * `tokenize`, which tile the source exactly: paragraph breaks are simply the
 * tokens that contain a newline, so nothing is reassembled and nothing can go
 * missing between the database and the page.
 *
 * What a tap opens is `GlossSheet`, which answers it in two tiers (spec §6) and
 * is shared with the book view — the two reading surfaces have to gloss a word
 * the same way, so the sheet is a component and this screen is only the wiring.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GlossSheet } from '@/components/GlossSheet';
import { ScriptText } from '@/components/ScriptText';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { describeFinishError, sentenceAt, tokenize } from '@/lib/reader';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';

export default function StoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  /**
   * Words already filed from this story, so re-tapping one shows "Requested ✓"
   * rather than offering to file it a second time. Lowercased, because the deck
   * lookup is case-insensitive and so is the question being asked.
   */
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());

  // The same `['stories']` list the library screen uses — so arriving from it
  // costs no round trip, and a story opened by URL simply loads the list.
  const stories = useQuery({ queryKey: ['stories'], queryFn: () => api.listStories() });
  const story = (stories.data ?? []).find((row) => row.id === id);

  const tokens = useMemo(() => tokenize(story?.body_cyr ?? ''), [story?.body_cyr]);
  const selected =
    selectedIndex !== null && tokens[selectedIndex]
      ? { word: tokens[selectedIndex].text, sentence: sentenceAt(tokens, selectedIndex) }
      : null;

  const finish = useMutation({
    mutationFn: async () => {
      const finished = await api.finishStory(id);
      // The story is saved by this point, so the XP is a garnish: a failed
      // award costs its twenty points and must not turn a finished story into
      // an error message. Awaited so the invalidation below cannot race it.
      await api.awardXp('story').catch(() => undefined);
      return finished;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stories'] }),
        // The Reading ladder counts finished stories, so the dashboard's stage
        // and goal move the moment this lands.
        queryClient.invalidateQueries({ queryKey: ['progress'] }),
        queryClient.invalidateQueries({ queryKey: ['xp'] }),
      ]);
      if (router.canGoBack()) router.back();
      else router.replace('/reader');
    },
  });

  if (!story) {
    return (
      <View style={styles.centred}>
        {stories.isPending || stories.isFetching ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Text style={styles.muted} testID="story-missing">
              {stories.isError
                ? errorMessage(stories.error, 'Could not load your stories.')
                : 'That story is not in your library.'}
            </Text>
            <Pressable style={styles.textButton} onPress={() => void stories.refetch()}>
              <Text style={styles.textButtonLabel}>Try again</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const finished = story.finished_at !== null;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: story.title_cyr }} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <ScriptText role="cyr" style={styles.title} testID="story-title">
            {story.title_cyr}
          </ScriptText>
          <Text style={styles.meta} testID="story-meta">
            Level {story.level} · {story.word_count} words
            {finished ? ' · Read' : ''}
          </Text>

          {/* The whole body is one Cyrillic run, so the role goes on the wrapper
              and every token inherits it; only a selected word overrides. */}
          <ScriptText role="cyr" style={styles.body} testID="story-body">
            {tokens.map((token, index) =>
              token.tappable ? (
                <Text
                  key={index}
                  style={selectedIndex === index ? styles.wordSelected : null}
                  onPress={() => setSelectedIndex(index)}
                  accessibilityRole="button"
                  testID={`word-${index}`}
                >
                  {token.text}
                </Text>
              ) : (
                <Text key={index}>{token.text}</Text>
              ),
            )}
          </ScriptText>

          {finished ? (
            <Text style={styles.muted} testID="story-read-only">
              You have finished this one. Read it as many times as you like.
            </Text>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                finish.isPending && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}
              disabled={finish.isPending}
              onPress={() => finish.mutate()}
              accessibilityRole="button"
              accessibilityLabel="I have finished this story"
              testID="story-finish"
            >
              <Text style={styles.primaryButtonLabel}>
                {finish.isPending ? 'Saving…' : 'I have finished this'}
              </Text>
            </Pressable>
          )}

          {finish.isError ? (
            <Text style={styles.error} testID="story-finish-error">
              {describeFinishError(finish.error)}
            </Text>
          ) : null}

          {/* Room for the sheet, so the last line is never hidden behind it. */}
          {selected ? <View style={styles.sheetSpacer} /> : null}
        </View>
      </ScrollView>

      {selected ? (
        <GlossSheet
          // Remounting per word is what resets the sheet's own request state;
          // words already filed are remembered by `requested` above.
          key={selectedIndex}
          word={selected.word}
          sentence={selected.sentence}
          requested={requested.has(selected.word.toLowerCase())}
          onRequested={(word) =>
            setRequested((previous) => new Set(previous).add(word.toLowerCase()))
          }
          onClose={() => setSelectedIndex(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1, padding: spacing.md },
  content: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    gap: spacing.md,
  },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  // Colour and face come from `script`; only size, weight and layout live here.
  title: { fontSize: 28, fontWeight: '700' },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: -spacing.sm },
  /**
   * The reading surface. Deliberately larger and airier than anything else in
   * the app: 24pt on a 42pt line is what makes an unfamiliar script decodable
   * rather than merely legible — a point roomier than it was, because the serif
   * it is now set in sits taller than the sans it replaced.
   */
  body: { fontSize: 24, lineHeight: 42 },
  wordSelected: { color: colors.primary, fontWeight: '700' },
  muted: { fontSize: 14, color: colors.textMuted },
  error: { color: colors.danger, fontSize: 14 },
  primaryButton: {
    minHeight: touchTarget + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
  },
  primaryButtonLabel: { color: colors.primaryOn, fontSize: 18, fontWeight: '700' },
  buttonDisabled: { backgroundColor: colors.disabled },
  /** Room under the text for the sheet, which floats over the bottom edge. */
  sheetSpacer: { height: 220 },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
