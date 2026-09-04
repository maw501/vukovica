import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  classifyKnown,
  isKnown,
  KNOWN_DUE_DAYS,
  KNOWN_STABILITY,
  learnedLabel,
  libraryHeadline,
  MARK_KNOWN_FN,
  markKnownParams,
  sortLibrary,
  splitLibrary,
  type LibraryEntry,
} from '@/lib/library';
import type { CardRow, CardState, UserCardRow } from '@/lib/types';

function card(sr_cyr: string, en = 'a word'): CardRow {
  return {
    id: `card-${sr_cyr}`,
    sr_cyr,
    en,
    pos: 'noun',
    gender: 'f',
    aspect: null,
    example_cyr: `${sr_cyr} је реч.`,
    example_en: `${sr_cyr} is a word.`,
    domain: 'basics',
    audio_path: null,
    kind: 'word',
    created_by: null,
    created_at: null,
  };
}

function userCard(cardId: string, state: CardState, lastReview: string | null): UserCardRow {
  return {
    user_id: 'u1',
    card_id: cardId,
    due: '2026-09-04T00:00:00.000Z',
    stability: 1,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    state,
    last_review: lastReview,
  };
}

function entry(sr_cyr: string, state: CardState, lastReview: string | null = null): LibraryEntry {
  const row = card(sr_cyr);
  return { card: row, userCard: userCard(row.id, state, lastReview) };
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

describe('classifyKnown', () => {
  it('calls a graduated word known', () => {
    expect(classifyKnown({ state: 'review' })).toBe('known');
  });

  it('calls everything short of graduation still learning', () => {
    expect(classifyKnown({ state: 'new' })).toBe('learning');
    expect(classifyKnown({ state: 'learning' })).toBe('learning');
  });

  it('calls a lapsed word still learning, exactly as the Words ladder does', () => {
    // `api.getProgress` counts `state = 'review'` and nothing else, so a word
    // that lapsed back into relearning stops being known there. Saying
    // otherwise here would put a word in the Known list that the dashboard's
    // own count does not have.
    expect(classifyKnown({ state: 'relearning' })).toBe('learning');
  });

  it('has a boolean twin for the places a predicate reads better', () => {
    expect(isKnown({ state: 'review' })).toBe(true);
    expect(isKnown({ state: 'relearning' })).toBe(false);
  });
});

describe('splitLibrary', () => {
  it('puts each entry in exactly one of the two lists', () => {
    const entries = [
      entry('мама', 'review'),
      entry('тата', 'learning'),
      entry('хлеб', 'relearning'),
      entry('вода', 'review'),
      entry('сир', 'new'),
    ];
    const { known, learning } = splitLibrary(entries);

    expect(known.map((item) => item.card.sr_cyr)).toEqual(['мама', 'вода']);
    expect(learning.map((item) => item.card.sr_cyr)).toEqual(['тата', 'хлеб', 'сир']);
    expect(known.length + learning.length).toBe(entries.length);
  });

  it('keeps the order it was given', () => {
    const entries = [entry('б', 'review'), entry('а', 'review')];
    expect(splitLibrary(entries).known.map((item) => item.card.sr_cyr)).toEqual(['б', 'а']);
  });

  it('copes with nothing studied yet', () => {
    expect(splitLibrary([])).toEqual({ known: [], learning: [] });
  });
});

// ---------------------------------------------------------------------------
// What the header says
// ---------------------------------------------------------------------------

describe('libraryHeadline', () => {
  it('says both figures in plain English', () => {
    expect(libraryHeadline(142, 38)).toBe('142 words known · 38 still learning');
  });

  it('says one word rather than 1 words', () => {
    expect(libraryHeadline(1, 1)).toBe('1 word known · 1 still learning');
  });

  it('says nothing about a side that is empty', () => {
    expect(libraryHeadline(12, 0)).toBe('12 words known');
    expect(libraryHeadline(0, 4)).toBe('4 still learning');
  });

  it('is honest when the library is empty', () => {
    expect(libraryHeadline(0, 0)).toBe('No words yet');
  });
});

describe('learnedLabel', () => {
  const now = new Date('2026-09-04T09:00:00.000Z');

  it('is null for a word with no review stamped on it', () => {
    expect(learnedLabel(null, now)).toBeNull();
  });

  it('says today and yesterday rather than a date', () => {
    expect(learnedLabel('2026-09-04T07:30:00.000Z', now)).toBe('today');
    // Bucketed by local calendar day, and vitest pins TZ to Europe/Belgrade
    // (see vitest.config.ts) — 22:00 UTC on the 3rd is already the 4th there,
    // so "yesterday" has to be a stamp that is the previous *local* day.
    expect(learnedLabel('2026-09-03T12:00:00.000Z', now)).toBe('yesterday');
  });

  it('counts days for the last fortnight', () => {
    expect(learnedLabel('2026-08-30T09:00:00.000Z', now)).toBe('5 days ago');
  });

  it('falls back to a date once that stops being useful', () => {
    // Not asserted verbatim: the month name comes from the runtime's locale
    // data. What matters is that it is a date rather than "60 days ago".
    const label = learnedLabel('2026-07-06T09:00:00.000Z', now);
    expect(label).toMatch(/2026/);
    expect(label).not.toMatch(/ago/);
  });

  it('ignores a stamp in the future rather than saying "-2 days ago"', () => {
    expect(learnedLabel('2026-09-06T09:00:00.000Z', now)).toBe('today');
  });

  it('is null for a stamp that is not a date at all', () => {
    expect(learnedLabel('not a date', now)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe('sortLibrary', () => {
  const entries = [
    entry('вода', 'review', '2026-09-01T10:00:00.000Z'),
    entry('ауто', 'review', '2026-09-03T10:00:00.000Z'),
    entry('брат', 'review', null),
    entry('чај', 'review', '2026-09-02T10:00:00.000Z'),
  ];

  it('puts the most recently practised first', () => {
    expect(sortLibrary(entries, 'recent').map((item) => item.card.sr_cyr)).toEqual([
      'ауто',
      'чај',
      'вода',
      'брат',
    ]);
  });

  it('sorts A–Z in Serbian order, where ч comes after ц and before џ', () => {
    // `localeCompare(..., 'sr')` is the whole point: a plain codepoint sort puts
    // the whole of the alphabet in Unicode order, which is not azbuka order.
    expect(sortLibrary(entries, 'alpha').map((item) => item.card.sr_cyr)).toEqual([
      'ауто',
      'брат',
      'вода',
      'чај',
    ]);
  });

  it('never mutates the array it was given', () => {
    const original = [...entries];
    sortLibrary(entries, 'alpha');
    expect(entries).toEqual(original);
  });

  it('breaks a tie alphabetically, so the order is stable between renders', () => {
    const tied = [
      entry('вода', 'review', '2026-09-01T10:00:00.000Z'),
      entry('ауто', 'review', '2026-09-01T10:00:00.000Z'),
    ];
    expect(sortLibrary(tied, 'recent').map((item) => item.card.sr_cyr)).toEqual(['ауто', 'вода']);
  });
});

// ---------------------------------------------------------------------------
// The mark_known wire contract
// ---------------------------------------------------------------------------

describe('markKnownParams', () => {
  it('sends the card and nothing else', () => {
    expect(markKnownParams('card-1')).toEqual({ p_card_id: 'card-1' });
  });

  it('never sends a user id — the function takes that from auth.uid()', () => {
    expect(Object.keys(markKnownParams('card-1'))).not.toContain('p_user_id');
  });
});

// ---------------------------------------------------------------------------
// The migration, read as text.
//
// The SQL is not TypeScript: a renamed argument, a `security definer` slipped
// in during a later edit, or an XP award added by habit would all type-check
// perfectly and only misbehave at runtime.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260904130000_mark_known.sql'),
  'utf8',
);

/**
 * The function's declaration: everything from `create function` to the `as $$`
 * that opens its body.
 *
 * Sliced rather than matched over the whole file on purpose. `security definer`
 * and `security invoker` are words that belong in a comment as much as in a
 * declaration — the migration's own header explains why it is not a definer —
 * and a substring test over the file would both fail on that comment and pass on
 * a commented-out declaration.
 */
function functionHeader(): string {
  const start = migration.indexOf(`create function public.${MARK_KNOWN_FN}(`);
  const end = migration.indexOf('as $$', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

/** The `p_*` argument names the migration declares, in declaration order. */
function migrationParameterNames(): string[] {
  const header = functionHeader();
  const signature = header.slice(0, header.indexOf('returns public.user_cards'));
  return [...signature.matchAll(/^\s*(p_[a-z_]+)\s+/gm)].map((match) => match[1]);
}

describe('the mark_known migration keeps its contract', () => {
  it('creates the function at all (guards every assertion below)', () => {
    expect(migration).toContain(`create function public.${MARK_KNOWN_FN}(`);
  });

  it('declares exactly the arguments the client sends', () => {
    expect(migrationParameterNames()).toEqual(Object.keys(markKnownParams('card-1')));
  });

  it('keeps the function under the caller’s RLS, not the definer’s', () => {
    // The house rule for every RPC in this schema (`submit_review`,
    // `bump_drill_stats`, `rate_letter`): the caller's own policies apply.
    // Asserted against the declaration itself, so prose about definers in the
    // migration's comments neither fails this nor rescues a real mistake.
    expect(functionHeader()).toContain('security invoker');
    expect(functionHeader()).not.toContain('security definer');
  });

  it('pins its search_path, so an invoker-rights function cannot be shadowed', () => {
    expect(functionHeader()).toContain('set search_path = public, pg_temp');
  });

  it('fills user_id from auth.uid() rather than trusting an argument', () => {
    expect(migration).toContain('auth.uid()');
    expect(migrationParameterNames()).not.toContain('p_user_id');
  });

  it('writes the state the Known list reads', () => {
    expect(migration).toMatch(/state\s*=\s*'review'/);
  });

  it('parks the card for the interval the client advertises', () => {
    expect(migration).toContain(`interval '${KNOWN_DUE_DAYS} days'`);
    expect(migration).toMatch(new RegExp(`stability\\s*=\\s*${KNOWN_STABILITY}`));
  });

  it('never lowers a card’s rep count', () => {
    expect(migration).toMatch(/reps\s*=\s*greatest\(uc\.reps,\s*1\)/);
  });

  it('awards no XP — marking a word known is not work done', () => {
    expect(migration).not.toContain('xp_events');
  });

  it('refuses a card that is not a word', () => {
    // The letters left `user_cards` in 20260904120000; putting one back through
    // this door would be junk the Words ladder has to explain away.
    expect(migration).toMatch(/kind\s*=\s*'word'/);
  });

  it('grants execute explicitly and takes the default PUBLIC and anon grants back', () => {
    expect(migration).toMatch(
      /revoke execute on function public\.mark_known\([\s\S]*?\) from public;/,
    );
    expect(migration).toMatch(
      /revoke execute on function public\.mark_known\([\s\S]*?\) from anon;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.mark_known\([\s\S]*?\) to authenticated;/,
    );
  });
});
