/**
 * The grammar section's seed migration, checked against the content it was
 * transcribed from.
 *
 * `supabase/migrations/20260830170000_seed_grammar.sql` is a copy of
 * `data/phase3/grammar.json` — 12 topics and 203 drill items — because a
 * migration cannot read a file. Two copies of two hundred items is exactly the
 * arrangement that drifts: an answer corrected in the JSON, a note mistyped in
 * the SQL, a row lost to a stray comma. The migration's own `do $$` block only
 * counts to 12 and 203, so this compares them value by value.
 *
 * A text comparison, not a database one, like `seed-letters.test.ts`: no
 * Postgres, no fixtures, and it fails in the second it takes to run the suite
 * rather than on the next reset.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkAnswer } from '@/lib/grammar';
import { latToCyr } from '@/lib/transliterate';

import grammar from '../../data/phase3/grammar.json';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260830170000_seed_grammar.sql'),
  'utf8',
);

/**
 * The `values` list of the insert into `table`, tokenised into rows of fields.
 *
 * A tokeniser rather than a per-line regular expression: `explain_md` runs over
 * a dozen lines and contains commas, parentheses, hyphens and escaped `''`
 * apostrophes, every one of which a line-shaped pattern gets wrong in a way that
 * reads as a passing test.
 *
 * The slice is anchored to the insert statement it belongs to, because this
 * migration has two of them.
 */
function valuesOf(table: string): (string | number)[][] {
  const insertAt = migration.indexOf(`insert into public.${table}`);
  expect(insertAt).toBeGreaterThan(-1);
  const start = migration.indexOf('from (values', insertAt);
  const end = migration.indexOf(') as v (', start);
  expect(start).toBeGreaterThan(insertAt);
  expect(end).toBeGreaterThan(start);
  // The items list is grouped by `-- <slug>` comments. Stripping them is safe
  // because no string in the content contains a double hyphen -- asserted
  // below, so this stays true if the content is ever edited.
  const body = migration
    .slice(start + 'from (values'.length, end)
    .replace(/--[^\n]*/g, '');

  const rows: (string | number)[][] = [];
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
      rows.push(fields);
      fields = [];
      i += 1;
    } else {
      i += 1;
    }
  }

  return rows;
}

const topicRows = valuesOf('grammar_topics');
const itemRows = valuesOf('grammar_items');

/** Every item of every topic, flattened, with the slug that owns it. */
const jsonItems = grammar.flatMap((topic) =>
  topic.items.map((item) => ({ slug: topic.slug, ...item })),
);

describe('the grammar seed migration', () => {
  it('seeds every topic and every item', () => {
    expect(grammar).toHaveLength(12);
    expect(jsonItems).toHaveLength(203);
    expect(topicRows).toHaveLength(12);
    expect(itemRows).toHaveLength(203);
  });

  it('copies every field of every topic faithfully', () => {
    // Compared as whole rows so a failure prints the topic that drifted rather
    // than "expected 12 to be 12".
    expect(
      topicRows.map(([slug, title_en, explain_md, sort]) => ({
        slug,
        title_en,
        explain_md,
        sort,
      })),
    ).toEqual(
      grammar.map((topic) => ({
        slug: topic.slug,
        title_en: topic.title_en,
        explain_md: topic.explain_md,
        sort: topic.sort,
      })),
    );
  });

  it('copies every field of every item faithfully, in the JSON’s order', () => {
    expect(
      itemRows.map(([slug, prompt, answer_cyr, note, sort]) => ({
        slug,
        prompt,
        answer_cyr,
        note,
        sort,
      })),
    ).toEqual(
      jsonItems.map((item) => ({
        slug: item.slug,
        prompt: item.prompt,
        answer_cyr: item.answer_cyr,
        note: item.note,
        sort: item.sort,
      })),
    );
  });

  it('keeps the comment-stripping in the parser above honest', () => {
    // `valuesOf` removes `-- <slug>` group comments before tokenising, which is
    // only sound while no seeded string contains a double hyphen (the content
    // uses em dashes throughout).
    for (const row of [...topicRows, ...itemRows]) {
      for (const field of row) {
        if (typeof field === 'string') expect(field).not.toContain('--');
      }
    }
  });

  it('looks the topic up by slug rather than hard-coding a uuid', () => {
    // `grammar_topics.id` is `gen_random_uuid()`, so the items insert cannot
    // name it; the join is what ties the two lists together.
    expect(migration).toContain('join public.grammar_topics t on t.slug = v.slug');
    expect(new Set(topicRows.map((row) => row[0])).size).toBe(12);
    for (const [slug] of itemRows) {
      expect(topicRows.some((row) => row[0] === slug)).toBe(true);
    }
  });

  it('seeds no user_id, because this content belongs to the app', () => {
    const columns = migration.slice(
      migration.indexOf('insert into public.grammar_topics'),
      migration.indexOf('from (values'),
    );
    expect(columns).not.toContain('user_id');
    expect(migration).not.toContain('auth.users');
  });

  it('is idempotent, and refuses to leave the section half-seeded', () => {
    expect(migration).toContain('on conflict (slug) do nothing');
    // `grammar_items` has no unique constraint, so re-running is guarded by a
    // not-exists on (topic, sort) instead.
    expect(migration).toMatch(/where not exists \(\s*select 1\s*from public\.grammar_items/);
    expect(migration).toContain('expected 12 topics, found %');
    expect(migration).toContain('expected 203 items, found %');
  });

  it('gives every item a blank for the answer to fill, and an answer to fill it', () => {
    for (const [slug, prompt, answer, note, sort] of itemRows) {
      expect(String(prompt), `${slug} ${sort}`).toContain('___');
      expect(String(answer).trim(), `${slug} ${sort}`).not.toBe('');
      // `note` is what a miss shows; the content file never leaves one empty.
      expect(String(note).trim(), `${slug} ${sort}`).not.toBe('');
    }
  });

  it('seeds answers the drill’s checker actually accepts, in either script', () => {
    // The one end-to-end claim worth making from here: every seeded answer is
    // reachable both by typing the Cyrillic and by typing the Latin for it.
    for (const [slug, , answer, , sort] of itemRows) {
      const cyr = String(answer);
      expect(checkAnswer(cyr, cyr), `${slug} ${sort}`).toBe(true);
      expect(latToCyr(cyr), `${slug} ${sort} is stored in Cyrillic`).toBe(cyr);
    }
  });

  it('numbers each topic’s items from 1, so a run is asked in teaching order', () => {
    for (const topic of grammar) {
      const sorts = itemRows.filter((row) => row[0] === topic.slug).map((row) => row[4]);
      expect(sorts, topic.slug).toEqual(
        Array.from({ length: topic.items.length }, (_, index) => index + 1),
      );
    }
    expect(topicRows.map((row) => row[3])).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
  });
});
