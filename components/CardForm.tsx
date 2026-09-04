/**
 * The editable card preview, shared by every route that can put a word in the
 * deck: the deck's own add-a-word flow and editing an existing card.
 *
 * `cardInputErrors` decides whether the save button does anything, so a card
 * cannot reach `public.cards` half-filled whichever route it came in by.
 */

import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScriptText } from '@/components/ScriptText';
import {
  CARD_ASPECTS,
  CARD_DOMAINS,
  CARD_GENDERS,
  CARD_POS,
  cardInputErrors,
  type CardInput,
} from '@/lib/cardInput';
import { errorMessage } from '@/lib/errors';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { cyrToLat } from '@/lib/transliterate';

export function CardForm({
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
  extra,
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
  /**
   * A per-user action the screen wants offered beneath the card's own fields —
   * "I already know this" on the deck's card detail. Deliberately a slot rather
   * than another pair of props: what belongs here is about the *user's* relation
   * to the card, which this form (which edits the shared card itself) has no
   * business knowing anything about.
   */
  extra?: ReactNode;
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
        {/* The label stays chrome; the transliteration itself is a Latin run and
            is styled as one. */}
        {value.sr_cyr ? (
          <Text style={styles.derived}>
            Latin: <ScriptText role="lat">{cyrToLat(value.sr_cyr)}</ScriptText>
          </Text>
        ) : null}

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
          style={({ pressed }) => [
            styles.primaryButton,
            busy && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
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

        <Pressable
          style={styles.textButton}
          onPress={onCancel}
          accessibilityRole="button"
          testID="form-cancel"
        >
          <Text style={styles.textButtonLabel}>{cancelLabel}</Text>
        </Pressable>

        {extra}

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
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
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
  scroll: { flexGrow: 1, padding: spacing.md },
  content: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    gap: spacing.sm,
  },
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
  error: { color: colors.danger, fontSize: 14 },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
