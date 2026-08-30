/**
 * Validation for the two content files that belong to a user rather than to
 * everybody — `data/phase3/ghmily-book.json` and `data/phase3/stories.json` —
 * and for `scripts/seed-user-content.mjs`, which inserts them.
 *
 * The files are checked the way `seed-deck.test.ts` checks the deck: shape,
 * Cyrillic-only Serbian, and the invariants the README states (contiguous page
 * numbers, word counts that match the bodies, four short level-1 stories). The
 * script is checked for the handful of decisions no type or constraint would
 * catch — the book's `source` and `status`, `photo_path` null, `finished_at`
 * left alone, and the idempotency that lets it be re-run after a reseed.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { cyrToLat, latToCyr } from '@/lib/transliterate';

import book from '../../data/phase3/ghmily-book.json';
import stories from '../../data/phase3/stories.json';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = readFileSync(path.join(repoRoot, 'scripts', 'seed-user-content.mjs'), 'utf8');

/** As in `seed-deck.test.ts`: Serbian Cyrillic, spaces, and sentence punctuation. */
const SERBIAN_CYRILLIC =
  /^[абвгдђежзијклљмнњопрстћуфхцчџшАБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ .,!?'-]+$/;

describe('the GHMILY book', () => {
  it('is one book with sixteen pages', () => {
    expect(book.pages).toHaveLength(16);
    expect(book.title_cyr).toBe('Погоди колико те волим');
    expect(book.title_en).toContain("Claude's rendering");
  });

  it('numbers its pages from one, contiguously, in order', () => {
    expect(book.pages.map((page) => page.page_no)).toEqual(
      Array.from({ length: book.pages.length }, (_, index) => index + 1),
    );
  });

  it('writes the title and every page in Serbian Cyrillic only', () => {
    expect(book.title_cyr).toMatch(SERBIAN_CYRILLIC);
    expect(latToCyr(cyrToLat(book.title_cyr))).toBe(book.title_cyr);
    for (const page of book.pages) {
      expect(page.text_cyr, `page ${page.page_no}`).toMatch(SERBIAN_CYRILLIC);
      expect(latToCyr(cyrToLat(page.text_cyr)), `page ${page.page_no}`).toBe(page.text_cyr);
      expect(page.text_cyr.trim(), `page ${page.page_no}`).not.toBe('');
    }
  });

  it('keeps a page to the two or three sentences a toddler sits through', () => {
    for (const page of book.pages) {
      const sentences = page.text_cyr.split(/[.!?]+/).filter((part) => part.trim() !== '');
      expect(sentences.length, `page ${page.page_no}`).toBeLessThanOrEqual(3);
      expect(page.text_cyr.slice(-1), `page ${page.page_no}`).toMatch(/[.!?]/);
    }
  });

  it('opens and closes on the lines the book is remembered for', () => {
    expect(book.pages[1].text_cyr).toContain('Погоди колико те волим');
    expect(book.pages[book.pages.length - 1].text_cyr).toContain('Месеца');
  });
});

describe('the warm-up stories', () => {
  it('is four level-1 stories', () => {
    expect(stories).toHaveLength(4);
    for (const story of stories) {
      expect(story.level, story.title_cyr).toBe(1);
    }
  });

  it('gives each a distinct Cyrillic title, which is what the seed matches on', () => {
    // `stories` has no unique constraint, so re-running the seed relies on
    // these titles telling the four apart.
    expect(new Set(stories.map((story) => story.title_cyr)).size).toBe(stories.length);
    for (const story of stories) {
      expect(story.title_cyr, story.title_cyr).toMatch(SERBIAN_CYRILLIC);
    }
  });

  it('states a word_count the body actually has', () => {
    // Seeded as given (README), so a drifted count would be stored as fact and
    // shown on the reader's list.
    for (const story of stories) {
      const words = story.body_cyr.split(/\s+/).filter(Boolean);
      expect(words.length, story.title_cyr).toBe(story.word_count);
    }
  });

  it('stays in the 40-80 word band a warm-up read needs', () => {
    for (const story of stories) {
      expect(story.word_count, story.title_cyr).toBeGreaterThanOrEqual(40);
      expect(story.word_count, story.title_cyr).toBeLessThanOrEqual(80);
    }
  });

  it('writes every body in Serbian Cyrillic only, in short sentences', () => {
    for (const story of stories) {
      expect(story.body_cyr, story.title_cyr).toMatch(SERBIAN_CYRILLIC);
      expect(latToCyr(cyrToLat(story.body_cyr)), story.title_cyr).toBe(story.body_cyr);
      for (const sentence of story.body_cyr.split(/[.!?]+/)) {
        const words = sentence.split(/\s+/).filter(Boolean);
        expect(words.length, `"${sentence.trim()}" in ${story.title_cyr}`).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe('the user-content seed script', () => {
  it('reads both content files', () => {
    expect(script).toContain('ghmily-book.json');
    expect(script).toContain('stories.json');
  });

  it("marks the book as Claude's rendering, ready to read", () => {
    // `source: 'claude'` is what makes the book screen label it a rendering
    // rather than the printed text; `status: 'ready'` because every page
    // arrives with text and nothing is awaiting transcription.
    expect(script).toContain("source: 'claude'");
    expect(script).toContain("status: 'ready'");
    expect(script).toContain('photo_path: null');
  });

  it('inserts only, so a re-run cannot undo reading progress', () => {
    // No upsert and no update anywhere: a finished story or an edited page
    // survives the next seed.
    expect(script).not.toContain('.upsert(');
    expect(script).not.toContain('.update(');
    expect(script).not.toContain('finished_at:');
  });

  it('matches what is already there before inserting', () => {
    // The book by (user, title, source), its pages by page number, the stories
    // by title -- the three checks that make the script safe to re-run.
    expect(script).toContain("eq('title_cyr', book.title_cyr)");
    expect(script).toContain("eq('source', 'claude')");
    expect(script).toContain('have.has(page.page_no)');
    expect(script).toContain('have.has(story.title_cyr)');
  });

  it('needs the service role, because these tables are owner-only', () => {
    expect(script).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(script).toContain('auth.admin.listUsers');
  });
});
