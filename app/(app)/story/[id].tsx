/**
 * The reading view: one story, big Cyrillic, every word tappable.
 *
 * **No Latin anywhere on this screen** (spec §3.3). Decoding Cyrillic is the
 * whole exercise, so `settings.show_latin` deliberately does not reach here —
 * the transliteration a learner can lean on everywhere else is exactly what
 * would stop him reading.
 *
 * The body is rendered as a single `<Text>` whose children are the tokens from
 * `tokenize`, which tile the source exactly: paragraph breaks are simply the
 * tokens that contain a newline, so nothing is reassembled and nothing can go
 * missing between the database and the page.
 *
 * A tap looks the word up in three tiers (spec §3.3):
 *   1. the deck already has that exact word → show the card. No `user_cards`
 *      row is written: a card with no row *is* a new card and joins the next
 *      session's allowance on its own (the standing MVP ruling).
 *   2. otherwise → ask the `gloss` endpoint, and offer "у шпил", which runs the
 *      same draft-then-check flow as every other way into the deck.
 *   3. it failed → say which kind of failure it was, honestly.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CardForm } from '@/components/CardForm';
import { api } from '@/lib/api';
import { EMPTY_CARD_INPUT, type CardInput } from '@/lib/cardInput';
import { describeEdgeError } from '@/lib/edge';
import { errorMessage } from '@/lib/errors';
import {
  describeFinishError,
  describeGlossError,
  sentenceAt,
  tokenize,
  type Gloss,
} from '@/lib/reader';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import type { CardRow } from '@/lib/types';

/** What the sheet found for the tapped word. */
type Lookup = { kind: 'card'; card: CardRow } | { kind: 'gloss'; gloss: Gloss };

/** The word being taken into the deck, with the sentence it was read in. */
interface AddTarget {
  sr_cyr: string;
  en: string;
  sentence: string;
}

export default function StoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState<AddTarget | null>(null);

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
   * Card first, gloss second — and cached per word, so tapping back and forth
   * between two words does not pay for the same gloss twice. `retry: false`
   * because a 502 here is a stale key or a model that answered badly: three
   * silent retries would turn "AI unavailable" into a ten-second wait.
   */
  const lookup = useQuery({
    queryKey: ['gloss', selected?.word.toLowerCase(), selected?.sentence],
    enabled: selected !== null,
    retry: false,
    staleTime: Infinity,
    queryFn: async (): Promise<Lookup> => {
      // Non-null: the query only runs with a selection (`enabled` above).
      const { word, sentence } = selected!;
      const card = await api.findCardByWord(word);
      if (card) return { kind: 'card', card };
      return { kind: 'gloss', gloss: await api.glossWord(word, sentence) };
    },
  });

  const finish = useMutation({
    mutationFn: () => api.finishStory(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stories'] }),
        // The Читање ladder counts finished stories, so the dashboard's stage
        // and goal move the moment this lands.
        queryClient.invalidateQueries({ queryKey: ['progress'] }),
      ]);
      if (router.canGoBack()) router.back();
      else router.replace('/reader');
    },
  });

  if (adding) {
    return (
      <AddWord
        target={adding}
        onDone={() => setAdding(null)}
        onSaved={() => {
          // A new card changes both dashboard counts and the next session.
          void queryClient.invalidateQueries({ queryKey: ['cards'] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          void queryClient.invalidateQueries({ queryKey: ['progress'] });
          void queryClient.invalidateQueries({ queryKey: ['queue'] });
          // The word is now a card, so the next tap on it takes the card path.
          void queryClient.invalidateQueries({ queryKey: ['gloss'] });
          setAdding(null);
          setSelectedIndex(null);
        }}
      />
    );
  }

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
            НИВО {story.level} · {story.word_count} words
            {finished ? ' · Прочитано' : ''}
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
              <Text style={styles.primaryButtonCyr}>
                {finish.isPending ? 'Чувам…' : 'Завршио сам'}
              </Text>
              <Text style={styles.primaryButtonEn}>
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
          word={selected.word}
          state={lookup}
          onClose={() => setSelectedIndex(null)}
          onAdd={(gloss) =>
            setAdding({ sr_cyr: gloss.base_form_cyr, en: gloss.en, sentence: selected.sentence })
          }
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
function GlossSheet({
  word,
  state,
  onClose,
  onAdd,
}: {
  word: string;
  state: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: Lookup | undefined;
    refetch: () => unknown;
  };
  onClose: () => void;
  onAdd: (gloss: Gloss) => void;
}) {
  // Pulled out of the JSX so the union narrows: `state.data.kind` inside a
  // ternary chain re-widens on every branch.
  const found = state.data;

  return (
    <View style={styles.sheet} testID="gloss-sheet">
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetWord} testID="gloss-word">
          {word}
        </Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.close}
          testID="gloss-close"
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      {state.isPending ? (
        <ActivityIndicator color={colors.primary} testID="gloss-loading" />
      ) : state.isError ? (
        <View style={styles.sheetBody}>
          <Text style={styles.error} testID="gloss-error">
            {describeGlossError(state.error)}
          </Text>
          <Pressable
            style={styles.textButton}
            onPress={() => void state.refetch()}
            accessibilityRole="button"
            testID="gloss-retry"
          >
            <Text style={styles.textButtonLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : found?.kind === 'card' ? (
        <View style={styles.sheetBody} testID="gloss-card">
          <Text style={styles.glossEn}>{found.card.en}</Text>
          <Text style={styles.glossExample}>{found.card.example_cyr}</Text>
          <Text style={styles.glossExampleEn}>{found.card.example_en}</Text>
          {/* No "у шпил": the word is already a card, and it reaches the queue
              on its own as a new card. Pre-inserting a `user_cards` row here
              would make it due-but-unstudied and count against nothing. */}
          <Text style={styles.muted} testID="gloss-in-deck">
            Већ у шпилу · already in your deck
          </Text>
        </View>
      ) : found?.kind === 'gloss' ? (
        <View style={styles.sheetBody} testID="gloss-generated">
          {found.gloss.base_form_cyr.toLowerCase() === word.toLowerCase() ? null : (
            <Text style={styles.glossBase} testID="gloss-base">
              {found.gloss.base_form_cyr}
            </Text>
          )}
          <Text style={styles.glossEn}>{found.gloss.en}</Text>
          {found.gloss.note ? <Text style={styles.glossNote}>{found.gloss.note}</Text> : null}
          <Pressable
            style={({ pressed }) => [styles.addChip, pressed && styles.pressed]}
            onPress={() => onAdd(found.gloss)}
            accessibilityRole="button"
            accessibilityLabel="Add to the deck"
            testID="gloss-add"
          >
            <Text style={styles.addChipText}>＋ у шпил</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * "у шпил": draft the card with the model, check it, save it — the same flow as
 * the deck's add-a-word and the tutor's chips, so a card entering the deck from
 * the reader is identical to one entering it anywhere else.
 *
 * The manual fallback is not a consolation prize: it is seeded with the base
 * form, the English the gloss gave, and the sentence the word was read in,
 * which is a better example than the model usually writes.
 */
function AddWord({
  target,
  onDone,
  onSaved,
}: {
  target: AddTarget;
  onDone: () => void;
  onSaved: () => void;
}) {
  const [card, setCard] = useState<CardInput | null>(null);

  const generate = useMutation({
    mutationFn: () => api.generateCard(target.sr_cyr),
    onSuccess: (drafted) => setCard({ ...drafted, en: drafted.en || target.en }),
  });

  const save = useMutation({
    mutationFn: (input: CardInput) => api.addCard(input),
    onSuccess: onSaved,
  });

  if (card) {
    return (
      <CardForm
        title="Check the card"
        value={card}
        onChange={setCard}
        onCancel={onDone}
        cancelLabel="Back to the story"
        onSubmit={(input) => save.mutate(input)}
        submitLabel="Add to the deck"
        busy={save.isPending}
        error={save.error}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.content}>
        <Text style={styles.title}>{target.sr_cyr}</Text>
        <Text style={styles.muted}>{target.en}</Text>

        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            generate.isPending && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
          disabled={generate.isPending}
          onPress={() => generate.mutate()}
          accessibilityRole="button"
          testID="story-add-generate"
        >
          <Text style={styles.primaryButtonCyr}>
            {generate.isPending ? 'Пише…' : 'Draft the card'}
          </Text>
        </Pressable>

        {generate.isError ? (
          <View style={styles.errorCard} testID="story-add-error">
            {/* Not `describeGlossError`: this is the card-drafting endpoint, and
                its 502 has only ever one meaning — the AI is unreachable. */}
            <Text style={styles.error}>{describeEdgeError(generate.error)}</Text>
            <Pressable
              style={styles.textButton}
              onPress={() =>
                setCard({
                  ...EMPTY_CARD_INPUT,
                  sr_cyr: target.sr_cyr,
                  en: target.en,
                  example_cyr: target.sentence,
                })
              }
              accessibilityRole="button"
              testID="story-add-manual"
            >
              <Text style={styles.textButtonLabel}>Fill the card in by hand</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable style={styles.textButton} onPress={onDone} accessibilityRole="button">
          <Text style={styles.textButtonLabel}>Back to the story</Text>
        </Pressable>
      </View>
    </ScrollView>
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
  errorCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
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
  glossBase: { fontSize: 20, fontWeight: '600', color: colors.text },
  glossEn: { fontSize: 18, color: colors.text },
  glossNote: { fontSize: 14, color: colors.textMuted },
  glossExample: { fontSize: 16, color: colors.text },
  glossExampleEn: { fontSize: 14, color: colors.textMuted },
  addChip: {
    minHeight: touchTarget - 8,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  addChipText: { color: colors.primaryOn, fontSize: 16, fontWeight: '600' },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
