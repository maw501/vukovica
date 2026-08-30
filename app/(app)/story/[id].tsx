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
 * A tap looks the word up in two tiers (spec §6, which stories follow too):
 *   1. the deck already has that exact word → show the card. No `user_cards`
 *      row is written: a card with no row *is* a new card and joins the next
 *      session's allowance on its own (the standing MVP ruling).
 *   2. otherwise → show its transliteration, so he can at least sound it out.
 *      A "Request translation" button files it into the capture queue; that
 *      arrives in a later task, and `UnknownWord` is where it goes.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { describeFinishError, sentenceAt, tokenize } from '@/lib/reader';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { cyrToLat } from '@/lib/transliterate';
import type { CardRow } from '@/lib/types';

/**
 * What the sheet found for the tapped word: the deck's card, or nothing — in
 * which case the sheet falls back to the transliteration.
 */
type Lookup = { kind: 'card'; card: CardRow } | { kind: 'unknown' };

export default function StoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // The same `['stories']` list the library screen uses — so arriving from it
  // costs no round trip, and a story opened by URL simply loads the list.
  const stories = useQuery({ queryKey: ['stories'], queryFn: () => api.listStories() });
  const story = (stories.data ?? []).find((row) => row.id === id);

  const tokens = useMemo(() => tokenize(story?.body_cyr ?? ''), [story?.body_cyr]);
  const selected =
    selectedIndex !== null && tokens[selectedIndex]
      ? { word: tokens[selectedIndex].text, sentence: sentenceAt(tokens, selectedIndex) }
      : null;

  /**
   * The deck lookup, cached per word so tapping back and forth between two
   * words does not re-query either of them. Keyed on the word alone (not the
   * sentence): the deck knows nothing about context, and keying on both would
   * re-fetch the same card for every sentence it appears in.
   */
  const lookup = useQuery({
    queryKey: ['word-lookup', selected?.word.toLowerCase()],
    enabled: selected !== null,
    staleTime: Infinity,
    queryFn: async (): Promise<Lookup> => {
      // Non-null: the query only runs with a selection (`enabled` above).
      const card = await api.findCardByWord(selected!.word);
      return card ? { kind: 'card', card } : { kind: 'unknown' };
    },
  });

  const finish = useMutation({
    mutationFn: () => api.finishStory(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stories'] }),
        // The Reading ladder counts finished stories, so the dashboard's stage
        // and goal move the moment this lands.
        queryClient.invalidateQueries({ queryKey: ['progress'] }),
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
          <Text style={styles.title} testID="story-title">
            {story.title_cyr}
          </Text>
          <Text style={styles.meta} testID="story-meta">
            Level {story.level} · {story.word_count} words
            {finished ? ' · Read' : ''}
          </Text>

          <Text style={styles.body} testID="story-body">
            {tokens.map((token, index) =>
              token.tappable ? (
                <Text
                  key={index}
                  style={[styles.word, selectedIndex === index && styles.wordSelected]}
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
          </Text>

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
        <WordSheet
          word={selected.word}
          sentence={selected.sentence}
          state={lookup}
          onClose={() => setSelectedIndex(null)}
        />
      ) : null}
    </View>
  );
}

/**
 * The panel that answers a tap. It sits over the text rather than replacing it:
 * the sentence the word came from is the context that makes the answer make
 * sense, so it must stay on screen.
 */
function WordSheet({
  word,
  sentence,
  state,
  onClose,
}: {
  word: string;
  /** The sentence the word was read in — the context a request is filed with. */
  sentence: string;
  state: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: Lookup | undefined;
    refetch: () => unknown;
  };
  onClose: () => void;
}) {
  // Pulled out of the JSX so the union narrows: `state.data.kind` inside a
  // ternary chain re-widens on every branch.
  const found = state.data;

  return (
    <View style={styles.sheet} testID="word-sheet">
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetWord} testID="sheet-word">
          {word}
        </Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.close}
          testID="sheet-close"
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      {state.isPending ? (
        <ActivityIndicator color={colors.primary} testID="sheet-loading" />
      ) : state.isError ? (
        <View style={styles.sheetBody}>
          <Text style={styles.error} testID="sheet-error">
            {errorMessage(state.error, 'Could not look that word up.')}
          </Text>
          <Pressable
            style={styles.textButton}
            onPress={() => void state.refetch()}
            accessibilityRole="button"
            testID="sheet-retry"
          >
            <Text style={styles.textButtonLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : found?.kind === 'card' ? (
        <View style={styles.sheetBody} testID="sheet-card">
          <Text style={styles.wordEn}>{found.card.en}</Text>
          <Text style={styles.wordExample}>{found.card.example_cyr}</Text>
          <Text style={styles.wordExampleEn}>{found.card.example_en}</Text>
          {/* Nothing to add: the word is already a card, and it reaches the
              queue on its own as a new card. Pre-inserting a `user_cards` row
              here would make it due-but-unstudied and count against nothing. */}
          <Text style={styles.muted} testID="sheet-in-deck">
            Already in your deck
          </Text>
        </View>
      ) : found?.kind === 'unknown' ? (
        <UnknownWord word={word} sentence={sentence} />
      ) : null}
    </View>
  );
}

/**
 * A tapped word the deck does not have.
 *
 * All it can honestly offer today is the transliteration — derived, never
 * guessed — so he can sound the word out and read on. The translation itself
 * has to come from somewhere, and that somewhere is the capture queue: a
 * "Request translation" button belongs in `actions` below, filing the word and
 * `sentence` as a `requests` row. Both are already in hand here so that adding
 * it is one component, not a rewrite of the sheet.
 */
function UnknownWord({ word, sentence }: { word: string; sentence: string }) {
  return (
    <View style={styles.sheetBody} testID="sheet-unknown">
      <Text style={styles.wordLatin} testID="sheet-transliteration">
        {cyrToLat(word)}
      </Text>
      <Text style={styles.muted}>
        This word is not in your deck, so there is no translation for it yet — this is how it
        sounds.
      </Text>
      <Text style={styles.wordSentence} testID="sheet-sentence">
        {sentence}
      </Text>
      {/* Actions on this word go here — "Request translation" first. */}
      <View style={styles.sheetActions} />
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
  title: { fontSize: 28, fontWeight: '700', color: colors.primary },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: -spacing.sm },
  /**
   * The reading surface. Deliberately larger and airier than anything else in
   * the app: 24pt with a 40pt line height is what makes an unfamiliar script
   * decodable rather than merely legible.
   */
  body: { fontSize: 24, lineHeight: 40, color: colors.text },
  word: { color: colors.text },
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
  sheetSpacer: { height: 220 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sheetWord: { fontSize: 26, fontWeight: '700', color: colors.primary, flexShrink: 1 },
  sheetBody: { gap: spacing.xs },
  close: {
    minHeight: touchTarget - 12,
    minWidth: touchTarget - 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 20, color: colors.textMuted },
  wordEn: { fontSize: 18, color: colors.text },
  wordExample: { fontSize: 16, color: colors.text },
  wordExampleEn: { fontSize: 14, color: colors.textMuted },
  wordLatin: { fontSize: 24, fontWeight: '600', color: colors.primary },
  wordSentence: { fontSize: 14, color: colors.textMuted, fontStyle: 'italic' },
  sheetActions: { gap: spacing.sm },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
