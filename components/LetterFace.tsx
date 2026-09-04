/**
 * The face of a letter card: the Cyrillic pair, and — once it is turned over —
 * what it says and the word Mark's wife recorded for it.
 *
 * Big on purpose. A letter pair is two glyphs and the *shape* is the whole thing
 * being learnt, so it is set far larger than a word headword and in the serif
 * every piece of Serbian in this app is set in.
 *
 * The Latin pair ignores the `show_latin` setting, deliberately. On a word card
 * the transliteration is a support line for someone still learning to read
 * Cyrillic; on a letter card it *is* the answer, and hiding it would leave the
 * back of the card saying nothing at all.
 *
 * `sr_cyr` holds the pair as printed ("Б б"), so the Latin pair is derived with
 * `latinLetterPair` — `cyrToLat` plus the one thing a cited letter needs: "Љ љ"
 * is "Lj lj", not the all-caps "LJ lj" a lone capital digraph would otherwise
 * get.
 */

import { StyleSheet, Text, View } from 'react-native';

import { MixedText, ScriptText } from '@/components/ScriptText';
import { colors, radius, spacing } from '@/lib/theme';
import { latinLetterPair } from '@/lib/transliterate';
import type { CardRow } from '@/lib/types';

export function LetterFace({
  card,
  revealed,
  /** What the front says while it is face down. */
  hint = 'Tap to show the answer',
}: {
  card: CardRow;
  revealed: boolean;
  hint?: string;
}) {
  return (
    <>
      <ScriptText role="cyr" style={styles.letterPair} testID="card-cyr">
        {card.sr_cyr}
      </ScriptText>

      {revealed ? (
        <View style={styles.answer} testID="card-answer">
          <ScriptText role="lat" style={styles.letterLatin} testID="card-lat">
            {latinLetterPair(card.sr_cyr)}
          </ScriptText>

          <View style={styles.divider} />

          {/* Her word, then what it means: the clip says the letter and then
              this word, so the card has to show the same one. */}
          <ScriptText role="cyr" style={styles.exampleCyr} testID="card-example-cyr">
            {card.example_cyr}
          </ScriptText>
          <ScriptText role="en" style={styles.exampleEn} testID="card-example-en">
            {card.example_en}
          </ScriptText>

          {/* The hint is English about a Serbian letter and usually has Serbian
              in it, so it is split rather than styled whole. */}
          <MixedText role="en" style={styles.hintLine} testID="card-en">
            {card.en}
          </MixedText>
        </View>
      ) : (
        <Text style={styles.faceDown}>{hint}</Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  // Colour and face come from `script` (see components/ScriptText.tsx); what is
  // left here is size, weight and alignment, which the three-script scheme
  // deliberately leaves alone. The serif sits taller than the sans it replaced,
  // hence the roomier line.
  letterPair: { fontSize: 96, lineHeight: 124, fontWeight: '700', textAlign: 'center' },
  letterLatin: { fontSize: 48, fontWeight: '600', textAlign: 'center' },
  answer: { alignItems: 'center', gap: spacing.xs, alignSelf: 'stretch' },
  divider: {
    height: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    borderRadius: radius.sm,
    marginVertical: spacing.sm,
  },
  exampleCyr: { fontSize: 26, textAlign: 'center' },
  exampleEn: { fontSize: 15, textAlign: 'center' },
  hintLine: { fontSize: 15, textAlign: 'center', marginTop: spacing.xs },
  faceDown: { fontSize: 13, color: colors.textMuted, marginTop: spacing.md },
});
