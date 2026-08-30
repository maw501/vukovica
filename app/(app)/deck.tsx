/**
 * The deck: browse and search every card, edit or delete one, and add a new
 * word by hand.
 *
 * One screen with three views rather than three routes — the list's scroll
 * position and search text survive a trip into a card and back, which is what
 * makes tidying up a run of cards bearable.
 *
 * A card added here gets **no** `user_cards` row: a card with no row is by
 * definition a new card, so it joins the next session's new-card allowance on
 * its own. Creating a row here would make it due-but-unstudied and count
 * against nothing.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CardForm } from '@/components/CardForm';
import { api } from '@/lib/api';
import { EMPTY_CARD_INPUT, toCyrillicHeadword, type CardInput } from '@/lib/cardInput';
import { confirmAction } from '@/lib/confirm';
import { errorMessage } from '@/lib/errors';
import { filterCards } from '@/lib/search';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { cyrToLat } from '@/lib/transliterate';
import type { CardRow } from '@/lib/types';

/** Which of the screen's three views is showing. */
type DeckView = { kind: 'list' } | { kind: 'detail'; cardId: string } | { kind: 'add' };

/** The order `api.listCards` returns, so an optimistic insert lands in place. */
function sortDeck(cards: CardRow[]): CardRow[] {
  return [...cards].sort((a, b) => a.sr_cyr.localeCompare(b.sr_cyr, 'sr'));
}

/** The editable fields of an existing row, in the shape the form works with. */
function toInput(card: CardRow): CardInput {
  return {
    sr_cyr: card.sr_cyr,
    en: card.en,
    pos: card.pos,
    gender: card.gender,
    aspect: card.aspect,
    example_cyr: card.example_cyr,
    example_en: card.example_en,
    domain: card.domain,
  };
}

export default function DeckScreen() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<DeckView>({ kind: 'list' });
  const [query, setQuery] = useState('');

  const cards = useQuery({ queryKey: ['cards'], queryFn: () => api.listCards() });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() });
  const showLatin = settings.data?.show_latin ?? true;

  const results = useMemo(() => filterCards(cards.data ?? [], query), [cards.data, query]);

  /** Both counts on the dashboard move when the deck changes size. */
  const refreshDeck = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['cards'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    // A deleted card can take a known word with it, which moves the Words goal.
    void queryClient.invalidateQueries({ queryKey: ['progress'] });
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
  }, [queryClient]);

  if (view.kind === 'add') {
    return (
      <AddCard
        onCancel={() => setView({ kind: 'list' })}
        onSaved={(card) => {
          // Slot the new card into the cached list *before* navigating to it:
          // the detail view looks the card up by id in that list, and the
          // refetch triggered by `refreshDeck` has not landed yet.
          queryClient.setQueryData<CardRow[]>(['cards'], (previous) =>
            previous ? sortDeck([...previous, card]) : previous,
          );
          refreshDeck();
          setView({ kind: 'detail', cardId: card.id });
        }}
      />
    );
  }

  if (view.kind === 'detail') {
    const card = (cards.data ?? []).find((row) => row.id === view.cardId);
    if (!card) {
      // The card was deleted from under us (or the list has not reloaded yet).
      return (
        <View style={styles.centred}>
          <Text style={styles.muted}>That card is no longer in the deck.</Text>
          <Pressable style={styles.textButton} onPress={() => setView({ kind: 'list' })}>
            <Text style={styles.textButtonLabel}>Back to the deck</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <CardDetail
        card={card}
        onClose={() => setView({ kind: 'list' })}
        onChanged={refreshDeck}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.listHeader}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search Cyrillic, Latin or English"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          testID="deck-search"
        />
        <Pressable
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          onPress={() => setView({ kind: 'add' })}
          accessibilityRole="button"
          accessibilityLabel="Add a word"
          testID="deck-add"
        >
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>

      {cards.isPending ? (
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      ) : cards.isError ? (
        <View style={styles.centred}>
          <Text style={styles.error} testID="deck-error">
            {errorMessage(cards.error, 'Could not load the deck.')}
          </Text>
          <Pressable style={styles.textButton} onPress={() => void cards.refetch()}>
            <Text style={styles.textButtonLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(card) => card.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <Text style={styles.count} testID="deck-count">
              {results.length} of {(cards.data ?? []).length} cards
            </Text>
          }
          ListEmptyComponent={
            <Text style={styles.muted} testID="deck-empty">
              No cards match “{query}”.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => setView({ kind: 'detail', cardId: item.id })}
              accessibilityRole="button"
              testID={`deck-row-${item.sr_cyr}`}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowCyr}>{item.sr_cyr}</Text>
                <Text style={styles.rowSub}>
                  {showLatin ? `${cyrToLat(item.sr_cyr)} · ` : ''}
                  {item.en}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Add a word
// ---------------------------------------------------------------------------

/**
 * Adding a word, in two steps: the headword first, then the rest of the card.
 *
 * The first step exists for the transliteration alone — `toCyrillicHeadword`
 * turns "kasika" into "кашика", so a beginner who cannot yet type Cyrillic can
 * still add a word, and `sr_cyr` stays Cyrillic (which the whole app assumes).
 * A word already typed in Cyrillic passes straight through.
 */
function AddCard({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (card: CardRow) => void;
}) {
  const [word, setWord] = useState('');
  const [draft, setDraft] = useState<CardInput | null>(null);

  const save = useMutation({
    mutationFn: (input: CardInput) => api.addCard(input),
    onSuccess: onSaved,
  });

  const start = () => {
    const headword = toCyrillicHeadword(word);
    if (!headword) return;
    setDraft({ ...EMPTY_CARD_INPUT, sr_cyr: headword });
  };

  if (draft) {
    return (
      <CardForm
        title="New card"
        value={draft}
        onChange={setDraft}
        onCancel={() => setDraft(null)}
        cancelLabel="Start over"
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
        <Text style={styles.formTitle}>Add a word</Text>
        <Text style={styles.muted}>
          Type it in either script — Latin is converted to Cyrillic for you. You fill in the rest
          of the card on the next screen.
        </Text>

        <TextInput
          style={styles.input}
          value={word}
          onChangeText={setWord}
          placeholder="кашика or kasika"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={start}
          testID="add-input"
        />
        {word.trim() ? (
          <Text style={styles.muted} testID="add-headword">
            Cyrillic: {toCyrillicHeadword(word)}
          </Text>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            !word.trim() && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
          disabled={!word.trim()}
          onPress={start}
          accessibilityRole="button"
          testID="add-continue"
        >
          <Text style={styles.primaryButtonText}>Fill in the card</Text>
        </Pressable>

        <Pressable style={styles.textButton} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.textButtonLabel}>Cancel</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Edit / delete an existing card
// ---------------------------------------------------------------------------

function CardDetail({
  card,
  onClose,
  onChanged,
}: {
  card: CardRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [value, setValue] = useState<CardInput>(() => toInput(card));

  const save = useMutation({
    mutationFn: (input: CardInput) => api.updateCard(card.id, input),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteCard(card.id),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  const confirmDelete = useCallback(() => {
    void confirmAction({
      title: 'Delete card',
      message: `Delete “${card.sr_cyr}”? Its review history goes with it.`,
      confirmLabel: 'Delete',
      destructive: true,
    }).then((confirmed) => {
      if (confirmed) remove.mutate();
    });
  }, [card.sr_cyr, remove]);

  return (
    <CardForm
      title={card.sr_cyr}
      value={value}
      onChange={setValue}
      onCancel={onClose}
      cancelLabel="Back to the deck"
      onSubmit={(input) => save.mutate(input)}
      submitLabel="Save changes"
      busy={save.isPending || remove.isPending}
      error={save.error ?? remove.error}
      onDelete={confirmDelete}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1, padding: spacing.md },
  content: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    gap: spacing.sm,
  },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  loading: { marginVertical: spacing.xl },
  listHeader: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    paddingBottom: spacing.sm,
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
  },
  search: {
    flex: 1,
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  addButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { color: colors.primaryOn, fontSize: 28, lineHeight: 32 },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
  },
  count: { fontSize: 13, color: colors.textMuted, paddingBottom: spacing.sm },
  row: {
    minHeight: touchTarget + 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowText: { flex: 1, gap: 2 },
  rowCyr: { fontSize: 22, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 13, color: colors.textMuted },
  chevron: { fontSize: 26, color: colors.primary },
  formTitle: { fontSize: 26, fontWeight: '700', color: colors.text },
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
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
  },
  primaryButtonText: { color: colors.primaryOn, fontSize: 17, fontWeight: '600' },
  buttonDisabled: { backgroundColor: colors.disabled },
  error: { color: colors.danger, fontSize: 14 },
  muted: { color: colors.textMuted, fontSize: 14 },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
