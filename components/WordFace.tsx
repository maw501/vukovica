/**
 * The face of a word card in the Read aloud and Meaning drills.
 *
 * Read aloud (`way="read"`): the Cyrillic, and — once it is turned over — what
 * it says. Meaning (`way="meaning"`) is the same card the other way round: the
 * English on the front, to be said in Serbian out loud, and on the back the
 * Cyrillic big, its Latin spelling and the sentence it lives in. The back is
 * one layout for both, so whichever way he came at a word, the check looks the
 * same.
 *
 * The front is the whole point of the exercise, and it is the one card face in
 * the app that shows *only* Cyrillic. No transliteration, no English, nothing to
 * glance at: the word has to be read off the shapes and translated from memory,
 * because that is the thing being practised. Big, and in the serif every piece
 * of Serbian in this app is set in.
 *
 * The back ignores the `show_latin` setting, deliberately, the same way
 * `LetterFace` does. On a review card the transliteration is a support line for
 * someone still learning to read Cyrillic; here it *is* half of the answer —
 * "did I say it right?" — and hiding it would leave the check incomplete.
 *
 * The example sentence is shown only when the card has one. Quick-added words
 * arrive with empty `example_cyr` and empty `pos`, and an empty line under the
 * gloss looks like something failed to load.
 */

import { StyleSheet, Text, View } from 'react-native';

import { ScriptText } from '@/components/ScriptText';
import { colors, radius, spacing } from '@/lib/theme';
import type { DrillWay } from '@/lib/readDrill';
import { cyrToLat } from '@/lib/transliterate';
import type { CardRow } from '@/lib/types';

export function WordFace({
  card,
  revealed,
  way = 'read',
}: {
  card: CardRow;
  revealed: boolean;
  way?: DrillWay;
}) {
  const example = card.example_cyr?.trim() ?? '';
  const meaning = way === 'meaning';

  return (
    <>
      {meaning ? (
        // The English is the question here, so it gets the size the Cyrillic
        // gets on a Read aloud card, and the Cyrillic waits for the reveal.
        <ScriptText role="en" style={styles.prompt} testID="read-card-prompt-en">
          {card.en}
        </ScriptText>
      ) : null}

      {!meaning || revealed ? (
        <ScriptText role="cyr" style={styles.word} testID="read-card-cyr">
          {card.sr_cyr}
        </ScriptText>
      ) : null}

      {revealed ? (
        <View style={styles.answer} testID="read-card-answer">
          {/* On a Meaning card the English is already at the top. */}
          {meaning ? null : (
            <ScriptText role="en" style={styles.gloss} testID="read-card-en">
              {card.en}
            </ScriptText>
          )}
          <ScriptText role="lat" style={styles.latin} testID="read-card-lat">
            {cyrToLat(card.sr_cyr)}
          </ScriptText>

          {example ? (
            <>
              <View style={styles.divider} />
              <ScriptText role="cyr" style={styles.exampleCyr} testID="read-card-example-cyr">
                {example}
              </ScriptText>
              {card.example_en?.trim() ? (
                <ScriptText role="en" style={styles.exampleEn} testID="read-card-example-en">
                  {card.example_en}
                </ScriptText>
              ) : null}
            </>
          ) : null}
        </View>
      ) : (
        <Text style={styles.faceDown}>
          {meaning ? 'Say it in Serbian, then tap to check' : 'Read it out loud, then tap to check'}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  // Colour and face come from `script` (see components/ScriptText.tsx); what is
  // left here is size, weight and alignment, which the three-script scheme
  // deliberately leaves alone. Smaller than a letter pair — a word is several
  // glyphs and has to fit — and still far larger than a review card's headword.
  word: { fontSize: 52, lineHeight: 68, fontWeight: '700', textAlign: 'center' },
  // Smaller than the Cyrillic: an English gloss is often several words
  // ("to be in a hurry") where a headword is one.
  prompt: { fontSize: 32, lineHeight: 42, fontWeight: '700', textAlign: 'center' },
  answer: { alignItems: 'center', gap: spacing.xs, alignSelf: 'stretch' },
  gloss: { fontSize: 20, textAlign: 'center' },
  latin: { fontSize: 22, fontWeight: '600', textAlign: 'center' },
  divider: {
    height: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    borderRadius: radius.sm,
    marginVertical: spacing.sm,
  },
  exampleCyr: { fontSize: 18, textAlign: 'center' },
  exampleEn: { fontSize: 14, textAlign: 'center' },
  faceDown: { fontSize: 13, color: colors.textMuted, marginTop: spacing.md },
});
