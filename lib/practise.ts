/**
 * Practise: one set of words, three ways of going over it.
 *
 * The home screen used to offer the trainer, Read it, Review and the deck as
 * four separate doors, each with its own idea of which words it was about. Mark
 * found that a wall of equal choices rather than a way in, so Practise asks two
 * questions instead — *which words?* and *how?* — and every way takes the same
 * answer to the first one, as `?theme=` on its URL:
 *
 *   - no theme  — the whole deck, which is what each screen did before Practise
 *                 existed, so every old link and bookmark still means what it
 *                 meant;
 *   - `mine`    — the words he already knows (`user_cards.state = 'review'`,
 *                 `lib/library.ts`'s one rule);
 *   - otherwise — a `cards.domain`, as the Read it picker has always offered.
 *
 * None of the three is on a schedule. Mark's words: "I want to drill all words
 * - I don't want spaced repetition delays at the moment." So every way draws
 * from the whole set, as often as he likes, shakiest first, and nothing a way
 * records can take a word out of any of them. The flashcard queue still exists
 * (`/review`, under More) but it is not one of these.
 *
 * Pure and dependency-free, like `lib/readDrill.ts`: `api.ts` reaches
 * `lib/supabase.ts` (and therefore `react-native`), which vitest cannot load, so
 * what a set *means* is decided here and the screens only ask.
 */

import { isKnown, type LibraryEntry } from '@/lib/library';
import { MINE_THEME, themeCards, themeLabel } from '@/lib/readDrill';
import type { CardRow } from '@/lib/types';

export { MINE_THEME };

/**
 * A `?theme=` param as the screens receive it, reduced to a set or to null.
 *
 * expo-router hands a repeated param over as an array; the first one wins, the
 * same way `review.tsx` has always read `?deck=`. Blank means "no set", i.e.
 * the whole deck — a link written as `/trainer?theme=` should not open an empty
 * drill.
 */
export function parseTheme(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const theme = raw?.trim() ?? '';
  return theme === '' ? null : theme;
}

/** What a set is called on screen — "My words", "Family" — or the whole deck. */
export function setLabel(theme: string | null): string {
  return theme === null ? 'the whole deck' : themeLabel(theme);
}

// ---------------------------------------------------------------------------
// The three ways
// ---------------------------------------------------------------------------

export type PractiseWay = 'read' | 'write' | 'meaning';

export interface WayOption {
  way: PractiseWay;
  label: string;
  /** One plain line: what the way actually has you do. */
  blurb: string;
}

/**
 * In the order Mark meets them: reading is the skill the letters just taught,
 * and the first step — using words he already knows to learn the Cyrillic —
 * so it leads; writing is the same shapes the other way round; meaning is
 * reading's mirror, the English first and the Serbian to find.
 */
export const WAYS: readonly WayOption[] = [
  { way: 'read', label: 'Read aloud', blurb: 'See the Cyrillic, say it out loud, then check.' },
  { way: 'write', label: 'Write it', blurb: 'See it in Latin letters, type it in Cyrillic.' },
  { way: 'meaning', label: 'Meaning', blurb: 'See the English, say the Serbian, then check.' },
];

/**
 * Everything before the set's slug. Meaning is the Read aloud run turned round
 * (`lib/readDrill.ts`'s `DrillWay`), so it is that screen with `way=meaning`.
 */
const WAY_PREFIXES = {
  read: '/read/run?theme=',
  write: '/trainer?theme=',
  meaning: '/read/run?way=meaning&theme=',
} as const satisfies Record<PractiseWay, string>;

/**
 * Where a way opens for a set.
 *
 * Built as a string rather than an `{ pathname, params }` object so the slug is
 * encoded exactly once, here: a domain is a slug today, but the picker offers
 * whatever domains the deck has, and a stray space or ampersand in one should
 * not quietly open the wrong set.
 *
 * The return type is spelled out as template literals because that is what
 * expo-router's typed routes accept: a bare `string` would not typecheck as an
 * `Href`, and importing `Href` here would tie a pure module to the router.
 */
export type WayHref = `${(typeof WAY_PREFIXES)[PractiseWay]}${string}`;

export function wayHref(way: PractiseWay, theme: string): WayHref {
  return `${WAY_PREFIXES[way]}${encodeURIComponent(theme)}`;
}

// ---------------------------------------------------------------------------
// Which set Practise opens on
// ---------------------------------------------------------------------------

/**
 * The set Practise shows the ways for straight away, or null for the list.
 *
 * The one he picked last time, while it still has words in it. Failing that,
 * My words whenever it has any: "It is by using existing words I know I'll
 * learn cyrillic — which is the first step", so the words he knows are the
 * default rather than something to go and find. With neither, the list.
 *
 * Only a set with words in it is ever returned: a remembered set that has since
 * emptied, or left the deck, would open three ways into nothing.
 */
export function initialSet(
  remembered: string | null,
  sets: readonly { domain: string; total: number }[],
): string | null {
  const usable = (domain: string | null) =>
    domain !== null && sets.some((set) => set.domain === domain && set.total > 0);
  if (usable(remembered)) return remembered;
  if (usable(MINE_THEME)) return MINE_THEME;
  return null;
}

// ---------------------------------------------------------------------------
// Which words a set holds
// ---------------------------------------------------------------------------

/**
 * The words a drill over this set draws from.
 *
 * `mine` comes from My words rather than from the deck, like the Read aloud
 * run: those rows are the ones that carry the known state, and a quick-added
 * word is on that list whether or not the deck read has reached it. No theme is
 * the whole deck, unchanged.
 */
export function practisePool({
  theme,
  cards,
  library = [],
}: {
  theme: string | null;
  /** Every word card in the deck (`api.listCards`). */
  cards: readonly CardRow[];
  /** My words (`api.getLibrary`). Only read for `mine`. */
  library?: readonly LibraryEntry[];
}): CardRow[] {
  if (theme === null) return [...cards];
  if (theme === MINE_THEME) {
    return library.filter((entry) => isKnown(entry.userCard)).map((entry) => entry.card);
  }
  return themeCards({ theme, cards });
}

// ---------------------------------------------------------------------------
// What an empty way says
// ---------------------------------------------------------------------------

/**
 * Write it with no words to type.
 *
 * The trainer only drills single words, so a set can be non-empty and still
 * give it nothing: My words holding only phrases, say. `poolSize` is the set
 * before that filter, which is what tells "nothing ticked yet" from "only
 * phrases".
 */
export function writeItEmptyMessage(theme: string | null, poolSize: number): string {
  if (theme === null) {
    return 'There are no single words in the deck to drill yet. Add a word and come back.';
  }
  if (theme === MINE_THEME && poolSize === 0) {
    return 'Nothing here yet — tick words you know in My words, then come back.';
  }
  if (theme === MINE_THEME) {
    return 'Your words are all phrases so far. Write it needs single words.';
  }
  return `${setLabel(theme)} has no single words to type. Pick another set.`;
}

// ---------------------------------------------------------------------------
// Remembering the last set
// ---------------------------------------------------------------------------

/** The browser storage key the last-picked set is kept under. */
export const LAST_SET_KEY = 'vukovica.practise.lastSet';

/** The two calls of `Storage` this needs, so a test can pass a Map-backed one. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * `localStorage`, when there is one to reach.
 *
 * The app ships as a PWA, so on web there always should be; on a native build
 * there is not, and remembering the set is a nicety that simply does not happen
 * there. Even reaching the property can throw (Safari's private mode, storage
 * blocked for the site), hence the try.
 */
function defaultStore(): KeyValueStore | null {
  try {
    const store = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

/** The set picked last time, or null. Never throws. */
export function readLastSet(store: KeyValueStore | null = defaultStore()): string | null {
  try {
    return parseTheme(store?.getItem(LAST_SET_KEY) ?? undefined);
  } catch {
    return null;
  }
}

/** Remember a set for next time. A storage that refuses is not an error. */
export function writeLastSet(
  theme: string,
  store: KeyValueStore | null = defaultStore(),
): void {
  try {
    store?.setItem(LAST_SET_KEY, theme);
  } catch {
    // Full, blocked or private: Practise just opens on the list next time.
  }
}
