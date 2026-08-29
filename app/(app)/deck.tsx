/**
 * The deck: browse and search every card, edit or delete one, and add a new
 * word by asking the model to draft it.
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

import { api } from '@/lib/api';
import {
  CARD_ASPECTS,
  CARD_DOMAINS,
  CARD_GENDERS,
  CARD_POS,
  EMPTY_CARD_INPUT,
  cardInputErrors,
  toCyrillicHeadword,
  type CardInput,
} from '@/lib/cardInput';
import { confirmAction } from '@/lib/confirm';
import { describeEdgeError } from '@/lib/edge';
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

function AddCard({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (card: CardRow) => void;
}) {
  const [word, setWord] = useState('');
  const [draft, setDraft] = useState<CardInput | null>(null);

  const generate = useMutation({
    mutationFn: (input: string) => api.generateCard(input),
    onSuccess: (card) => setDraft(card),
  });

  const save = useMutation({
    mutationFn: (input: CardInput) => api.addCard(input),
    onSuccess: onSaved,
  });

  if (draft) {
    return (
      <CardForm
        title="Check the card"
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
          Type it in either script. The tutor drafts the card and you can edit it before it is
          saved.
        </Text>

        <TextInput
          style={styles.input}
          value={word}
          onChangeText={setWord}
          placeholder="кашика or kasika"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => word.trim() && generate.mutate(word.trim())}
          testID="add-input"
        />

        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            (!word.trim() || generate.isPending) && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
          disabled={!word.trim() || generate.isPending}
          onPress={() => generate.mutate(word.trim())}
          accessibilityRole="button"
          testID="add-generate"
        >
          <Text style={styles.primaryButtonText}>
            {generate.isPending ? 'Drafting…' : 'Draft the card'}
          </Text>
        </Pressable>

        {generate.isError ? (
          <View style={styles.errorCard} testID="add-error">
            <Text style={styles.error}>{describeEdgeError(generate.error)}</Text>
            <Pressable
              style={styles.textButton}
              onPress={() =>
                setDraft({ ...EMPTY_CARD_INPUT, sr_cyr: toCyrillicHeadword(word) })
              }
              accessibilityRole="button"
              testID="add-manual"
            >
              <Text style={styles.textButtonLabel}>Fill the card in by hand</Text>
            </Pressable>
          </View>
        ) : null}

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

// ---------------------------------------------------------------------------
// The shared card form
// ---------------------------------------------------------------------------

function CardForm({
  title,
  value,
  onChange,
  onCancel,
  cancelLabel,
  onSubmit,
  submitLabel,
  busy,
  error,
  onDelete,
}: {
  title: string;
  value: CardInput;
  onChange: (value: CardInput) => void;
  onCancel: () => void;
  cancelLabel: string;
  onSubmit: (value: CardInput) => void;
  submitLabel: string;
  busy: boolean;
  error: unknown;
  onDelete?: () => void;
}) {
  const [showErrors, setShowErrors] = useState(false);
  const errors = cardInputErrors(value);
  const set = <K extends keyof CardInput>(key: K, next: CardInput[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.content}>
        <Text style={styles.formTitle}>{title}</Text>

        <Field
          label="Serbian (Cyrillic)"
          value={value.sr_cyr}
          onChangeText={(text) => set('sr_cyr', text)}
          error={showErrors ? errors.sr_cyr : undefined}
          testID="form-sr_cyr"
        />
        {value.sr_cyr ? <Text style={styles.derived}>Latin: {cyrToLat(value.sr_cyr)}</Text> : null}

        <Field
          label="English"
          value={value.en}
          onChangeText={(text) => set('en', text)}
          error={showErrors ? errors.en : undefined}
          testID="form-en"
        />

        <Chips
          label="Part of speech"
          options={CARD_POS}
          value={value.pos}
          onSelect={(next) => set('pos', next ?? '')}
          error={showErrors ? errors.pos : undefined}
          testIDPrefix="form-pos"
        />
        <Chips
          label="Gender"
          options={CARD_GENDERS}
          value={value.gender}
          onSelect={(next) => set('gender', next)}
          allowNone
          testIDPrefix="form-gender"
        />
        <Chips
          label="Aspect"
          options={CARD_ASPECTS}
          value={value.aspect}
          onSelect={(next) => set('aspect', next)}
          allowNone
          testIDPrefix="form-aspect"
        />

        <Field
          label="Example (Cyrillic)"
          value={value.example_cyr}
          onChangeText={(text) => set('example_cyr', text)}
          error={showErrors ? errors.example_cyr : undefined}
          multiline
          testID="form-example_cyr"
        />
        <Field
          label="Example (English)"
          value={value.example_en}
          onChangeText={(text) => set('example_en', text)}
          error={showErrors ? errors.example_en : undefined}
          multiline
          testID="form-example_en"
        />

        <Chips
          label="Domain"
          options={CARD_DOMAINS}
          value={value.domain}
          onSelect={(next) => set('domain', next ?? '')}
          error={showErrors ? errors.domain : undefined}
          testIDPrefix="form-domain"
        />

        {error ? (
          <Text style={styles.error} testID="form-error">
            {errorMessage(error, 'That could not be saved.')}
          </Text>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.primaryButton, busy && styles.buttonDisabled, pressed && styles.pressed]}
          disabled={busy}
          onPress={() => {
            setShowErrors(true);
            if (Object.keys(cardInputErrors(value)).length === 0) onSubmit(value);
          }}
          accessibilityRole="button"
          testID="form-save"
        >
          <Text style={styles.primaryButtonText}>{busy ? 'Saving…' : submitLabel}</Text>
        </Pressable>

        <Pressable style={styles.textButton} onPress={onCancel} accessibilityRole="button" testID="form-cancel">
          <Text style={styles.textButtonLabel}>{cancelLabel}</Text>
        </Pressable>

        {onDelete ? (
          <Pressable
            style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
            onPress={onDelete}
            disabled={busy}
            accessibilityRole="button"
            testID="form-delete"
          >
            <Text style={styles.deleteButtonText}>Delete this card</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  error,
  multiline,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  multiline?: boolean;
  testID: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline, error && styles.inputError]}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        testID={testID}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

/** A one-of-N picker. Cheaper than a dropdown and far harder to typo into. */
function Chips({
  label,
  options,
  value,
  onSelect,
  allowNone,
  error,
  testIDPrefix,
}: {
  label: string;
  options: readonly string[];
  value: string | null;
  onSelect: (value: string | null) => void;
  allowNone?: boolean;
  error?: string;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {allowNone ? (
          <Chip
            label="—"
            selected={!value}
            onPress={() => onSelect(null)}
            testID={`${testIDPrefix}-none`}
          />
        ) : null}
        {options.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={value === option}
            onPress={() => onSelect(option)}
            testID={`${testIDPrefix}-${option}`}
          />
        ))}
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
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
  field: { gap: spacing.xs },
  fieldLabel: { fontSize: 13, color: colors.textMuted },
  fieldError: { fontSize: 12, color: colors.danger },
  derived: { fontSize: 12, color: colors.textMuted, marginTop: -spacing.xs },
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
  inputMultiline: { minHeight: touchTarget + 20, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    minHeight: touchTarget - 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, color: colors.text },
  chipTextSelected: { color: colors.primaryOn, fontWeight: '600' },
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
  deleteButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginTop: spacing.lg,
  },
  deleteButtonText: { color: colors.danger, fontSize: 16, fontWeight: '600' },
  errorCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  error: { color: colors.danger, fontSize: 14 },
  muted: { color: colors.textMuted, fontSize: 14 },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
