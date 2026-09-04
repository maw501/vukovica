/**
 * The alphabet, all thirty at once — the reference page, not a test.
 *
 * Mark asked for "a way to browse the alphabet", and this is deliberately the
 * quiet half of the pair: nothing is hidden, nothing is scored, and every row
 * can be tapped to hear his wife say the letter and her word for it. The drill
 * (`app/(app)/letters.tsx`) is where the alphabet is practised; this is where it
 * is looked up.
 *
 * The only thing carried over from the drill is the tick: a letter got right
 * three times running is solid. It is a mark on a row, never a lock — every
 * letter here is always available, in both senses.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MixedText, ScriptText } from '@/components/ScriptText';
import { api } from '@/lib/api';
import { audioSupported, playAudioPath } from '@/lib/audio';
import { errorMessage } from '@/lib/errors';
import {
  hintWithoutExample,
  isSolid,
  letterKey,
  statsByLetter,
  solidCount,
  type LetterStat,
} from '@/lib/letters';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { latinLetterPair } from '@/lib/transliterate';
import type { CardRow } from '@/lib/types';

export default function AlphabetScreen() {
  const cards = useQuery({ queryKey: ['letter-cards'], queryFn: () => api.listLetterCards() });
  const stats = useQuery({ queryKey: ['letter-stats'], queryFn: () => api.listLetterStats() });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() });

  const tallies = useMemo(() => statsByLetter(stats.data ?? []), [stats.data]);
  const letters = cards.data ?? [];
  const solid = solidCount(letters, tallies);

  if (cards.isPending) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (cards.isError) {
    return (
      <View style={styles.centred}>
        <Text style={styles.error} testID="alphabet-error">
          {errorMessage(cards.error, 'Could not load the alphabet.')}
        </Text>
        <Pressable
          style={styles.textButton}
          onPress={() => void cards.refetch()}
          accessibilityRole="button"
        >
          <Text style={styles.textButtonLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        <Text style={styles.intro} testID="alphabet-intro">
          {letters.length} letters, in order. Tap one to hear it.
        </Text>
        {/*
          If the tallies did not load, say so. Rendering "0 of 30 solid" from an
          empty map would be stating as fact the one thing this screen does not
          know — the same honesty the dashboard's letters row keeps.
        */}
        <Text style={styles.solidLine} testID="alphabet-solid">
          {stats.isError
            ? 'Could not count how the letters are going.'
            : // Not "mastered": that word belongs to the trainer's harder bar.
              `${solid} of ${letters.length} solid — got right three times in a row`}
        </Text>

        <View style={styles.list}>
          {letters.map((card) => (
            <LetterRow
              key={card.id}
              card={card}
              // No ticks either while the tallies are unknown: a missing tick
              // would read as "not solid yet" rather than "not counted".
              stat={stats.isError ? undefined : tallies.get(letterKey(card))}
              ttsEnabled={settings.data?.tts_enabled ?? true}
            />
          ))}
        </View>

        <Link href="/letters" style={styles.link} testID="alphabet-drill">
          <Text style={styles.linkText}>Drill the letters</Text>
        </Link>
      </View>
    </ScrollView>
  );
}

/**
 * One letter: the pair, what it sounds like in Latin, her word and its meaning,
 * and the hint underneath.
 *
 * The whole row is the play button rather than containing one. On web a
 * `Pressable` is a real `<button>`, and a button inside a button is invalid HTML
 * as well as an ambiguous tap — so the speaker here is a mark on the row that
 * plays, not a control of its own.
 */
function LetterRow({
  card,
  stat,
  ttsEnabled,
}: {
  card: CardRow;
  stat: LetterStat | undefined;
  ttsEnabled: boolean;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'unavailable'>('idle');
  const playable =
    Boolean(card.audio_path) && ttsEnabled && audioSupported() && state !== 'unavailable';
  const solid = stat ? isSolid(stat) : false;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && playable && styles.pressed]}
      onPress={() => {
        if (!playable) return;
        setState('busy');
        void playAudioPath(card.audio_path).then((played) =>
          setState(played ? 'idle' : 'unavailable'),
        );
      }}
      disabled={!playable}
      accessibilityRole="button"
      accessibilityLabel={`${card.sr_cyr}. ${card.example_en}.${solid ? ' Solid.' : ''}`}
      testID={`alphabet-row-${card.id}`}
    >
      <View style={styles.pairColumn}>
        <ScriptText role="cyr" style={styles.pair}>
          {card.sr_cyr}
        </ScriptText>
        <ScriptText role="lat" style={styles.latin}>
          {latinLetterPair(card.sr_cyr)}
        </ScriptText>
      </View>

      <View style={styles.wordColumn}>
        <View style={styles.wordLine}>
          <ScriptText role="cyr" style={styles.word}>
            {card.example_cyr}
          </ScriptText>
          <ScriptText role="en" style={styles.gloss}>
            {card.example_en}
          </ScriptText>
        </View>
        {/* Without its trailing "— word (gloss)": that word and its meaning are
            already on the line directly above. */}
        <MixedText role="en" style={styles.hint}>
          {hintWithoutExample(card.en)}
        </MixedText>
      </View>

      <View style={styles.marks}>
        {solid ? (
          <Text style={styles.solid} testID={`alphabet-solid-${card.id}`}>
            ✓
          </Text>
        ) : null}
        {playable ? <Text style={styles.speaker}>{state === 'busy' ? '…' : '🔊'}</Text> : null}
      </View>
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
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  intro: { fontSize: 15, color: colors.text },
  solidLine: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.xs },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 12,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  pairColumn: { width: 74, alignItems: 'center' },
  pair: { fontSize: 30, fontWeight: '700' },
  latin: { fontSize: 15 },
  wordColumn: { flex: 1, gap: 2 },
  wordLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' },
  word: { fontSize: 18 },
  gloss: { fontSize: 13 },
  hint: { fontSize: 12 },
  marks: { alignItems: 'center', gap: 2, minWidth: 28 },
  solid: { fontSize: 16, color: colors.primary, fontWeight: '700' },
  speaker: { fontSize: 20 },
  pressed: { opacity: 0.8 },
  link: { paddingVertical: spacing.md, alignSelf: 'center' },
  linkText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
});
