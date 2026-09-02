/**
 * The letters deck's migrations, checked against the content they were
 * transcribed from.
 *
 * Two hand-written files carry the same thirty letters as
 * `data/phase3/letters.json`, because a migration cannot read a file:
 *
 *   1. `supabase/migrations/20260830160000_seed_letters.sql` inserts the deck.
 *   2. `supabase/migrations/20260902090000_letters_wife_words.sql` rewrites
 *      every example word to the word Mark's wife actually recorded.
 *
 * A database has both applied, so neither alone matches the JSON any more. What
 * this test compares is the composition — seed, then update, in migration order
 * — against `data/phase3/letters.json`, value by value. That is the arrangement
 * that drifts: a mnemonic edited in the JSON, a pair mistyped in an update, a
 * row lost to a stray comma. Nothing else compares them; the migrations' own
 * `do $$` blocks only count.
 *
 * It is a text comparison, not a database one: no Postgres, no fixtures, and it
 * fails in the second it takes to run the suite rather than on the next reset.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { latinLetterPair, latToCyr } from '@/lib/transliterate';

import letters from '../../data/phase3/letters.json';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readMigration = (file: string) =>
  readFileSync(path.join(repoRoot, 'supabase', 'migrations', file), 'utf8');

const seedMigration = readMigration('20260830160000_seed_letters.sql');
const updateMigration = readMigration('20260902090000_letters_wife_words.sql');

/** One row of the seed migration's `values` list. */
interface SeedRow {
  sr_cyr: string;
  en: string;
  example_cyr: string;
  example_en: string;
  sort: number;
}

/** What one `update` statement sets. */
type LetterText = Pick<SeedRow, 'en' | 'example_cyr' | 'example_en'>;

/**
 * The seed migration's `values` list, parsed.
 *
 * A tokeniser rather than a regular expression per row: the mnemonics contain
 * commas, em dashes, parentheses and (twice) an escaped `''`, all of which a
 * line-shaped pattern gets wrong in a way that reads as a passing test.
 */
function seededRows(): SeedRow[] {
  const start = seedMigration.indexOf('from (values');
  const end = seedMigration.indexOf(') as v (');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = seedMigration.slice(start + 'from (values'.length, end);

  const rows: SeedRow[] = [];
  let fields: (string | number)[] = [];
  let i = 0;

  while (i < body.length) {
    const char = body[i];
    if (char === "'") {
      let text = '';
      i += 1;
      while (i < body.length) {
        if (body[i] === "'" && body[i + 1] === "'") {
          text += "'";
          i += 2;
          continue;
        }
        if (body[i] === "'") {
          i += 1;
          break;
        }
        text += body[i];
        i += 1;
      }
      fields.push(text);
    } else if (char >= '0' && char <= '9') {
      let digits = '';
      while (i < body.length && body[i] >= '0' && body[i] <= '9') {
        digits += body[i];
        i += 1;
      }
      fields.push(Number(digits));
    } else if (char === ')') {
      const [sr_cyr, en, example_cyr, example_en, sort] = fields;
      rows.push({
        sr_cyr: sr_cyr as string,
        en: en as string,
        example_cyr: example_cyr as string,
        example_en: example_en as string,
        sort: sort as number,
      });
      fields = [];
      i += 1;
    } else {
      i += 1;
    }
  }

  return rows;
}

/**
 * The update migration's statements, parsed into `sr_cyr -> new text`.
 *
 * Read with the same care as the seed's `values` list, but the shape here is
 * fixed — one statement per letter, three columns, always in the same order —
 * so a strict pattern over the whole statement is the honest parser. The SQL
 * literal grammar (`''` for an embedded quote) is spelled out rather than
 * assumed, because Ћ's mnemonic quotes 't y'. `parsesEveryStatement` below
 * makes sure nothing in the file slips past the pattern unread.
 */
const LITERAL = String.raw`'((?:[^']|'')*)'`;
const STATEMENT = new RegExp(
  [
    String.raw`update public\.cards set\n`,
    String.raw`  en = ${LITERAL},\n`,
    String.raw`  example_cyr = ${LITERAL},\n`,
    String.raw`  example_en = ${LITERAL}\n`,
    String.raw`where sr_cyr = ${LITERAL} and kind = 'letter';`,
  ].join(''),
  'g',
);

function updatedText(): Map<string, LetterText> {
  const unquote = (text: string) => text.replace(/''/g, "'");
  const updates = new Map<string, LetterText>();
  for (const match of updateMigration.matchAll(STATEMENT)) {
    const [, en, example_cyr, example_en, sr_cyr] = match.map(unquote);
    expect(updates.has(sr_cyr), `${sr_cyr} is updated twice`).toBe(false);
    updates.set(sr_cyr, { en, example_cyr, example_en });
  }
  return updates;
}

const seeded = seededRows();
const updates = updatedText();
/** The deck as a database that has run both migrations holds it. */
const composed = seeded.map((row) => ({ ...row, ...updates.get(row.sr_cyr) }));

describe('the letters migrations', () => {
  it('seeds one row per azbuka letter', () => {
    expect(letters).toHaveLength(30);
    expect(seeded).toHaveLength(30);
  });

  it('rewrites all thirty, each an azbuka pair the seed inserted', () => {
    expect(updates.size).toBe(30);
    const seededPairs = new Set(seeded.map((row) => row.sr_cyr));
    for (const pair of updates.keys()) {
      expect(seededPairs.has(pair), `${pair} is not a seeded letter`).toBe(true);
    }
  });

  it('reads every statement in the update migration', () => {
    // The parser is a pattern, so a statement it cannot read is a statement it
    // silently ignores — and an ignored statement is an untested one.
    expect(updateMigration.split('update public.cards set').length - 1).toBe(updates.size);
  });

  it('composes — seed, then update — into exactly letters.json', () => {
    // Compared as whole rows so a failure prints the letter that drifted rather
    // than "expected 30 to be 30".
    expect(
      composed.map((row) => ({
        cyr_pair: row.sr_cyr,
        en: row.en,
        example_cyr: row.example_cyr,
        sort: row.sort,
      })),
    ).toEqual(
      letters.map((letter) => ({
        cyr_pair: letter.cyr_pair,
        en: letter.en,
        example_cyr: letter.example_cyr,
        sort: letter.sort,
      })),
    );
  });

  it("keeps each updated mnemonic's phonetic description word for word", () => {
    // Only the "— <word> (<gloss>)" tail is the wife's; everything before the
    // em dash describes the letter's sound and was language-reviewed once.
    for (const [pair, update] of updates) {
      const seed = seeded.find((row) => row.sr_cyr === pair);
      const tail = /—[^—]*$/;
      expect(update.en.replace(tail, ''), `${pair}`).toBe(seed?.en.replace(tail, ''));
    }
  });

  it('takes example_en from the gloss already inside the mnemonic', () => {
    // Every mnemonic ends "— <example word> (<gloss>)", which is the only place
    // the example's English lives; `cards.example_en` is `not null`.
    for (const [index, letter] of letters.entries()) {
      const tail = letter.en.match(/—\s*(\S+)\s+\(([^)]*)\)\s*$/);
      expect(tail, `letter ${letter.cyr_pair} has no "word (gloss)" tail`).not.toBeNull();
      expect(tail?.[1]).toBe(letter.example_cyr);
      expect(composed[index].example_en).toBe(tail?.[2]);
    }
  });

  it('changes nothing but the three columns that carry the example word', () => {
    // The audio is the wife's own voice and already uploaded; `audio_path` is
    // the one column an update to the words must never touch. The statement
    // pattern already fixes each `set` list to en / example_cyr / example_en,
    // so what is left to catch is SQL arriving outside those statements —
    // hence the whole file, minus its comments, which discuss `audio_path`
    // precisely to say it is left alone.
    const sql = updateMigration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(sql).not.toContain('audio_path');
    expect(sql).not.toContain('insert into');
    expect(sql).not.toContain('delete from');
  });

  it('seeds pairs in azbuka order, one second apart, so new cards arrive in order', () => {
    // `api.fetchNewCards` orders by created_by, then created_at, then id. Every
    // row here shares a null `created_by`, so `created_at` is what stops the
    // alphabet arriving in uuid order.
    expect(seedMigration).toContain('make_interval(secs => v.sort)');
    expect(seeded.map((row) => row.sort)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
  });

  it('fills the not-null columns the README leaves to the seeder', () => {
    expect(seedMigration).toContain("'letter',"); // pos
    expect(seedMigration).toContain("'alphabet',"); // domain
  });

  it('gives every pair a distinct sr_cyr, which is a unique column', () => {
    expect(new Set(seeded.map((row) => row.sr_cyr)).size).toBe(30);
  });

  it('never collides with a word headword, because a pair contains a space', () => {
    for (const row of seeded) {
      expect(row.sr_cyr).toMatch(/^\S+ \S+$/);
    }
  });

  it('does not store the Latin pair, because the app derives it', () => {
    // `cards` has no `sr_lat` column; the review screen derives the pair with
    // `latinLetterPair`. This is the cross-check `lat_pair` exists for --
    // including the digraphs, which are the only place a case-blind
    // transliterator would show itself.
    const columns = seedMigration.slice(
      seedMigration.indexOf('insert into public.cards'),
      seedMigration.indexOf('select'),
    );
    expect(columns).toContain('sr_cyr');
    expect(columns).not.toContain('sr_lat');
    for (const letter of letters) {
      expect(latinLetterPair(letter.cyr_pair)).toBe(letter.lat_pair);
      expect(latToCyr(letter.lat_pair)).toBe(letter.cyr_pair);
    }
  });

  it('is idempotent, and refuses to leave the deck short', () => {
    expect(seedMigration).toContain('on conflict (sr_cyr) do nothing');
    expect(seedMigration).toContain('expected 30 letter cards, found %');
    // The update migration assigns literals to rows matched on a unique column,
    // so re-running it is a no-op by construction; its guard checks the deck is
    // still whole and still self-consistent.
    expect(updateMigration).toContain('expected 30 letter cards, found %');
    expect(updateMigration).toContain('does not end in its own example word and gloss');
  });
});
