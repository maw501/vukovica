/**
 * The capture queue.
 *
 * There is no translator in the app any more (phase 3 removed the runtime AI),
 * and that is deliberate rather than a gap: the useful unit is not an instant
 * gloss but a card that comes back into the review rotation. So this screen
 * takes the question — "what do you want to say in Serbian?" — and files it.
 * Claude answers the queue between sessions: it writes the card, points
 * `card_id` at it, and flips the row to done, at which point the answer appears
 * here beside the question that asked for it.
 *
 * The reading views file into the same queue from the other end, with the tapped
 * word and the sentence it was read in (`readerRequestText`). Both sources land
 * in one list, newest first, because they are one backlog.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

import { MixedText, ScriptText } from '@/components/ScriptText';
import { api, type RequestEntry } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { requestTextError } from '@/lib/requests';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';

export default function RequestsScreen() {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');

  const requests = useQuery({ queryKey: ['requests'], queryFn: () => api.listRequests() });

  const create = useMutation({
    mutationFn: (text_en: string) => api.createRequest({ text_en, source: 'typed' }),
    onSuccess: async () => {
      // Cleared here rather than optimistically: the box emptying is the
      // confirmation that the request was filed, so it must not empty for one
      // that failed.
      setText('');
      // The dashboard's pending count reads the same key.
      await queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });

  const invalid = requestTextError(text) !== null;
  const submit = () => {
    if (invalid || create.isPending) return;
    create.mutate(text);
  };

  const rows = requests.data ?? [];
  const pending = rows.filter((row) => row.status === 'pending');

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={requests.isRefetching}
          onRefresh={() => void requests.refetch()}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.prompt}>What do you want to say in Serbian?</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            // Frozen while the request is in flight: `onSuccess` clears the box,
            // so anything typed mid-request would be wiped the moment it landed.
            editable={!create.isPending}
            multiline
            autoCapitalize="sentences"
            autoCorrect
            placeholder="Could you pass me the salt?"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="What do you want to say in Serbian?"
            testID="request-input"
          />
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              (invalid || create.isPending) && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={invalid || create.isPending}
            onPress={submit}
            accessibilityRole="button"
            accessibilityLabel="Add to the queue"
            testID="request-submit"
          >
            <Text style={styles.primaryButtonLabel}>
              {create.isPending ? 'Filing…' : 'Add to the queue'}
            </Text>
          </Pressable>
          {create.isError ? (
            <Text style={styles.error} testID="request-submit-error">
              {errorMessage(create.error, 'That could not be filed. Try again.')}
            </Text>
          ) : null}
          <Text style={styles.note}>
            Answers arrive as cards between sessions — nothing is translated here and now.
          </Text>
        </View>

        {requests.isPending ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : requests.isError ? (
          <View style={styles.card} testID="requests-error">
            <Text style={styles.error}>
              {errorMessage(requests.error, 'Could not load your requests.')}
            </Text>
            <Pressable
              style={styles.textButton}
              onPress={() => void requests.refetch()}
              accessibilityRole="button"
            >
              <Text style={styles.textButtonLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <Text style={styles.muted} testID="requests-empty">
            Nothing in the queue. Ask for a phrase above, or tap a word you do not know while
            reading.
          </Text>
        ) : (
          <View style={styles.list}>
            <Text style={styles.listHeading} testID="requests-heading">
              {rows.length} request{rows.length === 1 ? '' : 's'} · {pending.length} waiting
            </Text>
            {rows.map((row) => (
              <RequestCard key={row.id} row={row} />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

/**
 * One request: what was asked, and — once it has been answered — the card that
 * answers it. A fulfilled request whose card was later deleted keeps its badge
 * and loses its answer, which is honest: `card_id` is `on delete set null`
 * exactly so the record of having asked survives.
 */
function RequestCard({ row }: { row: RequestEntry }) {
  const done = row.status === 'done';

  return (
    <View style={styles.card} testID={`request-${row.id}`}>
      <View style={styles.rowHeader}>
        {/* Mixed by construction: a request filed from the reader is the quoted
            Cyrillic word and the sentence it was read in (`readerRequestText`),
            wrapped in English. */}
        <MixedText style={styles.requestText} testID="request-text">
          {row.text_en}
        </MixedText>
        <Text
          style={[styles.badge, done ? styles.badgeDone : styles.badgePending]}
          testID={`request-status-${row.status}`}
        >
          {done ? 'Done' : 'Pending'}
        </Text>
      </View>

      {done && row.card ? (
        <View style={styles.answer} testID="request-answer">
          <ScriptText role="cyr" style={styles.answerCyr}>
            {row.card.sr_cyr}
          </ScriptText>
          <ScriptText role="en" style={styles.answerEn}>
            {row.card.en}
          </ScriptText>
        </View>
      ) : null}

      {row.note ? (
        <Text style={styles.note} testID="request-note">
          {row.note}
        </Text>
      ) : null}

      {/* Says where the request came from only when it is not the obvious one:
          everything typed here is 'typed', and saying so on every row would be
          noise. */}
      {row.source === 'reader' ? (
        <Text style={styles.meta} testID="request-source">
          From a word you tapped while reading
        </Text>
      ) : null}
    </View>
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
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  prompt: { fontSize: 18, fontWeight: '600', color: colors.text },
  input: {
    minHeight: touchTarget + 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    textAlignVertical: 'top',
  },
  primaryButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryButtonLabel: { color: colors.primaryOn, fontSize: 17, fontWeight: '700' },
  buttonDisabled: { backgroundColor: colors.disabled },
  list: { gap: spacing.sm },
  listHeading: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase' },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  // Colour and face come from `script`; only size and layout live here.
  requestText: { flexShrink: 1, fontSize: 16 },
  badge: {
    fontSize: 12,
    fontWeight: '700',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  badgePending: { color: colors.primaryOn, backgroundColor: colors.textMuted },
  badgeDone: { color: colors.primaryOn, backgroundColor: colors.primary },
  answer: {
    gap: 2,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  answerCyr: { fontSize: 22, fontWeight: '700' },
  answerEn: { fontSize: 14 },
  meta: { fontSize: 12, color: colors.textMuted },
  note: { fontSize: 12, color: colors.textMuted },
  muted: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14 },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
