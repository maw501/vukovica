/**
 * Speaking a Serbian word or sentence out loud.
 *
 * The `tts` Edge Function turns text into an mp3 in the public `audio` bucket
 * and hands back its URL — the same text always maps to the same object, so the
 * server caches across users and this module caches across renders. One POST
 * per distinct string per app session, no matter how many times the button is
 * pressed.
 *
 * Playback is web-only for now. `expo-av` is not a dependency (the MVP ships as
 * a PWA), so on native this degrades to "no audio available" and the button
 * hides itself, exactly as it does when the server has no TTS key.
 */

import { Platform } from 'react-native';

import { callEdgeFunction } from '@/lib/edge';

interface TtsResponse {
  /** null when the server has no TTS key configured — a valid answer, not an error. */
  url: string | null;
}

/**
 * text -> resolved url (or null when there is no audio for it). The *promise*
 * is cached, not just its value, so two presses in flight at once share one
 * request. A failed lookup resolves to null and stays cached: the button hides
 * for the rest of the session rather than retrying a broken service on every tap.
 */
const urls = new Map<string, Promise<string | null>>();

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

/** The cached URL for `text`, fetching it the first time. Never throws. */
export function audioUrlFor(text: string): Promise<string | null> {
  const key = text.trim();
  if (!key) return Promise.resolve(null);

  const cached = urls.get(key);
  if (cached) return cached;

  const pending = callEdgeFunction<TtsResponse>('tts', { text: key })
    .then((body) => (typeof body?.url === 'string' ? body.url : null))
    .catch((error: unknown) => {
      console.warn('[audio] tts failed', error);
      return null;
    });

  urls.set(key, pending);
  return pending;
}

/**
 * Speak `text`. Resolves true when a clip actually started playing, false when
 * there is nothing to play (no key on the server, unsupported platform, or the
 * browser refused). Callers use the false to hide the button.
 */
export async function playText(text: string): Promise<boolean> {
  if (!audioSupported()) return false;

  const url = await audioUrlFor(text);
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

/** Test/debug seam: forget every cached URL. */
export function resetAudioCache(): void {
  urls.clear();
}
