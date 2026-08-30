#!/usr/bin/env node
/**
 * Seed the Phase 3 content that belongs to a *user* rather than to everybody:
 * the first book and the warm-up stories.
 *
 *   data/phase3/ghmily-book.json   one `books` row (source 'claude', status
 *                                  'ready') plus its 16 `book_pages`
 *   data/phase3/stories.json       four level-1 `stories`, unfinished
 *
 * Why a script and not a migration, when `letters.json` and `grammar.json` are
 * migrations: `books`, `book_pages` and `stories` are owner-only tables with a
 * `user_id` that references `auth.users`. A migration runs before any account
 * exists and has nobody to give the rows to. So this runs afterwards, with the
 * service role, against a named account — the same arrangement `seed.mjs` uses
 * for the deck, minus the "everyone shares it" part.
 *
 * Idempotent, per row rather than per file:
 *   - the book is matched on (user_id, title_cyr, source) and skipped if found;
 *   - its pages are matched on page_no within that book, so a book left half
 *     seeded by an interrupted run is completed rather than duplicated;
 *   - stories are matched on (user_id, title_cyr).
 * Nothing is ever updated: if Mark has edited a page or finished a story, a
 * re-run must not undo it.
 *
 * Usage:
 *   npm run db:seed:user                      # the only account in the project
 *   npm run db:seed:user -- mark@local.dev    # or name the account
 *   node --env-file=.env.local scripts/seed-user-content.mjs [email]
 *
 * With no email the script picks the project's single account and refuses if
 * there is more than one, because guessing which of two people gets a book is
 * worse than stopping.
 *
 * Environment (repo-root `.env.local`, git-ignored — see `.env.example`):
 *   SUPABASE_URL               e.g. http://127.0.0.1:54321
 *   SUPABASE_SERVICE_ROLE_KEY  service-role key; bypasses RLS. Never ship this
 *                              to the client bundle.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.join(scriptDir, '..', 'data', 'phase3');
const bookPath = path.join(contentDir, 'ghmily-book.json');
const storiesPath = path.join(contentDir, 'stories.json');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `Missing ${name}. Copy .env.example to .env.local and fill in the seeding section\n` +
        '(local values come from `npx supabase status`).',
    );
    process.exit(1);
  }
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const supabaseUrl = requireEnv('SUPABASE_URL');
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * The account these rows belong to.
 *
 * `listUsers` is a service-role admin call; it is the only way to turn an email
 * into a uuid, because `auth.users` is not exposed through PostgREST.
 */
async function resolveUser(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (error) fail(`Could not list users: ${error.message}`);

  const users = data.users ?? [];
  if (users.length === 0) {
    fail('No accounts yet. Sign up in the app first (README, "Run it"), then re-run this.');
  }

  if (email) {
    const wanted = email.trim().toLowerCase();
    const match = users.find((user) => (user.email ?? '').toLowerCase() === wanted);
    if (!match) {
      fail(`No account with email ${email}. Known: ${users.map((u) => u.email).join(', ')}`);
    }
    return match;
  }

  if (users.length > 1) {
    fail(
      'More than one account exists; name the one to seed:\n' +
        `  npm run db:seed:user -- ${users[0].email}\n` +
        `Known: ${users.map((u) => u.email).join(', ')}`,
    );
  }
  return users[0];
}

/** The GHMILY book and its pages. Returns a line for the summary. */
async function seedBook(userId) {
  const book = JSON.parse(await readFile(bookPath, 'utf8'));

  const existing = await supabase
    .from('books')
    .select('id')
    .eq('user_id', userId)
    .eq('title_cyr', book.title_cyr)
    .eq('source', 'claude')
    .maybeSingle();
  if (existing.error) fail(`Could not look for the book: ${existing.error.message}`);

  let bookId = existing.data?.id ?? null;
  let created = false;

  if (!bookId) {
    const inserted = await supabase
      .from('books')
      .insert({
        user_id: userId,
        title_cyr: book.title_cyr,
        title_en: book.title_en,
        // 'ready' because every page arrives with its text: nothing is waiting
        // on a transcription. 'claude' is what makes the book screen label it
        // as a rendering rather than as the printed book (spec §6).
        source: 'claude',
        status: 'ready',
      })
      .select('id')
      .single();
    if (inserted.error) fail(`Could not insert the book: ${inserted.error.message}`);
    bookId = inserted.data.id;
    created = true;
  }

  const pages = await supabase.from('book_pages').select('page_no').eq('book_id', bookId);
  if (pages.error) fail(`Could not list the book's pages: ${pages.error.message}`);
  const have = new Set((pages.data ?? []).map((row) => row.page_no));

  const missing = book.pages
    .filter((page) => !have.has(page.page_no))
    .map((page) => ({
      book_id: bookId,
      user_id: userId,
      page_no: page.page_no,
      text_cyr: page.text_cyr,
      // No photograph: this is Claude's rendering. Photographing the real copy
      // is a separate book, added from the app.
      photo_path: null,
    }));

  if (missing.length > 0) {
    const { error } = await supabase.from('book_pages').insert(missing);
    if (error) fail(`Could not insert book pages: ${error.message}`);
  }

  return `book "${book.title_cyr}": ${created ? 'created' : 'already there'}, ${
    missing.length
  } of ${book.pages.length} pages added`;
}

/** The four warm-up stories. Returns a line for the summary. */
async function seedStories(userId) {
  const stories = JSON.parse(await readFile(storiesPath, 'utf8'));

  const existing = await supabase.from('stories').select('title_cyr').eq('user_id', userId);
  if (existing.error) fail(`Could not list stories: ${existing.error.message}`);
  const have = new Set((existing.data ?? []).map((row) => row.title_cyr));

  const missing = stories
    .filter((story) => !have.has(story.title_cyr))
    .map((story) => ({
      user_id: userId,
      title_cyr: story.title_cyr,
      body_cyr: story.body_cyr,
      level: story.level,
      // Seeded as given: the file's counts were checked against the bodies, and
      // recounting here would be a second opinion nothing tests.
      word_count: story.word_count,
      // finished_at stays null -- these are to be read, not to be ticked off.
    }));

  if (missing.length > 0) {
    const { error } = await supabase.from('stories').insert(missing);
    if (error) fail(`Could not insert stories: ${error.message}`);
  }

  return `stories: ${missing.length} of ${stories.length} added`;
}

const user = await resolveUser(process.argv[2]);
console.log(`Seeding user content for ${user.email} (${user.id}) into ${supabaseUrl} ...`);
console.log(`  ${await seedBook(user.id)}`);
console.log(`  ${await seedStories(user.id)}`);
console.log('Done.');
