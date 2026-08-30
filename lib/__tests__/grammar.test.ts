import { describe, expect, it } from 'vitest';

import {
  BUMP_GRAMMAR_STATS_FN,
  bumpGrammarStatsParams,
  checkAnswer,
  explainBlocks,
  pickRun,
  promptParts,
  topicAccuracy,
} from '@/lib/grammar';
import type { GrammarItemRow } from '@/lib/types';

/** A drill item with only the fields the pure helpers look at. */
function item(sort: number, answer_cyr = 'сам'): GrammarItemRow {
  return {
    id: `item-${sort}`,
    topic_id: 'topic',
    prompt: `prompt ${sort} — ја ___ ту`,
    answer_cyr,
    note: null,
    sort,
  };
}

describe('checkAnswer', () => {
  it('accepts the answer typed exactly', () => {
    expect(checkAnswer('волим', 'волим')).toBe(true);
  });

  it('ignores case', () => {
    // Every answer in the content file is lowercase, but a phone that
    // auto-capitalises the first letter must not mark a right answer wrong.
    expect(checkAnswer('Волим', 'волим')).toBe(true);
    expect(checkAnswer('ЈЕСАМ', 'јесам')).toBe(true);
  });

  it('ignores leading, trailing and doubled whitespace', () => {
    expect(checkAnswer('  волим  ', 'волим')).toBe(true);
    // The two-word answers (не могу, да ли) are where the collapse earns itself.
    expect(checkAnswer(' не   могу ', 'не могу')).toBe(true);
    expect(checkAnswer('да  ли', 'да ли')).toBe(true);
  });

  it('accepts the answer typed in Latin', () => {
    expect(checkAnswer('volim', 'волим')).toBe(true);
    expect(checkAnswer('Nisam', 'нисам')).toBe(true);
    expect(checkAnswer(' ne  mogu ', 'не могу')).toBe(true);
  });

  it('accepts Latin digraphs for љ, њ and џ', () => {
    expect(checkAnswer('njegov', 'његов')).toBe(true);
    expect(checkAnswer('njena', 'њена')).toBe(true);
    expect(checkAnswer('ljut', 'љут')).toBe(true);
    expect(checkAnswer('džep', 'џеп')).toBe(true);
  });

  it('rejects a wrong answer', () => {
    expect(checkAnswer('волиш', 'волим')).toBe(false);
    expect(checkAnswer('volis', 'волим')).toBe(false);
    // Right letters, wrong word: nothing here is fuzzy, an answer is the answer.
    expect(checkAnswer('нисам', 'сам')).toBe(false);
  });

  it('rejects an empty answer rather than matching an empty expectation', () => {
    expect(checkAnswer('', 'сам')).toBe(false);
    expect(checkAnswer('   ', 'сам')).toBe(false);
    expect(checkAnswer('', '')).toBe(false);
  });

  it('does not mangle a Cyrillic answer by transliterating it', () => {
    // `latToCyr` leaves Cyrillic alone, but the direct comparison is what the
    // Cyrillic path actually rests on -- assert both are live.
    expect(checkAnswer('ђубре', 'ђубре')).toBe(true);
    expect(checkAnswer('đubre', 'ђубре')).toBe(true);
  });
});

describe('pickRun', () => {
  it('returns every item in sort order when the topic is no longer than a run', () => {
    const items = [item(3), item(1), item(2)];
    expect(pickRun(items, 10).map((row) => row.sort)).toEqual([1, 2, 3]);
  });

  it('never returns more than the run size', () => {
    const items = Array.from({ length: 18 }, (_, index) => item(index + 1));
    expect(pickRun(items, 10)).toHaveLength(10);
  });

  it('defaults to a ten-item run', () => {
    const items = Array.from({ length: 18 }, (_, index) => item(index + 1));
    expect(pickRun(items)).toHaveLength(10);
  });

  it('hands the sample back in sort order, whatever order it was drawn in', () => {
    const items = Array.from({ length: 18 }, (_, index) => item(index + 1));
    // A generator that always draws the last remaining item: the draw order is
    // descending, so an unsorted implementation would come back 18, 17, 16...
    const run = pickRun(items, 10, () => 0.999999);
    expect(run.map((row) => row.sort)).toEqual([...run.map((row) => row.sort)].sort((a, b) => a - b));
  });

  it('samples without replacement — no item twice in one run', () => {
    const items = Array.from({ length: 18 }, (_, index) => item(index + 1));
    let seed = 0;
    // A walk across the whole unit interval, so the draws are spread out.
    const run = pickRun(items, 10, () => ((seed += 0.37) % 1));
    expect(new Set(run.map((row) => row.id)).size).toBe(10);
  });

  it('draws a different run from the same topic on a different roll', () => {
    const items = Array.from({ length: 18 }, (_, index) => item(index + 1));
    const first = pickRun(items, 10, () => 0);
    const last = pickRun(items, 10, () => 0.999999);
    expect(first.map((row) => row.sort)).not.toEqual(last.map((row) => row.sort));
  });

  it('copes with an empty topic and a nonsense run size', () => {
    expect(pickRun([], 10)).toEqual([]);
    expect(pickRun([item(1)], 0)).toEqual([]);
    expect(pickRun([item(1)], -3)).toEqual([]);
  });

  it('does not reorder or otherwise disturb the caller’s array', () => {
    const items = [item(3), item(1), item(2)];
    pickRun(items, 2, () => 0);
    expect(items.map((row) => row.sort)).toEqual([3, 1, 2]);
  });
});

describe('promptParts', () => {
  it('splits a prompt on its three-underscore blank', () => {
    expect(promptParts('I am at home — ја ___ код куће')).toEqual({
      before: 'I am at home — ја ',
      after: ' код куће',
    });
  });

  it('keeps a prompt whose blank ends it', () => {
    expect(promptParts('yes, I am (the one-word answer) — ___')).toEqual({
      before: 'yes, I am (the one-word answer) — ',
      after: '',
    });
  });

  it('treats a prompt with no blank as all "before", so nothing is ever lost', () => {
    expect(promptParts('no blank here')).toEqual({ before: 'no blank here', after: '' });
  });
});

describe('explainBlocks', () => {
  it('splits paragraphs on blank lines', () => {
    expect(explainBlocks('First line.\n\nSecond line.')).toEqual([
      { kind: 'paragraph', text: 'First line.' },
      { kind: 'paragraph', text: 'Second line.' },
    ]);
  });

  it('marks bullet lines so they can be rendered as a list', () => {
    expect(explainBlocks('Lead in.\n\n- Ја сам ту.\n- Ми смо ту.')).toEqual([
      { kind: 'paragraph', text: 'Lead in.' },
      { kind: 'bullet', text: 'Ја сам ту.' },
      { kind: 'bullet', text: 'Ми смо ту.' },
    ]);
  });

  it('keeps the numbers of a numbered list, which the content refers back to', () => {
    // `simple-questions` numbers the two ways to ask a yes-or-no question and
    // then discusses them by number. Without this branch the two lines joined
    // into one run-on paragraph.
    expect(explainBlocks('Two ways.\n\n1. **Да ли** first.\n2. Verb + ли.')).toEqual([
      { kind: 'paragraph', text: 'Two ways.' },
      { kind: 'bullet', text: 'Да ли first.', marker: '1.' },
      { kind: 'bullet', text: 'Verb + ли.', marker: '2.' },
    ]);
  });

  it('leaves a dash bullet unmarked, so the screen supplies the dot', () => {
    const [bullet] = explainBlocks('- шта — what');
    expect(bullet).toEqual({ kind: 'bullet', text: 'шта — what' });
    expect((bullet as { marker?: string }).marker).toBeUndefined();
  });

  it('does not mistake prose that opens with a number for a list', () => {
    // A marker is digits followed by `.` or `)` *and* a space. Neither an
    // ordinal nor a bare number at the start of a sentence is one.
    expect(explainBlocks('1st person singular.')).toEqual([
      { kind: 'paragraph', text: '1st person singular.' },
    ]);
    expect(explainBlocks('18 items drill this topic.')).toEqual([
      { kind: 'paragraph', text: '18 items drill this topic.' },
    ]);
  });

  it('strips the only two emphasis marks the content uses', () => {
    expect(explainBlocks('The **enclitic** form of *to be*.')).toEqual([
      { kind: 'paragraph', text: 'The enclitic form of to be.' },
    ]);
  });

  it('joins the lines of a wrapped paragraph', () => {
    expect(explainBlocks('one\ntwo')).toEqual([{ kind: 'paragraph', text: 'one two' }]);
  });

  it('has nothing to say about an empty explanation', () => {
    expect(explainBlocks('')).toEqual([]);
    expect(explainBlocks('\n\n  \n')).toEqual([]);
  });
});

describe('topicAccuracy', () => {
  it('is null until the topic has been drilled', () => {
    expect(topicAccuracy(undefined)).toBeNull();
    expect(topicAccuracy({ attempts: 0, correct: 0 })).toBeNull();
  });

  it('is the percentage of attempts answered right, rounded', () => {
    expect(topicAccuracy({ attempts: 10, correct: 7 })).toBe(70);
    expect(topicAccuracy({ attempts: 3, correct: 1 })).toBe(33);
    expect(topicAccuracy({ attempts: 20, correct: 20 })).toBe(100);
  });
});

describe('the bump_grammar_stats wire contract', () => {
  it('names the function PostgREST is asked for', () => {
    expect(BUMP_GRAMMAR_STATS_FN).toBe('bump_grammar_stats');
  });

  it('sends the three arguments the migration declares, and no user id', () => {
    const params = bumpGrammarStatsParams('topic-uuid', 10, 8);
    expect(params).toEqual({ p_topic_id: 'topic-uuid', p_attempts: 10, p_correct: 8 });
    expect(Object.keys(params)).not.toContain('p_user_id');
  });
});
