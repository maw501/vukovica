/**
 * The letters deck's seed migration, checked against the content it was
 * transcribed from.
 *
 * `supabase/migrations/20260830160000_seed_letters.sql` is a hand-written copy
 * of `data/phase3/letters.json`, because a migration cannot read a file. Two
 * copies of the same thirty letters is exactly the arrangement that drifts:
 * a mnemonic edited in the JSON, a pair mistyped in the SQL, a row lost to a
 * stray comma. Nothing else compares them — the migration's own `do $$` block
 * only counts to thirty — so this does, value by value.
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
const migration = readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260830160000_seed_letters.sql'),
  'utf8',
);

/** One row of the migration's `values` list. */
interface SeedRow {
  sr_cyr: string;
  en: string;
  example_cyr: string;
  example_en: string;
  sort: number;
}

/**
 * The `values` list, parsed.
 *
 * A tokeniser rather than a regular expression per row: the mnemonics contain
 * commas, em dashes, parentheses and (twice) an escaped `''`, all of which a
 * line-shaped pattern gets wrong in a way that reads as a passing test.
 */
function seededRows(): SeedRow[] {
  const start = migration.indexOf('from (values');
  const end = migration.indexOf(') as v (');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = migration.slice(start + 'from (values'.length, end);

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

const rows = seededRows();

describe('the letters seed migration', () => {
  it('seeds one row per azbuka letter', () => {
    expect(letters).toHaveLength(30);
    expect(rows).toHaveLength(30);
  });

  it('copies every field of every letter faithfully', () => {
    // Compared as whole rows so a failure prints the letter that drifted rather
    // than "expected 30 to be 30".
    expect(
      rows.map((row) => ({
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

  it('takes example_en from the gloss already inside the mnemonic', () => {
    // Every mnemonic ends "— <example word> (<gloss>)", which is the only place
    // the example's English lives; `cards.example_en` is `not null`.
    for (const [index, letter] of letters.entries()) {
      const tail = letter.en.match(/—\s*(\S+)\s+\(([^)]*)\)\s*$/);
      expect(tail, `letter ${letter.cyr_pair} has no "word (gloss)" tail`).not.toBeNull();
      expect(tail?.[1]).toBe(letter.example_cyr);
      expect(rows[index].example_en).toBe(tail?.[2]);
    }
  });

  it('seeds pairs in azbuka order, one second apart, so new cards arrive in order', () => {
    // `api.fetchNewCards` orders by created_by, then created_at, then id. Every
    // row here shares a null `created_by`, so `created_at` is what stops the
    // alphabet arriving in uuid order.
    expect(migration).toContain("make_interval(secs => v.sort)");
    expect(rows.map((row) => row.sort)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
  });

  it('fills the not-null columns the README leaves to the seeder', () => {
    expect(migration).toContain("'letter',"); // pos
    expect(migration).toContain("'alphabet',"); // domain
  });

  it('gives every pair a distinct sr_cyr, which is a unique column', () => {
    expect(new Set(rows.map((row) => row.sr_cyr)).size).toBe(30);
  });

  it('never collides with a word headword, because a pair contains a space', () => {
    for (const row of rows) {
      expect(row.sr_cyr).toMatch(/^\S+ \S+$/);
    }
  });

  it('does not store the Latin pair, because the app derives it', () => {
    // `cards` has no `sr_lat` column; the review screen derives the pair with
    // `latinLetterPair`. This is the cross-check `lat_pair` exists for --
    // including the digraphs, which are the only place a case-blind
    // transliterator would show itself.
    const columns = migration.slice(
      migration.indexOf('insert into public.cards'),
      migration.indexOf('select'),
    );
    expect(columns).toContain('sr_cyr');
    expect(columns).not.toContain('sr_lat');
    for (const letter of letters) {
      expect(latinLetterPair(letter.cyr_pair)).toBe(letter.lat_pair);
      expect(latToCyr(letter.lat_pair)).toBe(letter.cyr_pair);
    }
  });

  it('is idempotent, and refuses to leave the deck short', () => {
    expect(migration).toContain('on conflict (sr_cyr) do nothing');
    expect(migration).toContain('expected 30 letter cards, found %');
  });
});
