/**
 * Playing a card's recorded pronunciation.
 *
 * There is no synthesis at runtime any more (phase 3 removed the `tts` Edge
 * Function): clips are generated once by an offline batch script, uploaded to
 * the public `audio` bucket, and remembered on the card as `cards.audio_path`.
 * A card with no `audio_path` simply has no clip, and the caller shows no
 * button — never a button that does nothing when pressed.
 *
 * Playback is web-only for now. `expo-av` is not a dependency (the MVP ships as
 * a PWA), so on native this degrades to "no audio available", exactly as it does
 * for a card with no clip.
 */

import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/** The bucket the batch script writes to. Public-read, so no signing is needed. */
const AUDIO_BUCKET = 'audio';

/** The clip currently playing, so a new one can interrupt it. */
let playing: HTMLAudioElement | null = null;

/**
 * True when this platform can play a clip at all. False on native, where there
 * is no audio player installed — callers hide the button rather than offering
 * something that does nothing.
 */
export function audioSupported(): boolean {
  // TODO(native): add `expo-av` (or `expo-audio`) and play the URL through it
  // when the app ships as a real iOS/Android build.
  return Platform.OS === 'web' && typeof window !== 'undefined' && 'Audio' in window;
}

/**
 * The public URL for a stored clip, or null when there is no path.
 *
 * A blank `audio_path` is treated as no path: an empty string would otherwise
 * resolve to the bucket root and 404 on press.
 */
export function audioUrlFor(path: string | null | undefined): string | null {
  const key = path?.trim();
  if (!key) return null;
  return supabase.storage.from(AUDIO_BUCKET).getPublicUrl(key).data.publicUrl || null;
}

/**
 * Play the clip at `path`. Resolves true when one actually started, false when
 * there is nothing to play (no clip on the card, unsupported platform, or the
 * browser refused). Callers use the false to hide the button.
 */
export async function playAudioPath(path: string | null | undefined): Promise<boolean> {
  if (!audioSupported()) return false;

  const url = audioUrlFor(path);
  if (!url) return false;

  try {
    playing?.pause();
    const clip = new window.Audio(url);
    playing = clip;
    await clip.play();
    return true;
  } catch (error) {
    console.warn('[audio] playback failed', error);
    return false;
  }
}
