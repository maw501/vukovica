import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CARD_DOMAINS } from '@/lib/cardInput';
import {
  canQuickAdd,
  quickAddConfirmation,
  quickAddErrorMessage,
  quickAddErrors,
  quickAddMatches,
  quickAddAction,
  quickAddParams,
  quickAddShownErrors,
  requestConfirmation,
  QUICK_ADD_DOMAIN,
  QUICK_ADD_FAILED,
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

  it('refuses a word half-typed on the other keyboard', () => {
    // The trap this guard exists for: `toCyrillicHeadword` leaves a string that
    // already contains Cyrillic *unconverted*, so "кasika" -- one slipped
    // keyboard switch -- would have gone into a shared, unique-keyed deck that
    // `cyrToLat`, search and the audio batch all assume is pure Cyrillic.
    const mixed = 'Type the whole word in one script — Cyrillic or Latin.';
    expect(quickAddErrors('кasika', 'spoon').sr).toBe(mixed);
    expect(quickAddErrors('kašikа', 'spoon').sr).toBe(mixed);
    expect(quickAddErrors('патикe', 'trainers').sr).toBe(mixed);
    expect(canQuickAdd('кasika', 'spoon')).toBe(false);
  });

  it('refuses a digit smuggled into an otherwise Cyrillic word', () => {
    expect(quickAddErrors('кашика2', 'spoon').sr).toBe('Use Cyrillic or Latin letters.');
  });

  it('allows the punctuation the seeded deck’s own headwords use', () => {
    // Space, full stop, comma, the two marks, apostrophe and hyphen -- the same
    // class `seed-deck.test.ts` holds every headword to.
    expect(quickAddErrors('добар дан', 'good day')).toEqual({});
    expect(quickAddErrors('срп-ски', 'serbian-ish')).toEqual({});
    expect(quickAddErrors('здраво!', 'hello')).toEqual({});
  });

  it('reports both boxes at once rather than one at a time', () => {
    expect(Object.keys(quickAddErrors('', ''))).toEqual(['sr', 'en']);
    expect(canQuickAdd('', '')).toBe(false);
  });
});

describe('quickAddErrorMessage', () => {
  it('never lets the function’s own raises reach the screen', () => {
    // `errorMessage` passes `PostgrestError.message` through verbatim, which is
    // right everywhere else and quite wrong here: these messages name the
    // function and its arguments.
    const raises = [
      'quick_add_word: p_sr_cyr must be a word',
      'quick_add_word: p_en must be what it means',
      'quick_add_word: “kasika” is not written in Cyrillic',
      'quick_add_word: “Б б” is already in the deck, but not as a word',
      'quick_add_word requires an authenticated user',
    ];
    for (const message of raises) {
      const shown = quickAddErrorMessage({ message });
      expect(shown).not.toContain('quick_add_word');
      expect(shown).not.toContain('p_sr_cyr');
      expect(shown).not.toContain('p_en');
    }
  });

  it('says what went wrong in words Mark can act on', () => {
    expect(
      quickAddErrorMessage({ message: 'quick_add_word: “Б б” is already in the deck, but not as a word' }),
    ).toBe('That’s a letter, not a word.');
    expect(
      quickAddErrorMessage({ message: 'quick_add_word: “kasika” is not written in Cyrillic' }),
    ).toBe('Type the word in Serbian first.');
    expect(quickAddErrorMessage({ message: 'quick_add_word: p_sr_cyr must be a word' })).toBe(
      'Type the word in Serbian first.',
    );
    expect(quickAddErrorMessage({ message: 'quick_add_word: p_en must be what it means' })).toBe(
      'Type what it means in English.',
    );
    expect(
      quickAddErrorMessage({ message: 'quick_add_word requires an authenticated user' }),
    ).toBe('You are signed out. Sign in and try again.');
  });

  it('falls back rather than repeating a message it does not recognise', () => {
    expect(quickAddErrorMessage({ message: 'TypeError: Failed to fetch' })).toBe(QUICK_ADD_FAILED);
    expect(quickAddErrorMessage(new Error('duplicate key value'))).toBe(QUICK_ADD_FAILED);
    expect(quickAddErrorMessage(null)).toBe(QUICK_ADD_FAILED);
    expect(quickAddErrorMessage(undefined)).toBe(QUICK_ADD_FAILED);
  });
});

describe('quickAddConfirmation', () => {
  it('says the word and its meaning, the same either way it was added', () => {
    expect(quickAddConfirmation('патике', 'trainers')).toBe('патике — trainers');
  });
});

describe('quickAddMatches', () => {
  const deck = [
    { id: '1', sr_cyr: 'патике', en: 'trainers' },
    { id: '2', sr_cyr: 'ципеле', en: 'shoes' },
    { id: '3', sr_cyr: 'папуче', en: 'slippers' },
    { id: '4', sr_cyr: 'кашика', en: 'spoon' },
  ];

  it('says nothing until there is enough typed to be worth matching', () => {
    expect(quickAddMatches(deck, 'п', '')).toEqual([]);
    expect(quickAddMatches(deck, '', 't')).toEqual([]);
    expect(quickAddMatches(deck, '', '')).toEqual([]);
  });

  it('finds a word by its Cyrillic', () => {
    expect(quickAddMatches(deck, 'пат', '').map((card) => card.id)).toEqual(['1']);
  });

  it('finds it by the Latin it was typed in — the deck stores neither', () => {
    expect(quickAddMatches(deck, 'patike', '').map((card) => card.id)).toEqual(['1']);
  });

  it('finds it by the English, which is how he learns the deck already had it', () => {
    expect(quickAddMatches(deck, '', 'trainers').map((card) => card.id)).toEqual(['1']);
  });

  it('searches both boxes, Serbian first, without repeating a card', () => {
    const ids = quickAddMatches(deck, 'па', 'slippers').map((card) => card.id);
    expect(ids).toEqual(['1', '3']);
  });

  it('shows no more than the cap', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      sr_cyr: `папуча${index}`,
      en: 'slipper',
    }));
    expect(quickAddMatches(many, 'папуч', '')).toHaveLength(5);
    expect(quickAddMatches(many, 'папуч', '', 2)).toHaveLength(2);
  });
});

describe('QUICK_ADD_DOMAIN', () => {
  it('is one of the domains the long form offers, so a card can be moved out of it', () => {
    expect(CARD_DOMAINS).toContain(QUICK_ADD_DOMAIN);
  });
});

describe('quickAddAction', () => {
  it('adds the word when the Serbian is there', () => {
    expect(quickAddAction('кашика', 'spoon')).toBe('add');
    expect(quickAddAction('kasika', 'spoon')).toBe('add');
    // A Serbian word with no English is still an add: the errors say what is
    // missing, rather than the word being filed as a question.
    expect(quickAddAction('кашика', '')).toBe('add');
  });

  it('asks for the Serbian when only the English is filled in', () => {
    expect(quickAddAction('', 'trainers')).toBe('request');
    expect(quickAddAction('   ', ' trainers ')).toBe('request');
  });

  it('adds (and so shows both messages) when both boxes are empty', () => {
    expect(quickAddAction('', '')).toBe('add');
    expect(quickAddAction(' ', '  ')).toBe('add');
  });

  it('agrees with quickAddErrors about what an empty Serbian box is', () => {
    for (const sr of ['', '  ', '\t']) {
      expect(quickAddErrors(sr, 'x').sr).toBeDefined();
      expect(quickAddAction(sr, 'x')).toBe('request');
    }
  });
});

describe('quickAddShownErrors', () => {
  it('shows nothing while asking — an empty Serbian box is the point then', () => {
    expect(quickAddShownErrors('', 'trainers')).toEqual({});
  });

  it('is exactly quickAddErrors while adding', () => {
    for (const [sr, en] of [
      ['', ''],
      ['кашика', ''],
      ['кasika', 'spoon'],
      ['кашика', 'spoon'],
    ]) {
      expect(quickAddShownErrors(sr, en)).toEqual(quickAddErrors(sr, en));
    }
    // Both empty is an add, so both messages still show after a press.
    expect(Object.keys(quickAddShownErrors('', '')).sort()).toEqual(['en', 'sr']);
  });
});

describe('requestConfirmation', () => {
  it('names what was asked for, trimmed, and where it will be', () => {
    expect(requestConfirmation('  trainers ')).toBe(
      'Asked for: trainers. It’ll show up in My words under “Asked for” until the Serbian is added.',
    );
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
  const signature = header.slice(0, header.indexOf('returns table'));
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
    // `do update` as well as `update public.cards`, because the realistic
    // regression is `on conflict (sr_cyr) do update set en = v_en`, in which the
    // table is never named.
    expect(migration).not.toMatch(/update\s+public\.cards/);
    expect(migration).not.toMatch(/do\s+update/);
    expect(migration).toMatch(/on conflict \(sr_cyr\) do nothing/);
  });

  it('answers whether it inserted, rather than leaving the client to guess', () => {
    expect(functionHeader()).toMatch(/returns table \(card_id uuid, created boolean\)/);
    expect(migration).toMatch(/return query select v_card_id, v_created;/);
  });

  it('demands a headword that is Cyrillic all through, not one that merely has some', () => {
    // A containment test passes "кasika", which is a permanent, unique row in a
    // deck that assumes its headwords are pure. The anchors are the fix.
    expect(migration).toMatch(/!~ E'\^\[/);
    expect(migration).toMatch(/\$'/);
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
