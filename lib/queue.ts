/**
 * The order in which a study session presents cards.
 *
 * Pure and synchronous: the caller fetches the due rows and the candidate new
 * cards, and this decides what is actually studied and in what order.
 *
 * One deck's worth: words. The letters used to be a second one here — a `Deck`
 * union, a fixed five-a-day allowance, a `kind` filter — and they are drilled on
 * demand now instead (`lib/letters.ts`), with no schedule and nothing withheld,
 * so none of that machinery has anything left to decide.
 */

import type { CardRow, UserCardRow } from '@/lib/types';

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
