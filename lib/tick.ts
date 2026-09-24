/**
 * "Tick the words you know" — browsing the deck by theme and marking, one tap a
 * word, the ones Mark already has.
 *
 * He started the app knowing a fair amount of Serbian by ear and with nothing
 * in My words, and grading 724 cards through review to get the ones he knows out
 * of the way is not a job anyone does. So My words offers the deck a theme at a
 * time, each word with its Cyrillic, Latin and English, and a tap parks it as
 * known through `mark_known` — the same "I already know this" the review screen
 * and the Deck offer, done in bulk.
 *
 * Pure and dependency-free, like `lib/library.ts`: `api.ts` reaches
 * `lib/supabase.ts` (and therefore `react-native`), which the Node-based vitest
 * environment cannot load, so everything the screen decides is decided here.
 */

import { isKnown, type LibraryEntry } from '@/lib/library';
import { buildThemes, MINE_THEME, themeCards } from '@/lib/readDrill';
import type { CardRow, UserCardRow } from '@/lib/types';

/** One theme on the tick screen: what it is called and how much of it is known. */
export interface TickTheme {
  /** A `cards.domain`. */
  domain: string;
  label: string;
  total: number;
  known: number;
}

/**
 * The ids of the words he knows, out of My words' rows.
 *
 * `isKnown` is `lib/library.ts`'s one rule — `state = 'review'` — so a word
 * ticked here is one the Known list and the dashboard count as well.
 */
export function knownCardIds(entries: readonly LibraryEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (isKnown(entry.userCard)) ids.add(entry.card.id);
  }
  return ids;
}

/**
 * Every theme the deck has, with how many of its words are known.
 *
 * The theme list is the Read it picker's (`buildThemes`) with its "My words"
 * row taken off — ticking the words you already know from a list of the words
 * you already know is a loop, not a job — so the two screens offer the same
 * themes under the same names, and `my-words` never shows up as a theme of its
 * own on either.
 */
export function tickThemes({
  cards,
  knownIds,
}: {
  cards: readonly CardRow[];
  knownIds: ReadonlySet<string>;
}): TickTheme[] {
  return buildThemes({ cards, stats: new Map(), knownIds })
    .filter((theme) => theme.domain !== MINE_THEME)
    .map((theme) => ({
      domain: theme.domain,
      label: theme.label,
      total: theme.total,
      known: themeCards({ theme: theme.domain, cards }).filter((card) => knownIds.has(card.id))
        .length,
    }));
}

/** "12 of 66 known", and "None known yet" rather than "0 of 66 known". */
export function knownOfLine(known: number, total: number): string {
  const count = Math.max(0, Math.min(known, total));
  if (count === 0) return `${total} ${total === 1 ? 'word' : 'words'} · none known yet`;
  if (count === total) return `All ${total} known`;
  return `${count} of ${total} known`;
}

/**
 * My words' cached rows with one word just marked known.
 *
 * Written straight into the `['library']` cache rather than invalidating it,
 * because this screen is tapped at speed: refetching every page of My words on
 * each of twenty taps would be twenty full reads for twenty one-row changes.
 * `mark_known` hands back the row it wrote, so the cache can hold exactly what
 * the server has. A word already in the list (one he was still learning) is
 * replaced in place; a new one goes to the front, which is where the "Newest"
 * sort would put it anyway.
 *
 * `undefined` in means the list has never been loaded, and stays undefined, so
 * the next reader fetches it properly rather than trusting a list of one.
 */
export function withMarkedKnown(
  entries: readonly LibraryEntry[] | undefined,
  card: CardRow,
  userCard: UserCardRow,
): LibraryEntry[] | undefined {
  if (!entries) return undefined;
  const entry: LibraryEntry = { card, userCard };
  const index = entries.findIndex((existing) => existing.card.id === card.id);
  if (index === -1) return [entry, ...entries];
  const next = [...entries];
  next[index] = entry;
  return next;
}
