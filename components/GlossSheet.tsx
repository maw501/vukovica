/**
 * The panel that answers a tap on a Cyrillic word.
 *
 * It sits over the text rather than replacing it: the sentence the word came
 * from is the context that makes the answer make sense, so it must stay on
 * screen behind the sheet.
 *
 * A tap is answered in two tiers (spec §6, which every reading view follows):
 *   1. the deck already has that exact word → show the card, with its recorded
 *      clip if it has one. No `user_cards` row is written: a card with no row
 *      *is* a new card and joins the next session's allowance on its own (the
 *      standing MVP ruling).
 *   2. otherwise → show its transliteration, so he can at least sound it out,
 *      and offer "Request translation", which files the word and its sentence
 *      into the capture queue to be answered offline.
 *
 * A component rather than part of the story screen because the book view reads
 * the same way: one word, one sentence, the same two tiers. The caller supplies
 * the word and its context and is told when something was requested; everything
 * else — the lookup, the request, the copy — lives here so that the two views
 * cannot drift apart.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { SpeakButton } from '@/components/SpeakButton';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { readerRequestText } from '@/lib/requests';
import { colors, radius, spacing, touchTarget } from '@/lib/theme';
import { cyrToLat } from '@/lib/transliterate';
import type { CardRow } from '@/lib/types';

/**
 * What the sheet found for the tapped word: the deck's card, or nothing — in
 * which case the sheet falls back to the transliteration.
 */
type Lookup = { kind: 'card'; card: CardRow } | { kind: 'unknown' };

export function GlossSheet({
  word,
  sentence,
  requested = false,
  onRequested,
  onClose,
}: {
  /** The tapped word, exactly as it appears in the text. */
  word: string;
  /** The sentence it was read in — the context a request is filed with. */
  sentence: string;
  /**
   * True when this word has already been requested in this reading session.
   * Optional: without it the sheet still shows "Requested ✓" for as long as it
   * stays open, but a caller that remembers across taps (the story screen does)
   * stops the same word being filed twice in one sitting.
   */
  requested?: boolean;
  /** Called with the word once a request for it has been filed. */
  onRequested?: (word: string) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  /**
   * The deck lookup, cached per word so tapping back and forth between two
   * words does not re-query either of them. Keyed on the word alone (not the
   * sentence): the deck knows nothing about context, and keying on both would
   * re-fetch the same card for every sentence it appears in.
   */
  const lookup = useQuery({
    queryKey: ['word-lookup', word.toLowerCase()],
    staleTime: Infinity,
    queryFn: async (): Promise<Lookup> => {
      const card = await api.findCardByWord(word);
      return card ? { kind: 'card', card } : { kind: 'unknown' };
    },
  });

  // Playback is a user setting, and this is the same card the review screen
  // would show. `['settings']` is shared, so it is normally already warm.
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() });

  const request = useMutation({
    mutationFn: () =>
      api.createRequest({ text_en: readerRequestText(word, sentence), source: 'reader' }),
    onSuccess: async () => {
      onRequested?.(word);
      // The queue screen and the dashboard's pending count read this key.
      await queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });

  // Pulled out of the JSX so the union narrows: `lookup.data.kind` inside a
  // ternary chain re-widens on every branch.
  const found = lookup.data;

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

      {lookup.isPending ? (
        <ActivityIndicator color={colors.primary} testID="sheet-loading" />
      ) : lookup.isError ? (
        <View style={styles.sheetBody}>
          <Text style={styles.error} testID="sheet-error">
            {errorMessage(lookup.error, 'Could not look that word up.')}
          </Text>
          <Pressable
            style={styles.textButton}
            onPress={() => void lookup.refetch()}
            accessibilityRole="button"
            testID="sheet-retry"
          >
            <Text style={styles.textButtonLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : found?.kind === 'card' ? (
        <KnownWord card={found.card} ttsEnabled={settings.data?.tts_enabled ?? true} />
      ) : found?.kind === 'unknown' ? (
        <UnknownWord
          sentence={sentence}
          latin={cyrToLat(word)}
          requested={requested || request.isSuccess}
          busy={request.isPending}
          error={request.isError ? errorMessage(request.error, 'That could not be filed.') : null}
          onRequest={() => request.mutate()}
        />
      ) : null}
    </View>
  );
}

/** A tapped word the deck already has: the card, and how to hear it. */
function KnownWord({ card, ttsEnabled }: { card: CardRow; ttsEnabled: boolean }) {
  return (
    <View style={styles.sheetBody} testID="sheet-card">
      <Text style={styles.wordEn}>{card.en}</Text>
      <Text style={styles.wordExample}>{card.example_cyr}</Text>
      <Text style={styles.wordExampleEn}>{card.example_en}</Text>
      <View style={styles.sheetFooter}>
        {/* Nothing to add to the deck: the word is already a card, and it
            reaches the queue on its own as a new card. Pre-inserting a
            `user_cards` row here would make it due-but-unstudied and count
            against nothing. */}
        <Text style={styles.muted} testID="sheet-in-deck">
          Already in your deck
        </Text>
        <SpeakButton path={card.audio_path} enabled={ttsEnabled} testID="sheet-speak" />
      </View>
    </View>
  );
}

/**
 * A tapped word the deck does not have.
 *
 * The transliteration is all the app can honestly offer on its own — derived,
 * never guessed — so he can sound the word out and read on. The translation
 * itself comes from the capture queue: the button files the word with the
 * sentence it was read in, and Claude answers it as a card between sessions.
 */
function UnknownWord({
  sentence,
  latin,
  requested,
  busy,
  error,
  onRequest,
}: {
  sentence: string;
  latin: string;
  requested: boolean;
  busy: boolean;
  error: string | null;
  onRequest: () => void;
}) {
  return (
    <View style={styles.sheetBody} testID="sheet-unknown">
      <Text style={styles.wordLatin} testID="sheet-transliteration">
        {latin}
      </Text>
      <Text style={styles.muted}>
        This word is not in your deck, so there is no translation for it yet — this is how it
        sounds.
      </Text>
      <Text style={styles.wordSentence} testID="sheet-sentence">
        {sentence}
      </Text>

      <View style={styles.sheetActions}>
        {requested ? (
          // Deliberately still a button rather than a line of text: it is the
          // same control in its finished state, so nothing jumps around, and it
          // cannot be pressed a second time.
          <Pressable
            style={[styles.requestButton, styles.requestDone]}
            disabled
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            testID="sheet-requested"
          >
            <Text style={styles.requestDoneLabel}>Requested ✓</Text>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.requestButton,
              busy && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={busy}
            onPress={onRequest}
            accessibilityRole="button"
            accessibilityLabel="Request translation"
            testID="sheet-request"
          >
            <Text style={styles.requestLabel}>{busy ? 'Filing…' : 'Request translation'}</Text>
          </Pressable>
        )}
        {error ? (
          <Text style={styles.error} testID="sheet-request-error">
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  sheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  close: {
    minHeight: touchTarget - 12,
    minWidth: touchTarget - 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 20, color: colors.textMuted },
  muted: { fontSize: 14, color: colors.textMuted, flexShrink: 1 },
  error: { color: colors.danger, fontSize: 14 },
  wordEn: { fontSize: 18, color: colors.text },
  wordExample: { fontSize: 16, color: colors.text },
  wordExampleEn: { fontSize: 14, color: colors.textMuted },
  wordLatin: { fontSize: 24, fontWeight: '600', color: colors.primary },
  wordSentence: { fontSize: 14, color: colors.textMuted, fontStyle: 'italic' },
  sheetActions: { gap: spacing.sm, marginTop: spacing.xs },
  requestButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
  },
  requestLabel: { color: colors.primaryOn, fontSize: 17, fontWeight: '700' },
  requestDone: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  requestDoneLabel: { color: colors.textMuted, fontSize: 17, fontWeight: '600' },
  buttonDisabled: { backgroundColor: colors.disabled },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
