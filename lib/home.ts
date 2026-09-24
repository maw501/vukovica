/**
 * What the home screen says, and which card it leads with.
 *
 * Home used to be eleven equal tiles, and Mark's verdict was that with nothing
 * standing out he avoided the screen altogether. It is now three things —
 * Letters, Practise, My words — with everything else behind one "More" link, and
 * the only decision left is which of the first two is the big one: the letters
 * while any of the thirty are still to learn, Practise once they are done.
 *
 * Pure and dependency-free, like `lib/library.ts`: `api.ts` reaches
 * `lib/supabase.ts` (and therefore `react-native`), which the Node-based vitest
 * environment cannot load, so everything the screen decides is decided here.
 */

import { LETTER_TOTAL } from '@/lib/stages';

/**
 * True while the letters are still the first job.
 *
 * `mastered` is `Progress.letterMastery.mastered` — the same union of the drill's
 * and the trainer's bar that the progress screen counts — so the card cannot say
 * "all 30 learned" beside a progress screen that says 29. Unknown (the progress
 * read still loading, or failed) counts as still learning: showing a beginner
 * the small link would hide the one thing he should do first, whereas showing
 * the big card to someone who has finished costs him one scroll.
 */
export function lettersLeading(mastered: number | null | undefined): boolean {
  if (mastered == null || !Number.isFinite(mastered)) return true;
  return mastered < LETTER_TOTAL;
}

/**
 * The letters card's progress line: "12 of 30 learned".
 *
 * "Learned" rather than "mastered" or "solid": it is the plain word, and it is
 * the one the collapsed link uses, so the two states of the card read as one
 * thing before and after.
 */
export function lettersProgressLine(mastered: number): string {
  const count = clampCount(mastered, LETTER_TOTAL);
  if (count === 0) return `${LETTER_TOTAL} letters to learn`;
  if (count >= LETTER_TOTAL) return `All ${LETTER_TOTAL} learned`;
  return `${count} of ${LETTER_TOTAL} learned`;
}

/** The one-line link the letters card collapses into once all thirty are learned. */
export const LETTERS_DONE_LINK = `Letters — all ${LETTER_TOTAL} learned`;

/**
 * The Practise card's second line: what practising is.
 *
 * Not a count. It used to say how many flashcards were "waiting today", but
 * nothing in Practise waits any more — every way drills every word whenever he
 * likes — so a due count here would describe a schedule the card does not open.
 */
export const PRACTISE_LINE = 'Read, write or say what words mean';

/**
 * The My words card's second line.
 *
 * `known` is the Words ladder's `knownWords`, so the number here is the number
 * on the list the card opens. At zero — which is where Mark is — the line is the
 * first job rather than a count of nothing.
 */
export function myWordsLine(known: number | null | undefined): string {
  const count = clampCount(known ?? 0);
  if (count === 0) return 'Tick the words you already know';
  return `${count} ${count === 1 ? 'word' : 'words'} known`;
}

/** A whole, non-negative count, optionally capped. */
function clampCount(value: number, max = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}
