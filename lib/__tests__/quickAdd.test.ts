import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CARD_DOMAINS } from '@/lib/cardInput';
import {
  canQuickAdd,
  quickAddConfirmation,
  quickAddErrors,
  quickAddParams,
  QUICK_ADD_DOMAIN,
  QUICK_ADD_FN,
} from '@/lib/quickAdd';

// ---------------------------------------------------------------------------
// The two boxes
// ---------------------------------------------------------------------------

describe('quickAddParams', () => {
  it('sends the word and what it means, and nothing else', () => {
    expect(quickAddParams('кашика', 'spoon')).toEqual({
      p_sr_cyr: 'кашика',
      p_en: 'spoon',
    });
  });

  it('converts a Latin headword, so a beginner can type it in Latin', () => {
    // The whole app assumes `sr_cyr` is Cyrillic: the review screen sets it in
    // the serif and search derives the Latin form back out of it.
    expect(quickAddParams('kasika', 'spoon').p_sr_cyr).toBe('касика');
    // Letter for letter, diacritics included -- `latToCyr` transliterates, it
    // does not guess a spelling, so "kašika" is what gives "кашика".
    expect(quickAddParams('kašika', 'spoon').p_sr_cyr).toBe('кашика');
    expect(quickAddParams('ljubav', 'love').p_sr_cyr).toBe('љубав');
  });

  it('trims both boxes', () => {
    expect(quickAddParams('  патике  ', '  trainers  ')).toEqual({
      p_sr_cyr: 'патике',
      p_en: 'trainers',
    });
  });

  it('never sends a user id — the function takes that from auth.uid()', () => {
    expect(Object.keys(quickAddParams('кашика', 'spoon'))).not.toContain('p_user_id');
  });
});

describe('quickAddErrors', () => {
  it('is happy with a word and its meaning', () => {
    expect(quickAddErrors('кашика', 'spoon')).toEqual({});
    expect(canQuickAdd('кашика', 'spoon')).toBe(true);
  });

  it('is happy with Latin, because that is converted before it is sent', () => {
    expect(quickAddErrors('kasika', 'spoon')).toEqual({});
  });

  it('asks for the Serbian when the box is empty or only spaces', () => {
    expect(quickAddErrors('', 'spoon').sr).toBe('Type the Serbian word.');
    expect(quickAddErrors('   ', 'spoon').sr).toBe('Type the Serbian word.');
  });

  it('asks for the English when that box is empty', () => {
    expect(quickAddErrors('кашика', '').en).toBe('Type what it means in English.');
    expect(quickAddErrors('кашика', '   ').en).toBe('Type what it means in English.');
  });

  it('refuses something that is not letters at all', () => {
    // `toCyrillicHeadword` leaves digits and punctuation alone, so this is the
    // one case that reaches the function as a headword with no letter in it.
    expect(quickAddErrors('123', 'spoon').sr).toBe('Use Cyrillic or Latin letters.');
  });

  it('reports both boxes at once rather than one at a time', () => {
    expect(Object.keys(quickAddErrors('', ''))).toEqual(['sr', 'en']);
    expect(canQuickAdd('', '')).toBe(false);
  });
});

describe('quickAddConfirmation', () => {
  it('says the word and its meaning, the same either way it was added', () => {
    expect(quickAddConfirmation('патике', 'trainers')).toBe('патике — trainers');
  });
});

describe('QUICK_ADD_DOMAIN', () => {
  it('is one of the domains the long form offers, so a card can be moved out of it', () => {
    expect(CARD_DOMAINS).toContain(QUICK_ADD_DOMAIN);
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
  path.join(repoRoot, 'supabase', 'migrations', '20260918150000_quick_add.sql'),
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
  const start = migration.indexOf(`create function public.${QUICK_ADD_FN}(`);
  const end = migration.indexOf('as $$', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

/** The `p_*` argument names the migration declares, in declaration order. */
function migrationParameterNames(): string[] {
  const header = functionHeader();
  const signature = header.slice(0, header.indexOf('returns uuid'));
  return [...signature.matchAll(/^\s*(p_[a-z_]+)\s+/gm)].map((match) => match[1]);
}

describe('the quick_add migration keeps its contract', () => {
  it('creates the function at all (guards every assertion below)', () => {
    expect(migration).toContain(`create function public.${QUICK_ADD_FN}(`);
  });

  it('declares exactly the arguments the client sends, in order', () => {
    expect(migrationParameterNames()).toEqual(Object.keys(quickAddParams('кашика', 'spoon')));
  });

  it('keeps the function under the caller’s RLS, not the definer’s', () => {
    // The house rule for every RPC in this schema (`submit_review`,
    // `rate_letter`, `mark_known`): the caller's own policies apply.
    expect(functionHeader()).toContain('security invoker');
    expect(functionHeader()).not.toContain('security definer');
  });

  it('pins its search_path, so an invoker-rights function cannot be shadowed', () => {
    expect(functionHeader()).toContain('set search_path = public, pg_temp');
  });

  it('fills created_by and user_id from auth.uid() rather than an argument', () => {
    expect(migration).toContain('auth.uid()');
    expect(migrationParameterNames()).not.toContain('p_user_id');
  });

  it('gives the three unasked-for columns an empty-string default', () => {
    // The columns stay `not null`; empty means "not filled in yet", which is
    // what every screen now hides rather than printing as a blank line.
    for (const column of ['pos', 'example_cyr', 'example_en']) {
      expect(migration).toContain(
        `alter table public.cards alter column ${column} set default '';`,
      );
    }
  });

  it('files a new card under the domain the client advertises', () => {
    expect(migration).toContain(`'${QUICK_ADD_DOMAIN}'`);
  });

  it('marks the word known through mark_known rather than a copy of its rule', () => {
    // What "known" means -- the state, the 90 days, the absence of XP -- lives
    // in `mark_known` and is read back by `lib/library.ts` and the dashboard. A
    // replica here would be a second definition free to drift.
    expect(migration).toMatch(/perform\s+public\.mark_known\(/);
  });

  it('awards no XP — declaring a word known is not work done', () => {
    expect(migration).not.toContain('xp_events');
  });

  it('leaves an existing card’s content alone', () => {
    // The deck is shared and `sr_cyr` is unique: half the point of this screen
    // is finding that "trainers" has been in the deck as патике all along, and
    // a two-box form is not the place to overwrite somebody's example sentence.
    expect(migration).not.toMatch(/update\s+public\.cards/);
    expect(migration).toMatch(/on conflict \(sr_cyr\) do nothing/);
  });

  it('refuses a blank box and a headword with no Cyrillic in it', () => {
    expect(migration).toMatch(/p_sr_cyr must be a word/);
    expect(migration).toMatch(/p_en must be what it means/);
    expect(migration).toMatch(/is not written in Cyrillic/);
  });

  it('grants execute explicitly and takes the default PUBLIC and anon grants back', () => {
    expect(migration).toMatch(
      /revoke execute on function public\.quick_add_word\([\s\S]*?\) from public;/,
    );
    expect(migration).toMatch(
      /revoke execute on function public\.quick_add_word\([\s\S]*?\) from anon;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.quick_add_word\([\s\S]*?\) to authenticated;/,
    );
  });
});
