/**
 * The grammar drill's pure logic: what counts as a right answer, which items a
 * run is built from, and how a topic's explanation and prompts are cut up for
 * rendering.
 *
 * Nothing here touches the network or React, so every rule the drill is judged
 * by is testable on its own — which matters most for `checkAnswer`, where a
 * loose rule marks a wrong answer right and a strict one marks Mark's own
 * Latin-keyboard typing wrong.
 */

import { latToCyr } from '@/lib/transliterate';
import type { GrammarItemRow } from '@/lib/types';

/** Items in one drill run. Long enough to be practice, short enough to finish. */
export const RUN_SIZE = 10;

/** The blank every prompt in `data/phase3/grammar.json` carries. */
const BLANK = '___';

/**
 * An answer reduced to what is actually being compared: no surrounding space, no
 * doubled space inside (the two-word answers — не могу, да ли — are where that
 * shows up), no case.
 */
function normalise(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Is `input` the item's answer?
 *
 * Two ways to be right, because the app accepts either script everywhere
 * (spec §3): the Cyrillic answer as stored, or the same word typed on a Latin
 * keyboard — "volim" for волим, "njegov" for његов. `latToCyr` handles the
 * digraphs, which is the only part a naive letter-for-letter map gets wrong.
 *
 * Nothing fuzzier than that: no stripping of the accents that distinguish č/ć,
 * no prefix matching. The drill is a conjugation test, and волиш is not волим.
 *
 * An empty answer is never right — not even against an empty expectation, which
 * cannot occur (`grammar_items.answer_cyr` is `not null` and never blank) but
 * would otherwise make every miss-hit Enter a correct answer.
 */
export function checkAnswer(input: string, answer_cyr: string): boolean {
  const typed = normalise(input);
  if (typed === '') return false;
  const expected = normalise(answer_cyr);
  if (expected === '') return false;
  return typed === expected || latToCyr(typed) === expected;
}

/**
 * The items for one run: all of them when a topic is no longer than a run,
 * otherwise `n` of them drawn at random.
 *
 * Always in `sort` order, drawn or not. The order is the teaching order — first
 * person, second person, third person — and a run that jumped about would make
 * the paradigm harder to feel than it needs to be. The randomness is only about
 * *which* of an eighteen-item topic gets asked, so that the fourth run through a
 * topic is not the first one again.
 *
 * `rng` is a test seam, as it is in `pickDrillWords`; nothing but the tests ever
 * passes it.
 */
export function pickRun(
  items: readonly GrammarItemRow[],
  n: number = RUN_SIZE,
  rng: () => number = Math.random,
): GrammarItemRow[] {
  if (n <= 0) return [];
  const bySort = (a: GrammarItemRow, b: GrammarItemRow) => a.sort - b.sort;
  // Copied before sorting: the caller's array is the react-query cache's own
  // rows, and sorting in place would mutate cached data.
  if (items.length <= n) return [...items].sort(bySort);

  const pool = [...items];
  const picked: GrammarItemRow[] = [];
  while (picked.length < n) {
    const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    picked.push(pool[index]);
    // Swap-remove: sampling without replacement, and no O(n) splice.
    pool[index] = pool[pool.length - 1];
    pool.pop();
  }
  return picked.sort(bySort);
}

/** A prompt cut in two around its blank, for rendering the input inline. */
export interface PromptParts {
  before: string;
  after: string;
}

/**
 * Split a prompt on its `___`.
 *
 * Every prompt in the content file has one, but a prompt without one is shown
 * whole rather than dropped: the seed is data, and data that does not match its
 * documented shape should degrade, not disappear.
 */
export function promptParts(prompt: string): PromptParts {
  const at = prompt.indexOf(BLANK);
  if (at === -1) return { before: prompt, after: '' };
  return { before: prompt.slice(0, at), after: prompt.slice(at + BLANK.length) };
}

/**
 * One renderable piece of a topic's explanation.
 *
 * A `bullet` carries its own `marker` when the source numbered it — "1.", "2."
 * — and leaves it undefined when the source used `- `, so the screen supplies
 * the dot. The number belongs to the content: `simple-questions` numbers the
 * two ways to ask a yes-or-no question and then refers to them as the first and
 * the second, which a bulleted list would not support.
 */
export type ExplainBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string; marker?: string };

/**
 * The start of an ordered-list item: "1. " or "2) ", with its number captured.
 */
const ORDERED_ITEM = /^(\d+[.)])\s+(.*)$/;

/**
 * `explain_md` cut into blocks a React Native screen can render.
 *
 * The content uses four constructs — paragraphs separated by a blank line,
 * `- ` bullets, `1. ` numbered items, and `**bold**` / `*italic*` emphasis
 * (`data/phase3/README.md`) — so a markdown dependency for a dozen explanations
 * would be a library to carry, audit and keep in step with Expo for no gain.
 * Emphasis is dropped rather than styled: it marks a term as a term, which a
 * paragraph of English about Serbian already does with the Serbian word itself.
 */
export function explainBlocks(md: string): ExplainBlock[] {
  const blocks: ExplainBlock[] = [];
  /** The lines of the paragraph being accumulated, if any. */
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: stripEmphasis(paragraph.join(' ')) });
    paragraph = [];
  };

  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('- ')) {
      // A bullet ends the paragraph above it even without a blank line between.
      flush();
      blocks.push({ kind: 'bullet', text: stripEmphasis(line.slice(2).trim()) });
      continue;
    }
    const ordered = ORDERED_ITEM.exec(line);
    if (ordered) {
      // Same block kind, because a numbered item is a list item that happens to
      // print a number instead of a dot; the screen renders both with one branch.
      flush();
      blocks.push({
        kind: 'bullet',
        text: stripEmphasis(ordered[2].trim()),
        marker: ordered[1],
      });
      continue;
    }
    paragraph.push(line);
  }
  flush();

  return blocks;
}

/** `**bold**` and `*italic*` reduced to their text. */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
}

/**
 * A topic's accuracy as a whole percentage, or null when it has never been
 * drilled.
 *
 * Null rather than 0: an untouched topic and a topic every answer of which was
 * wrong are different things, and "0%" against a topic never opened would read
 * as a rebuke.
 */
export function topicAccuracy(
  stat: { attempts: number; correct: number } | undefined,
): number | null {
  if (!stat || stat.attempts <= 0) return null;
  return Math.round((stat.correct / stat.attempts) * 100);
}

// ---------------------------------------------------------------------------
// The bump_grammar_stats wire contract
// ---------------------------------------------------------------------------

/**
 * The name and arguments of `public.bump_grammar_stats`
 * (`supabase/migrations/20260830150000_phase3_schema.sql`).
 *
 * As with `bump_drill_stats`: the argument names here and in the SQL are one
 * contract with no compiler across it, so `grammarRpc.test.ts` parses the
 * migration and `grammar.test.ts` pins this side of it.
 */
export const BUMP_GRAMMAR_STATS_FN = 'bump_grammar_stats';

export interface BumpGrammarStatsParams {
  p_topic_id: string;
  p_attempts: number;
  p_correct: number;
}

/**
 * One finished run as the function's arguments.
 *
 * Deliberately no `p_user_id`: the function fills `user_id` from `auth.uid()`,
 * so a client cannot ask to write somebody else's counters.
 */
export function bumpGrammarStatsParams(
  topicId: string,
  attempts: number,
  correct: number,
): BumpGrammarStatsParams {
  return { p_topic_id: topicId, p_attempts: attempts, p_correct: correct };
}
