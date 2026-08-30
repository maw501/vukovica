/**
 * The order in which a study session presents cards.
 *
 * Pure and synchronous: the caller fetches the due rows and the candidate new
 * cards, and this decides what is actually studied and in what order.
 */

import type { CardKind, CardRow, UserCardRow } from '@/lib/types';

/**
 * The two decks. A deck is a *user-facing* name for a `cards.kind` partition:
 * the review screen takes one as `?deck=`, and the dashboard counts each
 * separately. They never mix in one session queue (spec §4).
 */
export type Deck = 'words' | 'letters';

/** What `/review` studies when no `?deck=` is given — the daily word habit. */
export const DEFAULT_DECK: Deck = 'words';

/**
 * The letters deck's daily new-card allowance, fixed rather than taken from
 * `settings.new_per_day`.
 *
 * Five a day walks the whole azbuka in six sessions, which is the point of the
 * deck; the words setting is tuned for a 681-card deck and would introduce the
 * entire alphabet in three days at its default of 10.
 */
export const LETTERS_NEW_PER_DAY = 5;

const DECK_KIND: Readonly<Record<Deck, CardKind>> = { words: 'word', letters: 'letter' };

/** The `cards.kind` a deck is made of. */
export function deckKind(deck: Deck): CardKind {
  return DECK_KIND[deck];
}

/**
 * A deck name from an untrusted source — a `?deck=` query parameter, which
 * expo-router hands over as a string, an array of strings, or nothing at all.
 * Anything unrecognised is the word deck, so a mistyped link still studies.
 */
export function parseDeck(value: unknown): Deck {
  const first = Array.isArray(value) ? value[0] : value;
  return first === 'letters' ? 'letters' : DEFAULT_DECK;
}

/**
 * How many new cards this deck may introduce today.
 *
 * Words honour `settings.new_per_day`; letters are fixed at
 * `LETTERS_NEW_PER_DAY`, so turning the word allowance up does not also dump
 * the alphabet into one session. Negative or absent settings clamp to zero.
 */
export function deckAllowance(deck: Deck, newPerDay: number): number {
  if (deck === 'letters') return LETTERS_NEW_PER_DAY;
  return Math.max(0, newPerDay);
}

/** The cards of `deck`, in the order given. The input is not mutated. */
export function cardsInDeck(cards: readonly CardRow[], deck: Deck): CardRow[] {
  const kind = deckKind(deck);
  return cards.filter((card) => card.kind === kind);
}

/** One entry of a session queue — enough for the reviewer to fetch the card. */
export interface QueueItem {
  cardId: string;
  /** True when the card has never been studied, i.e. it comes out of `cards`. */
  isNew: boolean;
}

export interface BuildQueueArgs {
  /** Rows of `user_cards` whose `due` has passed. */
  dueCards: UserCardRow[];
  /** Candidate cards the user has never studied, in the order to introduce them. */
  newCards: CardRow[];
  /** The user's `settings.new_per_day` budget. */
  newPerDay: number;
  /** How many new cards the user has already been shown today. */
  newDoneToday: number;
}

/**
 * Due cards first, oldest due date first, then as many new cards as the day's
 * remaining budget allows (in the order given). Inputs are not mutated.
 */
export function buildQueue({
  dueCards,
  newCards,
  newPerDay,
  newDoneToday,
}: BuildQueueArgs): QueueItem[] {
  const due = [...dueCards]
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime())
    .map((row): QueueItem => ({ cardId: row.card_id, isNew: false }));

  const allowance = Math.max(0, newPerDay - newDoneToday);
  const fresh = newCards
    .slice(0, allowance)
    .map((card): QueueItem => ({ cardId: card.id, isNew: true }));

  return [...due, ...fresh];
}
