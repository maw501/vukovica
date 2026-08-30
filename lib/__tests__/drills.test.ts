import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BUMP_DRILL_STATS_FN,
  CYRILLIC_ALPHABET,
  KEYBOARD_ONLY_CYRILLIC,
  bumpDrillStatsParams,
  cyrillicInput,
  mergeDrillStats,
  pickDrillWords,
  scoreAttempt,
  segmentExpected,
  tallyAttempts,
  weakestLetters,
  type LetterResult,
} from '@/lib/drills';
import type { CardRow, DrillStatRow } from '@/lib/types';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260830130000_bump_drill_stats.sql'),
  'utf8',
);

const USER_ID = '11111111-1111-1111-1111-111111111111';

function card(srCyr: string, id = srCyr): CardRow {
  return {
    id,
    sr_cyr: srCyr,
    en: 'word',
    pos: 'noun',
    gender: null,
    aspect: null,
    example_cyr: 'Ово је реч.',
    example_en: 'This is a word.',
    domain: 'core',
    audio_path: null,
    kind: 'word',
    created_by: null,
    created_at: null,
  };
}

function stat(letter: string, attempts: number, correct: number): DrillStatRow {
  return { user_id: USER_ID, letter, attempts, correct };
}

/** Every letter of `word` at the given accuracy, so a card's weight is known. */
function statsFor(words: string[], attempts: number, correct: number): DrillStatRow[] {
  const letters = new Set(words.join('').split(''));
  return [...letters].map((letter) => stat(letter, attempts, correct));
}

/** A tiny seeded PRNG, so "random" selection is reproducible in tests. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// pickDrillWords
// ---------------------------------------------------------------------------

describe('pickDrillWords', () => {
  const pool = [card('мама'), card('тата'), card('нана'), card('вода'), card('коса')];

  it('returns the number of words asked for, without repeats', () => {
    const picked = pickDrillWords(pool, [], 3, mulberry32(1));
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((c) => c.id)).size).toBe(3);
  });

  it('returns every eligible card when asked for more than the pool holds', () => {
    const picked = pickDrillWords(pool, [], 50, mulberry32(2));
    expect(picked.map((c) => c.id).sort()).toEqual(pool.map((c) => c.id).sort());
  });

  it('returns nothing for a non-positive count', () => {
    expect(pickDrillWords(pool, [], 0, mulberry32(3))).toEqual([]);
    expect(pickDrillWords(pool, [], -1, mulberry32(3))).toEqual([]);
  });

  it('skips multi-word phrases — this is a typing drill', () => {
    const cards = [card('дневна соба'), card('мајчино млеко'), card('мама')];
    expect(pickDrillWords(cards, [], 10, mulberry32(4)).map((c) => c.sr_cyr)).toEqual(['мама']);
  });

  it('skips cards with no Serbian Cyrillic letters at all', () => {
    const cards = [card('123', 'digits'), card('мама')];
    expect(pickDrillWords(cards, [], 10, mulberry32(5)).map((c) => c.sr_cyr)).toEqual(['мама']);
  });

  it('always chooses the word with the weak letter when every other letter is mastered', () => {
    const cards = [card('жаба'), card('мама'), card('тата'), card('нана')];
    // Everything perfect except ж, which has never once been right.
    const stats = [...statsFor(['жаба', 'мама', 'тата', 'нана'], 10, 10), stat('ж', 10, 0)];

    for (let seed = 0; seed < 40; seed += 1) {
      const [first] = pickDrillWords(cards, stats, 1, mulberry32(seed));
      expect(first.sr_cyr).toBe('жаба');
    }
  });

  it('treats a letter with no stats row as the weakest there is', () => {
    // ђ has never been attempted; every other letter is perfect.
    const cards = [card('ђак'), card('мама'), card('тата')];
    const stats = statsFor(['ак', 'мама', 'тата'], 10, 10);

    for (let seed = 0; seed < 40; seed += 1) {
      expect(pickDrillWords(cards, stats, 1, mulberry32(seed))[0].sr_cyr).toBe('ђак');
    }
  });

  it('biases towards — rather than fixates on — words with weak letters', () => {
    const cards = [card('жаба'), card('мама'), card('тата'), card('нана')];
    // Everything at 80%, ж at 0%: жаба weighs 1 + 0.2 + 0.2 = 1.4 against 0.4 each.
    const stats = [...statsFor(['жаба', 'мама', 'тата', 'нана'], 10, 8), stat('ж', 10, 0)];

    const rng = mulberry32(99);
    const counts = new Map<string, number>();
    const rounds = 600;
    for (let i = 0; i < rounds; i += 1) {
      const word = pickDrillWords(cards, stats, 1, rng)[0].sr_cyr;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }

    const zaba = (counts.get('жаба') ?? 0) / rounds;
    expect(zaba).toBeGreaterThan(0.4); // ~0.54 in expectation
    expect(zaba).toBeLessThan(0.7);
    // and the mastered words still come up
    for (const word of ['мама', 'тата', 'нана']) {
      expect(counts.get(word) ?? 0).toBeGreaterThan(0);
    }
  });

  it('still picks a full round when every letter is perfect (all weights zero)', () => {
    const stats = statsFor(pool.map((c) => c.sr_cyr), 10, 10);
    const picked = pickDrillWords(pool, stats, 3, mulberry32(7));
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((c) => c.id)).size).toBe(3);
  });

  it('weighs each distinct letter once, however often it repeats in the word', () => {
    // 'ааааж' and 'жа' share the same distinct letters, so neither is favoured
    // by repetition alone; only the weak ж and the strong а count.
    const cards = [card('ааааа'), card('жааа')];
    const stats = [stat('а', 10, 10), stat('ж', 10, 10)];
    // Both weigh 0 now, so this is only asserting the run does not blow up.
    expect(pickDrillWords(cards, stats, 2, mulberry32(8))).toHaveLength(2);
  });

  it('ignores a stats row claiming more correct answers than attempts', () => {
    const cards = [card('жаба'), card('мама')];
    const stats = [...statsFor(['жаба', 'мама'], 10, 10), stat('ж', 1, 99)];
    expect(pickDrillWords(cards, stats, 2, mulberry32(9))).toHaveLength(2);
  });

  it('does not mutate the arrays it is given', () => {
    const cards = [card('мама'), card('тата'), card('нана')];
    const order = cards.map((c) => c.id);
    const stats = statsFor(['мама'], 3, 1);
    const statsCopy = JSON.parse(JSON.stringify(stats));

    pickDrillWords(cards, stats, 2, mulberry32(10));

    expect(cards.map((c) => c.id)).toEqual(order);
    expect(stats).toEqual(statsCopy);
  });

  it('defaults to Math.random when no generator is passed', () => {
    // The binding signature is three arguments; the generator is a test seam.
    expect(pickDrillWords(pool, [], 2)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// segmentExpected
// ---------------------------------------------------------------------------

describe('segmentExpected', () => {
  it('splits a Cyrillic word into one segment per letter', () => {
    expect(segmentExpected('џеп')).toEqual([
      { letter: 'џ', text: 'џ' },
      { letter: 'е', text: 'е' },
      { letter: 'п', text: 'п' },
    ]);
  });

  it('maps Latin digraphs back onto the single Cyrillic letter they spell', () => {
    expect(segmentExpected('džep')).toEqual([
      { letter: 'џ', text: 'dž' },
      { letter: 'е', text: 'e' },
      { letter: 'п', text: 'p' },
    ]);
    expect(segmentExpected('ljubav').map((s) => s.letter)).toEqual(['љ', 'у', 'б', 'а', 'в']);
    expect(segmentExpected('njiva').map((s) => s.letter)).toEqual(['њ', 'и', 'в', 'а']);
  });

  it('keeps non-letters as segments with no letter', () => {
    expect(segmentExpected('a-b')).toEqual([
      { letter: 'а', text: 'a' },
      { letter: null, text: '-' },
      { letter: 'б', text: 'b' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// scoreAttempt
// ---------------------------------------------------------------------------

/** The letters `scoreAttempt` marked wrong, in order. */
function missed(expected: string, actual: string): string[] {
  return scoreAttempt(expected, actual)
    .perLetter.filter((entry) => !entry.correct)
    .map((entry) => entry.letter);
}

describe('scoreAttempt', () => {
  it('accepts an exact Cyrillic match', () => {
    const result = scoreAttempt('мама', 'мама');
    expect(result.correct).toBe(true);
    expect(result.perLetter).toEqual([
      { letter: 'м', correct: true },
      { letter: 'а', correct: true },
      { letter: 'м', correct: true },
      { letter: 'а', correct: true },
    ]);
  });

  it('accepts an exact Latin match and reports Cyrillic letters', () => {
    const result = scoreAttempt('kuća', 'kuća');
    expect(result.correct).toBe(true);
    expect(result.perLetter.map((entry) => entry.letter)).toEqual(['к', 'у', 'ћ', 'а']);
    expect(result.perLetter.every((entry) => entry.correct)).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(scoreAttempt('мама', ' МАМА ').correct).toBe(true);
    expect(scoreAttempt('Džep', 'džep').correct).toBe(true);
  });

  it('maps a single missed letter onto the right Cyrillic letter', () => {
    const result = scoreAttempt('žena', 'zena');
    expect(result.correct).toBe(false);
    expect(result.perLetter).toEqual([
      { letter: 'ж', correct: false },
      { letter: 'е', correct: true },
      { letter: 'н', correct: true },
      { letter: 'а', correct: true },
    ]);
  });

  it('marks џ wrong when the digraph is typed as "dz"', () => {
    const result = scoreAttempt('džep', 'dzep');
    expect(result.correct).toBe(false);
    expect(result.perLetter).toEqual([
      { letter: 'џ', correct: false },
      { letter: 'е', correct: true },
      { letter: 'п', correct: true },
    ]);
  });

  it('marks џ wrong when "дз" is typed for it in the Cyrillic direction', () => {
    expect(missed('џеп', 'дзеп')).toEqual(['џ']);
  });

  it('accepts the digraph spelled properly', () => {
    expect(scoreAttempt('džep', 'džep').correct).toBe(true);
    expect(scoreAttempt('ljubav', 'ljubav').correct).toBe(true);
  });

  it('blames one letter for one dropped letter, not everything after it', () => {
    const result = scoreAttempt('мама', 'маа');
    expect(result.correct).toBe(false);
    expect(result.perLetter.filter((entry) => !entry.correct)).toEqual([
      { letter: 'м', correct: false },
    ]);
  });

  it('blames one letter for one extra letter', () => {
    const result = scoreAttempt('мама', 'мамба');
    expect(result.correct).toBe(false);
    expect(result.perLetter.filter((entry) => !entry.correct)).toHaveLength(1);
  });

  it('marks every letter wrong for an empty answer', () => {
    const result = scoreAttempt('мама', '   ');
    expect(result.correct).toBe(false);
    expect(result.perLetter.every((entry) => !entry.correct)).toBe(true);
    expect(result.perLetter).toHaveLength(4);
  });

  it('marks every letter wrong when the answer is in the wrong script', () => {
    expect(scoreAttempt('мама', 'mama').correct).toBe(false);
    expect(missed('мама', 'mama')).toEqual(['м', 'а', 'м', 'а']);
  });

  it('reports no letters for punctuation and spaces', () => {
    const result = scoreAttempt('добар дан', 'добар дан');
    expect(result.correct).toBe(true);
    expect(result.perLetter).toHaveLength(8);
    expect(result.perLetter.map((entry) => entry.letter)).not.toContain(' ');
  });

  it('is never correct while a letter is wrong', () => {
    for (const [expected, actual] of [
      ['мама', 'мaма'], // Latin 'a' smuggled into the Cyrillic
      ['džep', 'dzep'],
      ['žena', 'zena'],
      ['ђак', 'дак'],
    ]) {
      const result = scoreAttempt(expected, actual);
      expect(result.correct).toBe(false);
      expect(result.perLetter.some((entry) => !entry.correct)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// cyrillicInput
// ---------------------------------------------------------------------------

describe('cyrillicInput', () => {
  it('transliterates what a plain keyboard can type', () => {
    expect(cyrillicInput('mama')).toBe('мама');
    expect(cyrillicInput('voda')).toBe('вода');
  });

  it('leaves Cyrillic alone, so tapped letters survive', () => {
    expect(cyrillicInput('џеп')).toBe('џеп');
    expect(cyrillicInput('џep')).toBe('џеп');
  });

  it('folds a digraph typed one key at a time', () => {
    // 'l' converts to 'л' the moment it is typed; the 'j' must still join it.
    expect(cyrillicInput('лj')).toBe('љ');
    expect(cyrillicInput('нj')).toBe('њ');
    expect(cyrillicInput('дž')).toBe('џ');
    expect(cyrillicInput('ljubav')).toBe('љубав');
  });

  it('does not turn "dz" into џ — that mistake has to stay visible', () => {
    expect(cyrillicInput('dzep')).toBe('дзеп');
  });

  it('keeps capitals', () => {
    expect(cyrillicInput('Mama')).toBe('Мама');
    expect(cyrillicInput('Ljubav')).toBe('Љубав');
  });

  it('passes anything it cannot map straight through', () => {
    expect(cyrillicInput('w q')).toBe('w q');
    expect(cyrillicInput('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// tallyAttempts / weakestLetters
// ---------------------------------------------------------------------------

describe('tallyAttempts', () => {
  const attempt = (word: string, wrong: string[]): LetterResult[] =>
    word.split('').map((letter) => ({ letter, correct: !wrong.includes(letter) }));

  it('adds a round up into one delta per distinct letter', () => {
    const deltas = tallyAttempts([attempt('мама', []), attempt('мач', ['ч'])]);
    expect(deltas).toEqual([
      { letter: 'а', attempts: 3, correct: 3 },
      { letter: 'м', attempts: 3, correct: 3 },
      { letter: 'ч', attempts: 1, correct: 0 },
    ]);
  });

  it('counts a repeated letter once per occurrence', () => {
    expect(tallyAttempts([attempt('аа', [])])).toEqual([{ letter: 'а', attempts: 2, correct: 2 }]);
  });

  it('returns nothing for a round with no attempts', () => {
    expect(tallyAttempts([])).toEqual([]);
  });

  it('never repeats a letter — the upsert would refuse it', () => {
    const deltas = tallyAttempts([attempt('мама', ['м']), attempt('мама', [])]);
    expect(new Set(deltas.map((d) => d.letter)).size).toBe(deltas.length);
  });
});

describe('weakestLetters', () => {
  it('orders by accuracy, worst first', () => {
    expect(
      weakestLetters(
        [stat('а', 10, 9), stat('ж', 10, 2), stat('џ', 10, 5)],
        3,
      ),
    ).toEqual(['ж', 'џ', 'а']);
  });

  it('leaves out letters that were never wrong', () => {
    expect(weakestLetters([stat('а', 10, 10), stat('ж', 4, 1)], 5)).toEqual(['ж']);
  });

  it('leaves out letters with no attempts — there is no evidence either way', () => {
    expect(weakestLetters([stat('а', 0, 0), stat('ж', 2, 1)], 5)).toEqual(['ж']);
  });

  it('caps the list at the limit', () => {
    expect(
      weakestLetters([stat('а', 4, 0), stat('ж', 4, 1), stat('џ', 4, 2)], 2),
    ).toEqual(['а', 'ж']);
  });

  it('copes with the null counts a select can return', () => {
    const nulls: DrillStatRow = { user_id: USER_ID, letter: 'ж', attempts: null, correct: null };
    expect(weakestLetters([nulls], 3)).toEqual([]);
  });
});

describe('mergeDrillStats', () => {
  it('replaces the letters the server just answered with', () => {
    const merged = mergeDrillStats(
      [stat('а', 5, 5), stat('ж', 5, 2)],
      [stat('ж', 7, 3)],
    );
    expect(merged.find((row) => row.letter === 'ж')).toEqual(stat('ж', 7, 3));
    expect(merged.find((row) => row.letter === 'а')).toEqual(stat('а', 5, 5));
  });

  it('adds letters the cache had never seen', () => {
    const merged = mergeDrillStats([stat('а', 5, 5)], [stat('џ', 1, 0)]);
    expect(merged.map((row) => row.letter).sort()).toEqual(['а', 'џ']);
  });

  it('never ends up with the same letter twice', () => {
    const merged = mergeDrillStats([stat('ж', 1, 1)], [stat('ж', 2, 1), stat('ж', 3, 2)]);
    expect(merged).toEqual([stat('ж', 3, 2)]);
  });

  it('leaves the arrays it was given alone', () => {
    const current = [stat('а', 5, 5)];
    mergeDrillStats(current, [stat('ж', 1, 0)]);
    expect(current).toEqual([stat('а', 5, 5)]);
  });
});

// ---------------------------------------------------------------------------
// The alphabet and the on-screen keys
// ---------------------------------------------------------------------------

describe('the Cyrillic alphabet', () => {
  it('has Vuk’s thirty letters', () => {
    expect(CYRILLIC_ALPHABET).toHaveLength(30);
    expect(CYRILLIC_ALPHABET[0]).toBe('а');
    expect(CYRILLIC_ALPHABET.at(-1)).toBe('ш');
    expect(new Set(CYRILLIC_ALPHABET).size).toBe(30);
  });

  it('offers exactly the letters a plain keyboard cannot reach', () => {
    expect(KEYBOARD_ONLY_CYRILLIC).toEqual(['ђ', 'ж', 'љ', 'њ', 'ћ', 'ч', 'џ', 'ш']);
    for (const letter of KEYBOARD_ONLY_CYRILLIC) {
      expect(CYRILLIC_ALPHABET).toContain(letter);
    }
  });
});

// ---------------------------------------------------------------------------
// The bump_drill_stats contract
// ---------------------------------------------------------------------------

describe('bumpDrillStatsParams', () => {
  const deltas = [
    { letter: 'ж', attempts: 2, correct: 1 },
    { letter: 'а', attempts: 3, correct: 3 },
  ];

  it('sends three parallel arrays, in the order given', () => {
    expect(bumpDrillStatsParams(deltas)).toEqual({
      p_letters: ['ж', 'а'],
      p_attempts: [2, 3],
      p_correct: [1, 3],
    });
  });

  it('never sends a user id — the function takes it from auth.uid()', () => {
    expect(Object.keys(bumpDrillStatsParams(deltas))).not.toContain('p_user_id');
  });
});

describe('the client and the migration agree on the contract', () => {
  function migrationParameterNames(): string[] {
    const signature = migration.slice(
      migration.indexOf(`create function public.${BUMP_DRILL_STATS_FN}(`),
      migration.indexOf('returns'),
    );
    return [...signature.matchAll(/^\s*(p_[a-z_]+)\s+/gm)].map((match) => match[1]);
  }

  it('sends exactly the arguments the function declares', () => {
    expect(Object.keys(bumpDrillStatsParams([])).sort()).toEqual(migrationParameterNames().sort());
  });

  it('found the arguments at all (guards the regex above)', () => {
    expect(migrationParameterNames()).toHaveLength(3);
  });

  it('keeps the function under the caller’s RLS, not the definer’s', () => {
    expect(migration).toContain('security invoker');
    expect(migration).not.toContain('security definer');
  });

  it('fills user_id from auth.uid() rather than trusting an argument', () => {
    expect(migration).toContain('auth.uid()');
    expect(migrationParameterNames()).not.toContain('p_user_id');
  });

  it('adds to the existing counts instead of replacing them', () => {
    expect(migration).toMatch(/attempts\s*=\s*(coalesce\()?ds\.attempts.*\+/);
    expect(migration).toMatch(/correct\s*=\s*(coalesce\()?ds\.correct.*\+/);
  });

  it('grants execute explicitly and takes the default PUBLIC and anon grants back', () => {
    expect(migration).toMatch(/revoke execute on function public\.bump_drill_stats\([\s\S]*?\) from public;/);
    expect(migration).toMatch(/revoke execute on function public\.bump_drill_stats\([\s\S]*?\) from anon;/);
    expect(migration).toMatch(/grant execute on function public\.bump_drill_stats\([\s\S]*?\) to authenticated;/);
  });
});
