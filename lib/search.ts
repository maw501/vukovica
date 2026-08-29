/**
 * Deck search.
 *
 * Matching happens in memory rather than in Postgres, because half of what the
 * user searches by does not exist as a column: the Latin form of a card is
 * *derived* with `cyrToLat`, not stored. The deck is a few hundred rows, so one
 * fetch and a substring scan is both simpler and faster than a round trip per
 * keystroke.
 */

import { cyrToLat } from '@/lib/transliterate';

/** The fields search looks at. Any card-shaped row will do. */
export interface SearchableCard {
  sr_cyr: string;
  en: string;
}

/**
 * Case- and diacritic-insensitive key. Serbian Latin is full of č/ć/š/ž/đ, and
 * an English keyboard has none of them, so "cao" has to find "ћао" (ćao).
 *
 * NFD splits a letter into base + combining mark, which the range strip then
 * removes — except đ (U+0111), which is a letter in its own right with no
 * decomposition, so it gets an explicit rule.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd');
}

/**
 * The cards matching `query`, in the order given. An empty query matches
 * everything. A card matches when the query is a substring of its Cyrillic
 * headword, of that headword transliterated to Latin, or of its English gloss.
 */
export function filterCards<T extends SearchableCard>(cards: readonly T[], query: string): T[] {
  const needle = fold(query.trim());
  if (!needle) return [...cards];

  return cards.filter((card) => {
    const haystacks = [card.sr_cyr, cyrToLat(card.sr_cyr), card.en];
    return haystacks.some((text) => fold(text).includes(needle));
  });
}
