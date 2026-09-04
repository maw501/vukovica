import { describe, expect, it } from 'vitest';

import { CYRILLIC_ALPHABET } from '@/lib/drills';
import {
  computeProgress,
  KNOWN_MILESTONES,
  LETTER_TOTAL,
  masteredLetters,
  STORY_MILESTONES,
  WEAKEST_LIMIT,
  type Progress,
  type ProgressInputs,
} from '@/lib/stages';
import { LETTER_SOLID_STREAK } from '@/lib/letters';
import { cyrToLat } from '@/lib/transliterate';
import type { DrillStatRow, LetterStatRow } from '@/lib/types';

const USER = '00000000-0000-0000-0000-000000000001';

function stat(letter: string, attempts: number | null, correct: number | null): DrillStatRow {
  return { user_id: USER, letter, attempts, correct };
}

/**
 * A `letter_stats` row, keyed the way the drill keys them: by the printed pair.
 * `solid` at or past `LETTER_SOLID_STREAK` is what the stage union looks for.
 */
function letterStat(glyph: string, streak: number): LetterStatRow {
  return {
    user_id: USER,
    letter: `${glyph.toUpperCase()} ${glyph}`,
    easy: streak,
    hard: 0,
    streak,
    last_seen: null,
  };
}

/** Those letters solid in the drill, and nothing else. */
function solid(...glyphs: readonly string[]): LetterStatRow[] {
  return glyphs.map((glyph) => letterStat(glyph, LETTER_SOLID_STREAK));
}

/**
 * Drill stats that master every letter of the alphabet except the named ones,
 * which are left with no row at all (i.e. unattempted).
 */
function masteredExcept(...except: readonly string[]): DrillStatRow[] {
  return CYRILLIC_ALPHABET.filter((letter) => !except.includes(letter)).map((letter) =>
    stat(letter, 10, 10),
  );
}

/** The whole alphabet mastered, which is what most stage cases start from. */
function allMastered(): DrillStatRow[] {
  return masteredExcept();
}

function progress(over: Partial<ProgressInputs> = {}): Progress {
  return computeProgress({
    drillStats: allMastered(),
    letterStats: [],
    knownWords: 0,
    storiesRead: 0,
    booksFinished: 0,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// The alphabet the stage logic counts against
// ---------------------------------------------------------------------------

describe('the thirty letters', () => {
  it('is the transliterator’s alphabet, all thirty of it', () => {
    expect(LETTER_TOTAL).toBe(30);
    expect(CYRILLIC_ALPHABET).toHaveLength(LETTER_TOTAL);

    // Cross-check against `lib/transliterate.ts`: every letter we count has a
    // Latin form in that mapping table (an unmapped character passes through
    // unchanged), and no two letters share one.
    const latin = CYRILLIC_ALPHABET.map((letter) => cyrToLat(letter));
    for (const [index, letter] of CYRILLIC_ALPHABET.entries()) {
      expect(latin[index]).not.toBe(letter);
    }
    expect(new Set(latin).size).toBe(LETTER_TOTAL);
  });

  it('always reports 30 as the total, whatever the stats say', () => {
    expect(progress({ drillStats: [] }).letterMastery.total).toBe(30);
    expect(progress().letterMastery.total).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Mastery: attempts >= 8 AND correct/attempts >= 0.9
// ---------------------------------------------------------------------------

describe('letter mastery', () => {
  it('masters a letter at exactly 8 attempts', () => {
    expect(progress({ drillStats: [stat('а', 8, 8)] }).letterMastery.mastered).toBe(1);
  });

  it('does not master a perfect letter at 7 attempts', () => {
    expect(progress({ drillStats: [stat('а', 7, 7)] }).letterMastery.mastered).toBe(0);
  });

  it('masters at exactly 0.9 accuracy', () => {
    expect(progress({ drillStats: [stat('а', 10, 9)] }).letterMastery.mastered).toBe(1);
    // 27/30 is 0.9 too -- the same boundary reached by a different division.
    expect(progress({ drillStats: [stat('а', 30, 27)] }).letterMastery.mastered).toBe(1);
  });

  it('does not master just below 0.9', () => {
    expect(progress({ drillStats: [stat('а', 1000, 899)] }).letterMastery.mastered).toBe(0);
    expect(progress({ drillStats: [stat('а', 10, 8)] }).letterMastery.mastered).toBe(0);
  });

  it('treats null counters as zero', () => {
    const stats = [stat('а', null, null), stat('б', 10, null), stat('в', null, 10)];
    expect(progress({ drillStats: stats }).letterMastery.mastered).toBe(0);
  });

  it('clamps a row claiming more correct answers than attempts', () => {
    // Nonsense data, but it must not read as "not mastered" through a >1 ratio
    // sneaking past some other comparison, nor blow the count up.
    expect(progress({ drillStats: [stat('а', 10, 40)] }).letterMastery.mastered).toBe(1);
  });

  it('ignores rows for characters outside the alphabet', () => {
    const stats = [...allMastered(), stat('q', 100, 100), stat('ы', 100, 100)];
    expect(progress({ drillStats: stats }).letterMastery.mastered).toBe(30);
  });

  it('counts a duplicated letter once', () => {
    const stats = [stat('а', 10, 10), stat('а', 10, 10)];
    expect(progress({ drillStats: stats }).letterMastery.mastered).toBe(1);
  });

  it('exposes the mastered set for the trainer summary', () => {
    const set = masteredLetters([stat('а', 8, 8), stat('б', 7, 7), stat('q', 99, 99)]);
    expect(set.has('а')).toBe(true);
    expect(set.has('б')).toBe(false);
    expect(set.has('q')).toBe(false);
    expect(set.size).toBe(1);
  });

  it('does not mutate its input', () => {
    const stats = [stat('а', 8, 8)];
    const letters = solid('б');
    const before = JSON.stringify([stats, letters]);
    computeProgress({
      drillStats: stats,
      letterStats: letters,
      knownWords: 5,
      storiesRead: 2,
      booksFinished: 0,
    });
    expect(JSON.stringify([stats, letters])).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The union: a letter is done if EITHER the trainer or the drill says so
//
// The two bars measure different things -- typing a letter, and recognising it
// -- so neither subsumes the other. Before this, the Alphabet stage could insist
// "0 of 30" directly above a drill tile reading "25 of 30 solid".
// ---------------------------------------------------------------------------

describe('letter mastery counts the drill too', () => {
  it('counts a letter solid in the drill that the trainer has never seen', () => {
    expect(progress({ drillStats: [], letterStats: solid('а', 'б') }).letterMastery.mastered).toBe(
      2,
    );
  });

  it('still counts a letter mastered in the trainer that the drill has never seen', () => {
    expect(
      progress({ drillStats: [stat('а', 8, 8)], letterStats: [] }).letterMastery.mastered,
    ).toBe(1);
  });

  it('counts a letter both agree on exactly once', () => {
    expect(
      progress({ drillStats: [stat('а', 8, 8)], letterStats: solid('а') }).letterMastery.mastered,
    ).toBe(1);
  });

  it('does not count a letter the drill is still short of solid on', () => {
    const nearly = [letterStat('а', LETTER_SOLID_STREAK - 1)];
    expect(progress({ drillStats: [], letterStats: nearly }).letterMastery.mastered).toBe(0);
  });

  it('ignores a tally row for something that is not one of the thirty', () => {
    const junk = [letterStat('q', LETTER_SOLID_STREAK), letterStat('', LETTER_SOLID_STREAK)];
    expect(progress({ drillStats: [], letterStats: junk }).letterMastery.mastered).toBe(0);
  });

  it('leaves the alphabet stage when the drill supplies the last letter', () => {
    const inputs = { drillStats: masteredExcept('ш'), knownWords: 5 };
    expect(progress(inputs).stage).toBe('alphabet');
    expect(progress({ ...inputs, letterStats: solid('ш') }).stage).toBe('words');
  });

  it('drops a drill-solid letter out of the weakest list', () => {
    const drillStats = masteredExcept('а', 'б', 'в');
    expect(progress({ drillStats }).letterMastery.weakest).toEqual(['а', 'б', 'в']);
    expect(progress({ drillStats, letterStats: solid('б') }).letterMastery.weakest).toEqual([
      'а',
      'в',
    ]);
  });

  it('reads the same union through masteredLetters, for the trainer summary', () => {
    const set = masteredLetters([stat('а', 8, 8)], solid('б'));
    expect([...set].sort()).toEqual(['а', 'б']);
    // Called with drill stats alone -- as the trainer does -- it stays the
    // trainer's own bar, so the trainer never celebrates a letter it did not
    // just measure.
    expect([...masteredLetters([stat('а', 8, 8)])]).toEqual(['а']);
  });
});

// ---------------------------------------------------------------------------
// The weakest letters -- what the trainer should drill next
// ---------------------------------------------------------------------------

describe('weakest letters', () => {
  it('is empty once every letter is mastered', () => {
    expect(progress().letterMastery.weakest).toEqual([]);
  });

  it('sorts unmastered letters by accuracy ascending, unattempted first', () => {
    const stats = [
      ...masteredExcept('б', 'в', 'г', 'д', 'ђ'),
      stat('б', 10, 1), // 0.1
      stat('в', 10, 5), // 0.5
      stat('г', 10, 3), // 0.3
      // 'д' has no row at all -- unattempted, which counts as accuracy 0.
      stat('ђ', 7, 7), // 1.0, but too few attempts to be mastered
    ];
    expect(progress({ drillStats: stats }).letterMastery.weakest).toEqual([
      'д',
      'б',
      'г',
      'в',
      'ђ',
    ]);
  });

  it('breaks ties in alphabet order', () => {
    // Nothing attempted at all: every letter is accuracy 0, so the first five
    // of Vuk's alphabet are what comes back.
    expect(progress({ drillStats: [] }).letterMastery.weakest).toEqual([
      'а',
      'б',
      'в',
      'г',
      'д',
    ]);
  });

  it('returns at most five', () => {
    const unmastered = ['а', 'б', 'в', 'г', 'д', 'ђ', 'е'];
    const stats = [
      ...masteredExcept(...unmastered),
      ...unmastered.map((letter, index) => stat(letter, 10, index + 1)),
    ];
    const { weakest } = progress({ drillStats: stats }).letterMastery;
    expect(weakest).toHaveLength(WEAKEST_LIMIT);
    expect(weakest).toEqual(['а', 'б', 'в', 'г', 'д']);
  });

  it('lists every unmastered letter when there are fewer than five', () => {
    const stats = masteredExcept('ш', 'а');
    expect(progress({ drillStats: stats }).letterMastery.weakest).toEqual(['а', 'ш']);
  });
});

// ---------------------------------------------------------------------------
// Which stage the dashboard leads with
// ---------------------------------------------------------------------------

describe('stage', () => {
  it('is alphabet while a single letter is unmastered, whatever else is done', () => {
    const stats = masteredExcept('ш');
    expect(progress({ drillStats: stats }).stage).toBe('alphabet');
    expect(progress({ drillStats: stats, knownWords: 900, storiesRead: 40 }).stage).toBe(
      'alphabet',
    );
    expect(progress({ drillStats: stats }).letterMastery.mastered).toBe(29);
  });

  it('leaves alphabet the moment the thirtieth letter is mastered', () => {
    expect(progress().letterMastery.mastered).toBe(30);
    expect(progress().stage).toBe('words');
  });

  it('is words at 99 known words and reading at exactly 100', () => {
    expect(progress({ knownWords: 99 }).stage).toBe('words');
    expect(progress({ knownWords: 100 }).stage).toBe('reading');
  });

  it('needs both 300 words and 5 stories for books', () => {
    expect(progress({ knownWords: 299, storiesRead: 5 }).stage).toBe('reading');
    expect(progress({ knownWords: 300, storiesRead: 4 }).stage).toBe('reading');
    expect(progress({ knownWords: 300, storiesRead: 5 }).stage).toBe('books');
    expect(progress({ knownWords: 800, storiesRead: 30 }).stage).toBe('books');
  });

  it('stays on books once it is reached, however many books are finished', () => {
    // The stage is where he reads real books; finishing one must not end it.
    const inputs = { knownWords: 300, storiesRead: 5 };
    expect(progress({ ...inputs, booksFinished: 0 }).stage).toBe('books');
    expect(progress({ ...inputs, booksFinished: 1 }).stage).toBe('books');
    expect(progress({ ...inputs, booksFinished: 50 }).stage).toBe('books');
  });

  it('does not let a finished book pull any earlier stage forward', () => {
    expect(progress({ knownWords: 0, storiesRead: 0, booksFinished: 9 }).stage).toBe('words');
    expect(progress({ knownWords: 150, storiesRead: 1, booksFinished: 9 }).stage).toBe('reading');
  });

  it('sends a books-ready learner back to alphabet if letters lapse out of view', () => {
    // The alphabet gates everything: it is the first stage and it is "until".
    const stats = masteredExcept('њ', 'џ');
    expect(progress({ drillStats: stats, knownWords: 400, storiesRead: 9 }).stage).toBe('alphabet');
  });
});

// ---------------------------------------------------------------------------
// The two goal ladders
// ---------------------------------------------------------------------------

describe('knownMilestone', () => {
  it('is the ladder rung the learner has not yet reached', () => {
    expect(KNOWN_MILESTONES).toEqual([100, 300, 600]);
    expect(progress({ knownWords: 0 }).knownMilestone).toBe(100);
    expect(progress({ knownWords: 99 }).knownMilestone).toBe(100);
    expect(progress({ knownWords: 100 }).knownMilestone).toBe(300);
    expect(progress({ knownWords: 299 }).knownMilestone).toBe(300);
    expect(progress({ knownWords: 300 }).knownMilestone).toBe(600);
    expect(progress({ knownWords: 599 }).knownMilestone).toBe(600);
  });

  it('stops at the top rung', () => {
    expect(progress({ knownWords: 600 }).knownMilestone).toBe(600);
    expect(progress({ knownWords: 5000 }).knownMilestone).toBe(600);
  });
});

describe('storyMilestone', () => {
  it('is the ladder rung the learner has not yet reached', () => {
    expect(STORY_MILESTONES).toEqual([1, 5, 20]);
    expect(progress({ storiesRead: 0 }).storyMilestone).toBe(1);
    expect(progress({ storiesRead: 1 }).storyMilestone).toBe(5);
    expect(progress({ storiesRead: 4 }).storyMilestone).toBe(5);
    expect(progress({ storiesRead: 5 }).storyMilestone).toBe(20);
    expect(progress({ storiesRead: 19 }).storyMilestone).toBe(20);
  });

  it('stops at the top rung', () => {
    expect(progress({ storiesRead: 20 }).storyMilestone).toBe(20);
    expect(progress({ storiesRead: 200 }).storyMilestone).toBe(20);
  });
});

describe('the counts it passes through', () => {
  it('reports the words, stories and books it was given', () => {
    const result = progress({ knownWords: 137, storiesRead: 3, booksFinished: 2 });
    expect(result.knownWords).toBe(137);
    expect(result.storiesRead).toBe(3);
    expect(result.booksFinished).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// nextGoal -- the one line the dashboard renders verbatim
// ---------------------------------------------------------------------------

describe('nextGoal', () => {
  it('names the alphabet, how many are solid and how many are left', () => {
    const goal = progress({ drillStats: masteredExcept('п', 'р', 'с', 'т') }).nextGoal;
    expect(goal).toBe('Alphabet — 26 of 30 letters mastered, 4 to go');
  });

  it('says the same thing however the letters were learnt', () => {
    // Two of the four come from the drill instead: the line must not change
    // shape, and must not double-count.
    const goal = progress({
      drillStats: masteredExcept('п', 'р', 'с', 'т'),
      letterStats: solid('п', 'р'),
    }).nextGoal;
    expect(goal).toBe('Alphabet — 28 of 30 letters mastered, 2 to go');
  });

  it('never asks for zero more letters — the stage ends first', () => {
    const goal = progress({ drillStats: masteredExcept('ш') }).nextGoal;
    expect(goal).toBe('Alphabet — 29 of 30 letters mastered, 1 to go');
    expect(goal).not.toContain('0 to go');
  });

  it('names the words stage and the 100-word rung', () => {
    const goal = progress({ knownWords: 88 }).nextGoal;
    expect(goal).toContain('Words');
    expect(goal).toContain('12');
    expect(goal).toContain('88/100');
  });

  it('names the reading stage and the next story rung', () => {
    const goal = progress({ knownWords: 150, storiesRead: 2 }).nextGoal;
    expect(goal).toContain('Reading');
    expect(goal).toContain('3');
    expect(goal).toContain('2/5');
  });

  it('says "story", not "stories", for the last one', () => {
    const goal = progress({ knownWords: 150, storiesRead: 0 }).nextGoal;
    expect(goal).toContain('1 more story');
    expect(goal).not.toContain('stories');
  });

  it('points at the words when the story ladder tops out inside Reading', () => {
    // Twenty stories read on a vocabulary still short of 300: the ladder is
    // finished but the stage is not, and "read 0 more stories (25/20)" would be
    // no goal at all.
    const result = progress({ knownWords: 255, storiesRead: 25 });
    expect(result.stage).toBe('reading');
    expect(result.nextGoal).toContain('Reading');
    expect(result.nextGoal).not.toContain('0 more');
    expect(result.nextGoal).toContain('45');
    expect(result.nextGoal).toContain('255/300');
  });

  it('says "word", not "words", for the last one to Books', () => {
    const goal = progress({ knownWords: 299, storiesRead: 20 }).nextGoal;
    expect(goal).toContain('1 word');
    expect(goal).not.toContain('1 words');
  });

  it('is the book itself, word for word, once the books stage is reached', () => {
    // The capstone. Spelled out here rather than imported, so a typo in the
    // title fails the test rather than travelling with it.
    expect(progress({ knownWords: 300, storiesRead: 5 }).nextGoal).toBe(
      'Read Погоди колико те волим to your son',
    );
    // ...and it does not drift once books start being finished.
    expect(progress({ knownWords: 900, storiesRead: 40, booksFinished: 3 }).nextGoal).toBe(
      'Read Погоди колико те волим to your son',
    );
  });

  it('is English chrome everywhere except that one book title', () => {
    const cases: Partial<ProgressInputs>[] = [
      { drillStats: [] },
      { knownWords: 88 },
      { knownWords: 150, storiesRead: 2 },
      { knownWords: 255, storiesRead: 25 },
    ];
    for (const input of cases) {
      expect(progress(input).nextGoal).not.toMatch(/\p{Script=Cyrillic}/u);
    }
  });

  it('is always a single non-empty line', () => {
    const cases: Partial<ProgressInputs>[] = [
      { drillStats: [] },
      { drillStats: masteredExcept('ш') },
      { knownWords: 0 },
      { knownWords: 99 },
      { knownWords: 100, storiesRead: 0 },
      { knownWords: 150, storiesRead: 19 },
      { knownWords: 150, storiesRead: 20 },
      { knownWords: 255, storiesRead: 25 },
      { knownWords: 299, storiesRead: 20 },
      { knownWords: 300, storiesRead: 5 },
      { knownWords: 5000, storiesRead: 500 },
    ];
    for (const input of cases) {
      const goal = progress(input).nextGoal;
      expect(goal.trim()).toBe(goal);
      expect(goal.length).toBeGreaterThan(0);
      expect(goal).not.toContain('\n');
      expect(goal.length).toBeLessThanOrEqual(60);
    }
  });
});
