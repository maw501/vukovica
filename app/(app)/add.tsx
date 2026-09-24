/**
 * Add a word — two boxes, and it is a word he knows.
 *
 * The Deck's own add flow asks for eight things and Mark said outright he would
 * never use it. The occasion it has to fit is his wife saying a word at the
 * kitchen table: he wants to write it down, say that he knows it, and add the
 * next one. So this screen asks for the Serbian and what it means, sends both to
 * `quick_add_word` (which inserts the card *and* marks it known in one
 * transaction), and stays open with the boxes cleared and the cursor back in the
 * first one.
 *
 * The other half of the screen is the deck he already has. Typing shows up to
 * five cards that match either box, because 724 words is more than anyone
 * remembers owning: "trainers" turns out to have been in there as патике all
 * along, and one tap puts it in My words rather than making a second card for
 * the same word.
 *
 * The third case is not knowing the Serbian at all. Leave that box empty, type
 * the English, and the button becomes "Ask for the Serbian": the English is
 * filed in the capture queue (`api.createRequest`, the Requests screen's own
 * call) and answered between sessions. That used to be a home tile of its own;
 * it is the same moment at the kitchen table, so it is the same screen. The
 * deck matches still come first — shown above the button in that case — so a
 * word the deck already has is ticked rather than asked for.
 *
 * The long form is not gone — some words do want an example sentence — it is a
 * quiet link at the bottom.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MixedText, ScriptText } from '@/components/ScriptText';
import { api } from '@/lib/api';
import { toCyrillicHeadword } from '@/lib/cardInput';
import { errorMessage } from '@/lib/errors';
import { isKnown } from '@/lib/library';
import {
  canQuickAdd,
  quickAddConfirmation,
  quickAddErrorMessage,
  quickAddErrors,
  quickAddAction,
  quickAddMatches,
  requestConfirmation,
} from '@/lib/quickAdd';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { cyrToLat } from '@/lib/transliterate';
import type { CardRow } from '@/lib/types';

export default function AddScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [sr, setSr] = useState('');
  const [en, setEn] = useState('');
  /** Errors are for after a failed attempt, not for every keystroke of the first. */
  const [showErrors, setShowErrors] = useState(false);
  /** The one line under the boxes after a word lands or a request is filed. */
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const srInput = useRef<TextInput>(null);

  // The whole deck, the same query the Deck screen fills — so arriving here from
  // it costs no round trip — and the studied rows, for the "In my words" chip.
  const cards = useQuery({ queryKey: ['cards'], queryFn: () => api.listCards() });
  const library = useQuery({ queryKey: ['library'], queryFn: () => api.getLibrary() });

  const knownIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of library.data ?? []) {
      if (isKnown(entry.userCard)) ids.add(entry.card.id);
    }
    return ids;
  }, [library.data]);

  const matches = useMemo(
    () => quickAddMatches(cards.data ?? [], sr, en),
    [cards.data, en, sr],
  );

  const errors = quickAddErrors(sr, en);
  const action = quickAddAction(sr, en);
  const headword = toCyrillicHeadword(sr);
  /** Only worth showing when it is telling him something he did not type. */
  const converted = headword !== '' && headword !== sr.trim() ? headword : null;

  /**
   * Every count that moves when a word becomes known — and `['cards']`, because
   * the deck may have just grown by one.
   */
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['cards'] });
    void queryClient.invalidateQueries({ queryKey: ['library'] });
    void queryClient.invalidateQueries({ queryKey: ['progress'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
    // The reader's gloss sheet caches its per-word lookup forever, so a word
    // added here would otherwise keep glossing as "not in your deck".
    void queryClient.invalidateQueries({ queryKey: ['word-lookup'] });
  }, [queryClient]);

  /** Cleared, confirmed, and ready for the next word without a tap. */
  const startAgain = useCallback(() => {
    setSr('');
    setEn('');
    setShowErrors(false);
    srInput.current?.focus();
  }, []);

  const add = useMutation({
    // What was sent travels with the request rather than being read back out of
    // the boxes when it returns: the boxes are cleared on success, and typing
    // the next word during a slow round trip would otherwise confirm that one.
    mutationFn: async () => ({
      result: await api.quickAddWord(sr, en),
      sent: quickAddConfirmation(headword, en.trim()),
    }),
    onSuccess: ({ result, sent }) => {
      // `created` is the function's own answer, not a lookup in `cards.data` —
      // that query may still be in flight, and a wrong guess here would say
      // "Added" for a word that had been in the deck all along, which is the one
      // discovery this screen exists to make.
      //
      // The deck's own wording is preferred when it is to hand, because the
      // English on an existing card is the deck's, not what was just typed.
      const existing = result.created
        ? undefined
        : (cards.data ?? []).find((card) => card.id === result.card_id);
      const word = existing ? quickAddConfirmation(existing.sr_cyr, existing.en) : sent;
      setConfirmed(
        result.created
          ? `Added to My words: ${word}`
          : `Already in the deck, now in My words: ${word}`,
      );
      markKnown.reset();
      ask.reset();
      refresh();
      startAgain();
    },
    // The raw text — which names the function and its arguments — is worth
    // having when something goes wrong, and worth having nowhere near the
    // screen. `quickAddErrorMessage` is what Mark reads.
    onError: (error) => console.warn('quick_add_word failed:', errorMessage(error, 'no message')),
  });

  const markKnown = useMutation({
    mutationFn: (match: { card: CardRow; known: boolean }) => api.markKnown(match.card.id),
    onSuccess: (_row, { card, known }) => {
      const word = quickAddConfirmation(card.sr_cyr, card.en);
      // A row wearing the "In my words" chip was there before the tap, so it
      // gets the same sentence a word the deck already had gets.
      setConfirmed(
        known ? `Already in the deck, now in My words: ${word}` : `Added to My words: ${word}`,
      );
      add.reset();
      ask.reset();
      refresh();
      startAgain();
    },
    onError: (error) => console.warn('mark_known failed:', errorMessage(error, 'no message')),
  });

  /**
   * No Serbian, just the English: file it as a request. What was asked travels
   * with the call for the reason `add`'s does — the box is cleared on success.
   */
  const ask = useMutation({
    mutationFn: async () => {
      const text = en.trim();
      await api.createRequest({ text_en: text, source: 'typed' });
      return text;
    },
    onSuccess: (text) => {
      setConfirmed(requestConfirmation(text));
      add.reset();
      markKnown.reset();
      // My words' "Asked for" list and the Requests screen both read this key.
      void queryClient.invalidateQueries({ queryKey: ['requests'] });
      startAgain();
    },
    onError: (error) => console.warn('create request failed:', errorMessage(error, 'no message')),
  });

  const submit = () => {
    // The button is disabled while a write is in flight; Enter in the English
    // box is not, and two quick presses on a slow connection would be two round
    // trips and two confirmations.
    if (busy) return;
    if (action === 'request') {
      setConfirmed(null);
      ask.mutate();
      return;
    }
    if (!canQuickAdd(sr, en)) {
      setShowErrors(true);
      return;
    }
    setConfirmed(null);
    add.mutate();
  };

  const busy = add.isPending || markKnown.isPending || ask.isPending;
  const failure = add.error ?? markKnown.error;

  /**
   * The deck's matches. Below the button while adding, where they are a
   * suggestion; above it while asking, because a word the deck already has
   * should be found before it is asked for.
   */
  const matchList = cards.isPending ? (
    <ActivityIndicator color={colors.primary} style={styles.loading} />
  ) : matches.length > 0 ? (
    <View style={styles.matches} testID="add-matches">
      <Text style={styles.matchesLabel}>
        {action === 'request' ? 'Already in the deck — tap one you know' : 'Already in the deck'}
      </Text>
      {matches.map((card) => (
        <MatchRow
          key={card.id}
          card={card}
          known={knownIds.has(card.id)}
          busy={busy}
          onPress={() => {
            setConfirmed(null);
            markKnown.mutate({ card, known: knownIds.has(card.id) });
          }}
        />
      ))}
    </View>
  ) : null;

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.content}>
        <Text style={styles.title}>Add a word</Text>
        <Text style={styles.hint}>
          Don’t know the Serbian? Leave it empty, type the English, and ask for it.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Serbian</Text>
          <TextInput
            ref={srInput}
            style={styles.input}
            value={sr}
            onChangeText={setSr}
            placeholder="Type in Cyrillic or Latin letters"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            testID="add-sr"
          />
          {/* Only when he typed Latin: showing "→ кашика" under "кашика" would
              be the app reading its own writing back to him. */}
          {converted ? (
            <MixedText style={styles.converted} testID="add-converted">
              {`→ ${converted}`}
            </MixedText>
          ) : null}
          {showErrors && errors.sr ? (
            <Text style={styles.fieldError} testID="add-sr-error">
              {errors.sr}
            </Text>
          ) : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>English</Text>
          <TextInput
            style={styles.input}
            value={en}
            onChangeText={setEn}
            placeholder="What it means"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={submit}
            testID="add-en"
          />
          {showErrors && errors.en ? (
            <Text style={styles.fieldError} testID="add-en-error">
              {errors.en}
            </Text>
          ) : null}
        </View>

        {action === 'request' ? matchList : null}

        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            busy && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
          disabled={busy}
          onPress={submit}
          accessibilityRole="button"
          testID="add-submit"
        >
          <Text style={styles.primaryButtonText}>
            {add.isPending
              ? 'Adding…'
              : ask.isPending
                ? 'Asking…'
                : action === 'request'
                  ? 'Ask for the Serbian'
                  : 'Add to my words'}
          </Text>
        </Pressable>

        {failure ? (
          <Text style={styles.error} testID="add-error">
            {quickAddErrorMessage(failure)}
          </Text>
        ) : ask.isError ? (
          <Text style={styles.error} testID="add-error">
            Couldn’t send that. Try again.
          </Text>
        ) : null}

        {confirmed ? (
          <MixedText style={styles.confirmation} testID="add-confirmation">
            {confirmed}
          </MixedText>
        ) : null}

        {action === 'request' ? null : matchList}

        <Pressable
          style={styles.textButton}
          onPress={() => router.push({ pathname: '/deck', params: { add: '1' } })}
          accessibilityRole="button"
          testID="add-long-form"
        >
          <Text style={styles.textButtonLabel}>Need the long form? Add with examples</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/**
 * One card the deck already has: tap it and it is in My words.
 *
 * The chip says when it is there already, so a tap that changes nothing looks
 * like one before it is made rather than after.
 */
function MatchRow({
  card,
  known,
  busy,
  onPress,
}: {
  card: CardRow;
  known: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.match, pressed && styles.pressed]}
      disabled={busy}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${card.sr_cyr}, ${card.en}${known ? ', in my words' : ''}`}
      testID={`add-match-${card.sr_cyr}`}
    >
      <View style={styles.matchText}>
        <ScriptText role="cyr" style={styles.matchCyr}>
          {card.sr_cyr}
        </ScriptText>
        {/* Two roles on one line, so two runs rather than one string: the
            transliteration is terracotta and the gloss is muted. */}
        <Text style={styles.matchSub}>
          <ScriptText role="lat">{cyrToLat(card.sr_cyr)}</ScriptText>
          {' · '}
          <ScriptText role="en">{card.en}</ScriptText>
        </Text>
      </View>
      {known ? (
        <Text style={styles.chip} testID={`add-match-known-${card.sr_cyr}`}>
          In my words
        </Text>
      ) : (
        <Text style={styles.chevron}>+</Text>
      )}
    </Pressable>
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
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  hint: { fontSize: 14, color: colors.textMuted, marginTop: -spacing.sm },
  field: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 18,
    color: colors.text,
  },
  converted: { fontSize: 15 },
  fieldError: { color: colors.danger, fontSize: 13 },
  primaryButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryButtonText: { color: colors.primaryOn, fontSize: 17, fontWeight: '600' },
  buttonDisabled: { backgroundColor: colors.disabled },
  confirmation: { fontSize: 15, color: colors.text },
  error: { color: colors.danger, fontSize: 14 },
  loading: { marginVertical: spacing.md },
  matches: { gap: spacing.sm },
  matchesLabel: { fontSize: 13, color: colors.textMuted },
  match: {
    minHeight: touchTarget,
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
  matchText: { flexShrink: 1, gap: 2 },
  // Colour and face come from `script`; only size and weight live here.
  matchCyr: { fontSize: 20, fontWeight: '600' },
  matchSub: { fontSize: 13, color: colors.textMuted },
  chip: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  chevron: { fontSize: 24, color: colors.primary },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
