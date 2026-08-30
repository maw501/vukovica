#!/usr/bin/env node
/**
 * Seed `public.cards` — the word deck — from the JSON files that hold it.
 *
 * Two sources, one table:
 *   data/seed-deck.json          the 681-card starter deck
 *   data/phase3/ghmily-vocab.json  43 cards for the first book Mark reads with
 *                                  his son, so tapping a word in "Погоди
 *                                  колико те волим" finds a gloss the app owns
 *                                  rather than one it has to ask a model for.
 * Both files have the same shape (`data/phase3/README.md`), so both go through
 * the same insert. Neither sets `kind`; the column defaults to 'word', which is
 * what keeps these rows out of the letters deck (the alphabet is seeded by
 * migration instead — see 20260830160000_seed_letters.sql for why the two
 * decks are loaded differently).
 *
 * Idempotent: rows are upserted on the unique `sr_cyr` column with
 * `ignoreDuplicates`, i.e. `on conflict (sr_cyr) do nothing`, so re-running
 * adds new cards without touching (or duplicating) the ones already there.
 *
 * Order matters a little. `api.fetchNewCards` hands out unseen cards in
 * `created_at` order, so a source seeded later queues behind one seeded
 * earlier. The starter deck goes first because it is the beginner path
 * (family, then baby, then home); the book's vocabulary is reachable from the
 * reader's gloss sheet from the moment it lands, whatever its place in the
 * review queue.
 *
 * Usage:
 *   npm run db:seed          # node --env-file=.env.local scripts/seed.mjs
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

/** Rows per request. Keeps each insert well inside PostgREST's limits. */
const BATCH_SIZE = 100;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(scriptDir, '..');

/** The card files, in the order they should reach the new-card queue. */
const SOURCES = [
  { label: 'starter deck', file: path.join(repoRoot, 'data', 'seed-deck.json') },
  { label: 'GHMILY vocabulary', file: path.join(repoRoot, 'data', 'phase3', 'ghmily-vocab.json') },
];

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

const supabaseUrl = requireEnv('SUPABASE_URL');
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

for (const source of SOURCES) {
  const cards = JSON.parse(await readFile(source.file, 'utf8'));
  console.log(`Seeding ${cards.length} cards (${source.label}) into ${supabaseUrl} ...`);

  for (let start = 0; start < cards.length; start += BATCH_SIZE) {
    const batch = cards.slice(start, start + BATCH_SIZE);
    const { error } = await supabase
      .from('cards')
      .upsert(batch, { onConflict: 'sr_cyr', ignoreDuplicates: true });

    if (error) {
      console.error(`Batch starting at ${start} of ${source.label} failed: ${error.message}`);
      process.exit(1);
    }

    console.log(`  ...${Math.min(start + BATCH_SIZE, cards.length)}/${cards.length}`);
  }
}

const { count, error: countError } = await supabase
  .from('cards')
  .select('*', { count: 'exact', head: true })
  .eq('kind', 'word');

if (countError) {
  console.error(`Could not count cards: ${countError.message}`);
  process.exit(1);
}

console.log(`Done. public.cards now holds ${count} word cards.`);
