/**
 * Speaker button for a card's recorded pronunciation.
 *
 * It renders nothing at all when the card has no `audio_path` — clips are
 * generated offline in batches, so a word that has not been through one simply
 * has no button rather than a button that does nothing. It also removes itself
 * if playback turns out to be impossible (an unsupported platform, or a browser
 * that refused).
 *
 * Shared by the review screen and the reader's gloss sheet: both show the same
 * card, so hearing it has to work the same way in both.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { audioSupported, playAudioPath } from '@/lib/audio';
import { colors, touchTarget } from '@/lib/theme';

export function SpeakButton({
  path,
  enabled,
  testID,
}: {
  /** `cards.audio_path`; null for a card with no clip yet. */
  path: string | null;
  /** `settings.tts_enabled` — the user can turn playback off entirely. */
  enabled: boolean;
  testID: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'unavailable'>('idle');

  // A new card means a new clip to try; forget a previous failure.
  useEffect(() => setState('idle'), [path]);

  if (!path || !enabled || !audioSupported() || state === 'unavailable') return null;

  return (
    <Pressable
      style={({ pressed }) => [styles.speak, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Play the pronunciation"
      testID={testID}
      onPress={() => {
        setState('busy');
        void playAudioPath(path).then((played) => setState(played ? 'idle' : 'unavailable'));
      }}
    >
      <Text style={styles.speakIcon}>{state === 'busy' ? '…' : '🔊'}</Text>
      <Text style={styles.speakLabel}>listen</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  speak: {
    minWidth: touchTarget + 12,
    minHeight: touchTarget - 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakIcon: { fontSize: 22 },
  speakLabel: { fontSize: 11, color: colors.textMuted },
  pressed: { opacity: 0.8 },
});
