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
 * Pure and dependency-free, like `lib/readDrill.ts`: `api.ts` reaches
 * `lib/supabase.ts` (and therefore `react-native`), which vitest cannot load, so
 * what a set *means* is decided here and the screens and `getQueue` only ask.
 */

import { isKnown, type LibraryEntry } from '@/lib/library';
import { MINE_THEME, themeCards, themeLabel } from '@/lib/readDrill';
import type { CardRow, CardState } from '@/lib/types';

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
 * writing is the same shapes the other way round, and meaning is the one that
 * comes back on a schedule.
 */
export const WAYS: readonly WayOption[] = [
  { way: 'read', label: 'Read aloud', blurb: 'See the Cyrillic, say it out loud, then check.' },
  { way: 'write', label: 'Write it', blurb: 'See the English, type it in Cyrillic.' },
  {
    way: 'meaning',
    label: 'Meaning',
    blurb: 'Flashcards that come back when you’re about to forget.',
  },
];

const WAY_PATHS: Record<PractiseWay, '/read/run' | '/trainer' | '/review'> = {
  read: '/read/run',
  write: '/trainer',
  meaning: '/review',
};

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
export type WayHref = `${(typeof WAY_PATHS)[PractiseWay]}?theme=${string}`;

export function wayHref(way: PractiseWay, theme: string): WayHref {
  return `${WAY_PATHS[way]}?theme=${encodeURIComponent(theme)}`;
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

/**
 * How a set narrows the flashcard queue, for `api.getQueue` to turn into
 * filters.
 *
 * `mine` is the known words, so it can only ever be *due* ones: a known word
 * has a `user_cards` row by definition, and a new card is one that has none.
 * Asking for new cards there would be a wasted read that returns nothing.
 */
export interface QueueScope {
  /** Only cards in this `cards.domain`; null for any. */
  domain: string | null;
  /** Only rows in the known state. */
  knownOnly: boolean;
  /** Whether new cards may be introduced at all. */
  includeNew: boolean;
}

export function queueScope(theme: string | null): QueueScope {
  if (theme === null) return { domain: null, knownOnly: false, includeNew: true };
  if (theme === MINE_THEME) return { domain: null, knownOnly: true, includeNew: false };
  return { domain: theme.trim(), knownOnly: false, includeNew: true };
}

/**
 * Whether one queue candidate belongs to the scope.
 *
 * `getQueue` asks PostgREST for exactly this already; the check is repeated
 * over what comes back because a domain stored with stray whitespace would slip
 * past an `eq` in one direction and a trimmed comparison in the other, and the
 * screen promises "only Family" on the strength of it. `userCard` is null for a
 * new card.
 */
export function inQueueScope(
  scope: QueueScope,
  card: Pick<CardRow, 'domain'>,
  userCard: { state: CardState } | null,
): boolean {
  if (userCard === null && !scope.includeNew) return false;
  if (scope.knownOnly && (userCard === null || !isKnown(userCard))) return false;
  if (scope.domain !== null && (card.domain?.trim() ?? '') !== scope.domain) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The daily line
// ---------------------------------------------------------------------------

/**
 * How many cards an unthemed flashcard session would hold right now: every due
 * card plus what is left of today's new ones.
 *
 * The same arithmetic the dashboard's habit card does with the same
 * `['dashboard']` figures, so the two can quote the same number.
 */
export function dailyReviewCount(
  stats: { dueCount: number; newAvailable: number; newDoneToday: number },
  newPerDay: number,
): number {
  const newLeft = Math.max(0, Math.min(newPerDay - stats.newDoneToday, stats.newAvailable));
  return Math.max(0, stats.dueCount) + newLeft;
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
