import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildRun,
  hintWithoutExample,
  isSolid,
  letterGlyph,
  letterKey,
  LETTER_SOLID_STREAK,
  RATE_LETTER_FN,
  rateLetterParams,
  runSummary,
  shuffle,
  solidCount,
  solidGlyphs,
  statFor,
  statsByLetter,
  trickyCards,
  UNRATED,
  type LetterStat,
} from '@/lib/letters';
import type { CardRow, LetterStatRow } from '@/lib/types';
import { XP_AWARDS } from '@/lib/xp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The thirty letters as authored — the source `cards.en` was seeded from, and
 * therefore the only honest input for a test of what `hintWithoutExample` does
 * to a *real* hint.
 */
const lettersJson: { cyr_pair: string; en: string; example_cyr: string }[] = JSON.parse(
  readFileSync(path.join(repoRoot, 'data', 'phase3', 'letters.json'), 'utf8'),
);

function letterCard(pair: string): CardRow {
  return {
    id: `card-${pair}`,
    sr_cyr: pair,
    en: `the sound of ${pair}`,
    pos: 'letter',
    gender: null,
    aspect: null,
    example_cyr: 'реч',
    example_en: 'word',
    domain: 'alphabet',
    audio_path: null,
    kind: 'letter',
    created_by: null,
    created_at: null,
  };
}

function statRow(letter: string, stat: Partial<LetterStatRow>): LetterStatRow {
  return {
    user_id: 'u1',
    letter,
    easy: 0,
    hard: 0,
    streak: 0,
    last_seen: null,
    ...stat,
  };
}

/** A tally map from plain literals, for the ordering tests. */
function tallies(entries: Record<string, Partial<LetterStat>>): Map<string, LetterStat> {
  return new Map(
    Object.entries(entries).map(([letter, stat]) => [letter, { ...UNRATED, ...stat }]),
  );
}

/**
 * A generator that walks a fixed cycle, so a shuffle is reproducible without
 * pinning it to one implementation's exact call pattern.
 */
function cyclingRng(values: readonly number[]) {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('letterKey', () => {
  it('tallies a letter under the card’s printed pair', () => {
    // Not "б": the pair is `cards.sr_cyr`, which is unique, and it cannot be
    // confused with a `drill_stats.letter` (the trainer's single glyph).
    expect(letterKey(letterCard('Б б'))).toBe('Б б');
  });
});

describe('statsByLetter', () => {
  it('indexes the rows by letter', () => {
    const stats = statsByLetter([
      statRow('А а', { easy: 3, hard: 1, streak: 2 }),
      statRow('Б б', { easy: 1, hard: 0, streak: 1 }),
    ]);
    expect(stats.get('А а')).toEqual({ easy: 3, hard: 1, streak: 2 });
    expect(stats.get('Б б')).toEqual({ easy: 1, hard: 0, streak: 1 });
  });

  it('reads a null count as zero', () => {
    const stats = statsByLetter([statRow('В в', { easy: null, hard: null, streak: null })]);
    expect(stats.get('В в')).toEqual(UNRATED);
  });

  it('refuses to believe a negative count', () => {
    const stats = statsByLetter([statRow('Г г', { easy: -4, hard: -1, streak: -9 })]);
    expect(stats.get('Г г')).toEqual(UNRATED);
  });

  it('is empty for a user who has never rated anything', () => {
    expect(statsByLetter([]).size).toBe(0);
  });
});

describe('statFor', () => {
  it('gives a never-rated letter a blank tally rather than undefined', () => {
    expect(statFor(letterCard('Д д'), new Map())).toEqual(UNRATED);
  });
});

describe('isSolid', () => {
  it('needs three right in a row', () => {
    expect(LETTER_SOLID_STREAK).toBe(3);
    expect(isSolid({ easy: 9, hard: 0, streak: 2 })).toBe(false);
    expect(isSolid({ easy: 3, hard: 5, streak: 3 })).toBe(true);
    expect(isSolid({ easy: 30, hard: 0, streak: 12 })).toBe(true);
  });

  it('does not care how many times the letter was got right in total', () => {
    // Nine right and then one wrong is not solid: the streak is what counts.
    expect(isSolid({ easy: 9, hard: 1, streak: 0 })).toBe(false);
  });
});

describe('solidCount and trickyCards', () => {
  const cards = ['А а', 'Б б', 'В в'].map(letterCard);
  const stats = tallies({
    'А а': { easy: 4, streak: 4 },
    'Б б': { easy: 1, hard: 2, streak: 0 },
  });

  it('counts the solid ones', () => {
    expect(solidCount(cards, stats)).toBe(1);
  });

  it('counts an empty alphabet as none solid', () => {
    expect(solidCount([], stats)).toBe(0);
  });

  it('leaves the rest — rated or not — as the tricky ones', () => {
    expect(trickyCards(cards, stats).map((card) => card.sr_cyr)).toEqual(['Б б', 'В в']);
  });
});

describe('buildRun', () => {
  const cards = ['А а', 'Б б', 'В в', 'Г г', 'Д д'].map(letterCard);

  it('has every letter in it, always', () => {
    // The whole point of the drill: nothing is ever withheld, whatever the
    // tallies say. No allowance, no "due", no waiting until tomorrow.
    const run = buildRun({ cards, stats: tallies({ 'А а': { easy: 50, streak: 50 } }) });
    expect(run).toHaveLength(cards.length);
    expect(new Set(run.map((card) => card.sr_cyr))).toEqual(
      new Set(cards.map((card) => card.sr_cyr)),
    );
  });

  it('leads with the letters missed last time, then the unseen ones, then the rest', () => {
    const stats = tallies({
      'А а': { easy: 6, streak: 6 }, // solid, so last
      'Б б': { easy: 1, hard: 3, streak: 0 }, // missed last time -> first
      'В в': { easy: 2, hard: 0, streak: 2 }, // going well, but not solid
      'Г г': { easy: 0, hard: 1, streak: 0 }, // missed last time -> first
      // Д д has no row at all -> never rated
    });
    const run = buildRun({ cards, stats, random: () => 0 }).map((card) => card.sr_cyr);

    expect(new Set(run.slice(0, 2))).toEqual(new Set(['Б б', 'Г г']));
    expect(run[2]).toBe('Д д');
    expect(run.slice(3)).toEqual(['В в', 'А а']);
  });

  it('orders the rest by the shortest run of right answers first', () => {
    const stats = tallies({
      'А а': { easy: 5, hard: 1, streak: 5 },
      'Б б': { easy: 1, hard: 1, streak: 1 },
      'В в': { easy: 3, hard: 1, streak: 3 },
      'Г г': { easy: 2, hard: 1, streak: 2 },
      'Д д': { easy: 4, hard: 1, streak: 4 },
    });
    expect(buildRun({ cards, stats, random: () => 0 }).map((card) => card.sr_cyr)).toEqual([
      'Б б',
      'Г г',
      'В в',
      'Д д',
      'А а',
    ]);
  });

  it('treats a row with no ratings in it as never rated', () => {
    // The row can exist with zeroes (a reset, or a future migration seeding
    // one); "never rated" is about the counts, not about the row.
    const stats = tallies({ 'А а': {}, 'Б б': { easy: 0, hard: 2, streak: 0 } });
    const run = buildRun({ cards: [letterCard('А а'), letterCard('Б б')], stats, random: () => 0 });
    expect(run.map((card) => card.sr_cyr)).toEqual(['Б б', 'А а']);
  });

  it('shuffles inside a band, so two runs are not the same run', () => {
    const stats = tallies({});
    const first = buildRun({ cards, stats, random: cyclingRng([0.99, 0.05, 0.6, 0.2]) });
    const second = buildRun({ cards, stats, random: cyclingRng([0.1, 0.8, 0.3, 0.95]) });

    expect(first.map((card) => card.sr_cyr)).not.toEqual(second.map((card) => card.sr_cyr));
    // ...and neither run lost or duplicated a letter doing it.
    for (const run of [first, second]) {
      expect(new Set(run.map((card) => card.sr_cyr)).size).toBe(cards.length);
    }
  });

  it('is deterministic for a given random source', () => {
    const stats = tallies({});
    const once = buildRun({ cards, stats, random: cyclingRng([0.3, 0.7, 0.1, 0.9]) });
    const twice = buildRun({ cards, stats, random: cyclingRng([0.3, 0.7, 0.1, 0.9]) });
    expect(once.map((card) => card.id)).toEqual(twice.map((card) => card.id));
  });

  it('never shuffles a letter out of its band', () => {
    const stats = tallies({
      'А а': { easy: 1, hard: 1, streak: 0 },
      'Б б': { easy: 1, hard: 1, streak: 0 },
      'В в': { easy: 9, streak: 9 },
      'Г г': { easy: 9, streak: 9 },
    });
    const run = buildRun({
      cards: cards.slice(0, 4),
      stats,
      random: cyclingRng([0.99, 0.01, 0.5]),
    }).map((card) => card.sr_cyr);

    expect(new Set(run.slice(0, 2))).toEqual(new Set(['А а', 'Б б']));
    expect(new Set(run.slice(2))).toEqual(new Set(['В в', 'Г г']));
  });

  it('narrows to the letters that are not solid when asked', () => {
    const stats = tallies({
      'А а': { easy: 4, streak: 4 },
      'Б б': { easy: 3, streak: 3 },
      'В в': { easy: 1, hard: 1, streak: 1 },
    });
    const run = buildRun({ cards, stats, trickyOnly: true, random: () => 0 });
    expect(run.map((card) => card.sr_cyr).sort()).toEqual(['В в', 'Г г', 'Д д'].sort());
  });

  it('has nothing to narrow to once every letter is solid', () => {
    const stats = tallies(
      Object.fromEntries(cards.map((card) => [card.sr_cyr, { easy: 5, streak: 5 }])),
    );
    expect(buildRun({ cards, stats, trickyOnly: true })).toEqual([]);
    // ...but the full run is still all thirty, which is what the screen offers
    // instead of a locked button.
    expect(buildRun({ cards, stats })).toHaveLength(cards.length);
  });

  it('does not mutate the cards it was given', () => {
    const input = [...cards];
    buildRun({ cards: input, stats: tallies({}), random: cyclingRng([0.9, 0.1]) });
    expect(input.map((card) => card.sr_cyr)).toEqual(cards.map((card) => card.sr_cyr));
  });

  it('copes with an alphabet that has not loaded yet', () => {
    expect(buildRun({ cards: [], stats: tallies({}) })).toEqual([]);
  });
});

describe('shuffle', () => {
  it('keeps every item exactly once', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = shuffle(input, cyclingRng([0.42, 0.9, 0.1, 0.75]));
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it('leaves the input alone', () => {
    const input = ['a', 'b', 'c'];
    shuffle(input, () => 0.99);
    expect(input).toEqual(['a', 'b', 'c']);
  });

  it('survives a random source that returns its bounds', () => {
    expect(shuffle([1, 2, 3], () => 0)).toHaveLength(3);
    // Math.random() never returns 1, but a stub might.
    expect(shuffle([1, 2, 3], () => 1)).toHaveLength(3);
  });
});

describe('runSummary', () => {
  it('says what the run came to, in plain English', () => {
    expect(runSummary({ gotIt: 24, notYet: 6 })).toBe('30 letters · 24 got it · 6 not yet');
  });

  it('counts one letter as one letter', () => {
    expect(runSummary({ gotIt: 1, notYet: 0 })).toBe('1 letter · 1 got it · 0 not yet');
  });

  it('has no jargon in it — no grades, no intervals, no "due"', () => {
    const line = runSummary({ gotIt: 3, notYet: 2 });
    for (const word of ['due', 'again', 'hard', 'easy', 'interval', 'card']) {
      expect(line.toLowerCase()).not.toContain(word);
    }
  });
});

describe('rateLetterParams', () => {
  it('sends the letter and the verdict, and nothing else', () => {
    expect(rateLetterParams('Ж ж', true)).toEqual({ p_letter: 'Ж ж', p_got_it: true });
    expect(rateLetterParams('Ж ж', false)).toEqual({ p_letter: 'Ж ж', p_got_it: false });
  });

  it('never sends a user id — the function takes that from auth.uid()', () => {
    expect(Object.keys(rateLetterParams('Ж ж', true))).toEqual(['p_letter', 'p_got_it']);
  });
});

describe('letterGlyph', () => {
  it('takes the lowercase half of a printed pair', () => {
    expect(letterGlyph('Б б')).toBe('б');
    expect(letterGlyph('А а')).toBe('а');
  });

  it('handles the digraph letters, which are one glyph each', () => {
    expect(letterGlyph('Љ љ')).toBe('љ');
    expect(letterGlyph('Њ њ')).toBe('њ');
    expect(letterGlyph('Џ џ')).toBe('џ');
  });

  it('passes a lone glyph through, upper or lower case', () => {
    expect(letterGlyph('б')).toBe('б');
    expect(letterGlyph('Б')).toBe('б');
  });

  it('survives odd spacing, and is empty for nothing at all', () => {
    expect(letterGlyph('  Б   б  ')).toBe('б');
    expect(letterGlyph('')).toBe('');
    expect(letterGlyph('   ')).toBe('');
  });
});

describe('solidGlyphs', () => {
  it('has the glyph of every letter at or past the solid streak', () => {
    const glyphs = solidGlyphs([
      statRow('Б б', { easy: 5, streak: LETTER_SOLID_STREAK }),
      statRow('В в', { easy: 9, streak: LETTER_SOLID_STREAK + 4 }),
      statRow('Г г', { easy: 2, streak: LETTER_SOLID_STREAK - 1 }),
    ]);
    expect([...glyphs].sort()).toEqual(['б', 'в']);
  });

  it('is empty when nothing has been rated', () => {
    expect(solidGlyphs([]).size).toBe(0);
  });

  it('drops a row whose key names no letter at all', () => {
    expect(solidGlyphs([statRow('   ', { streak: 9 })]).size).toBe(0);
  });
});

describe('hintWithoutExample', () => {
  it('drops the trailing "— word (gloss)" the card already prints', () => {
    expect(hintWithoutExample('k as in key, no puff of air — крава (cow)')).toBe(
      'k as in key, no puff of air',
    );
    expect(hintWithoutExample('b as in book — буба (bug)')).toBe('b as in book');
  });

  it('keeps an example that is *inside* the hint, and drops only the last one', () => {
    // Р is the one hint with both: an inner "as in прст (finger)" that is part
    // of the explanation, and the harvested tail "— рак (crab)" that is not.
    expect(
      hintWithoutExample(
        'rolled r, tapped like the Spanish r; between consonants it becomes the vowel of the syllable, as in прст (finger) — рак (crab)',
      ),
    ).toBe(
      'rolled r, tapped like the Spanish r; between consonants it becomes the vowel of the syllable, as in прст (finger)',
    );
  });

  it('leaves a hint with no em-dash exactly as it stands', () => {
    expect(hintWithoutExample('m as in mum')).toBe('m as in mum');
    expect(hintWithoutExample('ts as in cats, never a k sound')).toBe(
      'ts as in cats, never a k sound',
    );
  });

  it('leaves an em-dash segment that is not a harvested example', () => {
    // No parenthesised gloss: this dash is punctuation, not a tail.
    expect(hintWithoutExample('f as in fish — and nothing else')).toBe(
      'f as in fish — and nothing else',
    );
    // More than one word before the bracket: not the shape the seed harvested.
    expect(hintWithoutExample('v as in van — two words (here)')).toBe(
      'v as in van — two words (here)',
    );
  });

  it('never returns nothing, however odd the input', () => {
    expect(hintWithoutExample('— рак (crab)')).toBe('— рак (crab)');
    expect(hintWithoutExample('')).toBe('');
  });

  it('leaves a real hint for every one of the thirty letters', () => {
    for (const letter of lettersJson) {
      const shortened = hintWithoutExample(letter.en);
      expect(shortened, letter.cyr_pair).not.toBe('');
      // The tail really is gone: the example word appears once in the hint at
      // most (Р keeps прст, never рак), and never as the final bracket.
      expect(shortened, letter.cyr_pair).not.toContain(`— ${letter.example_cyr} (`);
      expect(shortened.length, letter.cyr_pair).toBeLessThan(letter.en.length);
    }
  });
});

// ---------------------------------------------------------------------------
// The migration, read as text.
//
// The SQL is not TypeScript: a renamed argument, a `security definer` slipped in
// during a later edit, or a changed XP literal would all type-check perfectly
// and only fail (or quietly misbehave) at runtime.
// ---------------------------------------------------------------------------

const migration = readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260904120000_letter_stats.sql'),
  'utf8',
);

/** The `p_*` argument names the migration declares, in declaration order. */
function migrationParameterNames(): string[] {
  const signature = migration.slice(
    migration.indexOf(`create function public.${RATE_LETTER_FN}(`),
    migration.indexOf('returns public.letter_stats'),
  );
  return [...signature.matchAll(/^\s*(p_[a-z_]+)\s+/gm)].map((match) => match[1]);
}

describe('the letter_stats migration keeps its contract', () => {
  it('creates the table with the columns the drill tallies', () => {
    expect(migration).toContain('create table public.letter_stats');
    for (const column of ['user_id', 'letter', 'easy', 'hard', 'streak', 'last_seen']) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain('primary key (user_id, letter)');
    expect(migration).toContain('references auth.users (id) on delete cascade');
  });

  it('locks the table to its owner', () => {
    expect(migration).toContain('alter table public.letter_stats enable row level security');
    for (const action of ['select', 'insert', 'update', 'delete']) {
      expect(migration).toContain(`create policy letter_stats_${action}_own`);
    }
    expect(migration).toContain('revoke all on public.letter_stats from authenticated, anon;');
    expect(migration).toContain(
      'grant select, insert, update, delete on public.letter_stats to authenticated;',
    );
  });

  it('creates the rating function at all (guards every assertion below)', () => {
    expect(migration).toContain(`create function public.${RATE_LETTER_FN}(`);
  });

  it('declares exactly the arguments the client sends', () => {
    expect(migrationParameterNames()).toEqual(Object.keys(rateLetterParams('А а', true)));
  });

  it('keeps the function under the caller’s RLS, not the definer’s', () => {
    expect(migration).toContain('security invoker');
    expect(migration).not.toContain('security definer');
  });

  it('fills user_id from auth.uid() rather than trusting an argument', () => {
    expect(migration).toContain('auth.uid()');
    expect(migrationParameterNames()).not.toContain('p_user_id');
  });

  it('refuses a letter that is not one of the cards', () => {
    // Otherwise a typo or a stale client mints a tally row for a letter that
    // does not exist, which nothing reads and nothing cleans up. The check has
    // to be against `kind = 'letter'` specifically: `sr_cyr` is unique across
    // the whole deck, so without it a *word* would be tallied as a letter.
    expect(migration).toMatch(
      /if not exists \(\s*select 1 from public\.cards\s*where cards\.kind = 'letter' and cards\.sr_cyr = p_letter\s*\)/,
    );
    // ...and it must come before the write, not after it.
    expect(migration.indexOf("cards.sr_cyr = p_letter")).toBeLessThan(
      migration.indexOf('insert into public.letter_stats'),
    );
  });

  it('adds to the tally instead of replacing it', () => {
    // The reason the RPC exists at all: PostgREST's upsert would write
    // `excluded.easy` and silently lose every concurrent rating.
    expect(migration).toMatch(/easy\s*=\s*ls\.easy\s*\+/);
    expect(migration).toMatch(/hard\s*=\s*ls\.hard\s*\+/);
  });

  it('resets the streak on "Not yet" and never decrements it', () => {
    expect(migration).toMatch(/streak\s*=\s*case when p_got_it then ls\.streak \+ 1 else 0 end/);
    expect(migration).not.toMatch(/streak\s*=\s*ls\.streak\s*-/);
  });

  it('pays the same XP a word review pays, in the same transaction', () => {
    const award = migration.match(
      /insert into public\.xp_events \(user_id, amount, kind\)\s*values \(v_user_id, (\d+), '(\w+)'\)/,
    );
    expect(award).not.toBeNull();
    expect(Number(award?.[1])).toBe(XP_AWARDS.review);
    expect(award?.[2]).toBe('review');
  });

  it('grants execute explicitly and takes the default PUBLIC and anon grants back', () => {
    expect(migration).toMatch(
      /revoke execute on function public\.rate_letter\([\s\S]*?\) from public;/,
    );
    expect(migration).toMatch(
      /revoke execute on function public\.rate_letter\([\s\S]*?\) from anon;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.rate_letter\([\s\S]*?\) to authenticated;/,
    );
  });

  it('takes the letters out of the spaced-repetition table', () => {
    expect(migration).toMatch(/delete from public\.user_cards[\s\S]*?cards\.kind = 'letter'/);
  });

  it('leaves the review history alone, so the day streak keeps its earned days', () => {
    expect(migration).not.toMatch(/delete from public\.review_logs/);
  });
});
