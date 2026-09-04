/**
 * "I already know this" — the one-tap way to put a word straight into My words.
 *
 * Mark is a beginner but not at every word, and grading the ones he already has
 * through the queue four at a time is a fortnight of taps to tell the app
 * something he knows. `mark_known` parks the card as known for a season and
 * pays no XP, because declaring a word is not the same as studying one.
 *
 * Shared by the Deck's card detail and the review session, so the wording, the
 * confirmation and the caches invalidated are the same in both. What differs is
 * what happens next, which is the caller's `onMarked`: the deck stays where it
 * is and says so, and the review session drops the card and moves on.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { colors, radius, spacing, touchTarget } from '@/lib/theme';
import type { UserCardRow } from '@/lib/types';

export function MarkKnownButton({
  cardId,
  onMarked,
  testID = 'mark-known',
}: {
  cardId: string;
  /** Called once the row is saved, with the row the function returned. */
  onMarked?: (row: UserCardRow) => void;
  testID?: string;
}) {
  const queryClient = useQueryClient();

  const mark = useMutation({
    mutationFn: () => api.markKnown(cardId),
    onSuccess: (row) => {
      // The word has just moved into (or within) the Known list, out of the due
      // queue for three months, and up the Words ladder — all four of these read
      // the row that just changed.
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      void queryClient.invalidateQueries({ queryKey: ['progress'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
      onMarked?.(row);
    },
  });

  if (mark.isSuccess) {
    // Only ever seen where the caller leaves the button on screen; the review
    // session unmounts it by moving to the next card.
    return (
      <View style={styles.done} testID={`${testID}-done`}>
        <Text style={styles.doneText}>
          Marked as known. It will not come round for a while.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          mark.isPending && styles.buttonBusy,
          pressed && styles.pressed,
        ]}
        disabled={mark.isPending}
        onPress={() => mark.mutate()}
        accessibilityRole="button"
        accessibilityLabel="I already know this word"
        testID={testID}
      >
        <Text style={styles.buttonText}>
          {mark.isPending ? 'Saving…' : 'I already know this'}
        </Text>
      </Pressable>
      {mark.isError ? (
        <Text style={styles.error} testID={`${testID}-error`}>
          {errorMessage(mark.error, 'That could not be saved.')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  button: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  buttonBusy: { borderColor: colors.disabled },
  buttonText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  done: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  doneText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  pressed: { opacity: 0.8 },
});
