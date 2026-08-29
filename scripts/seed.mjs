#!/usr/bin/env node
/**
 * Seed `public.cards` from `data/seed-deck.json`.
 *
 * Idempotent: rows are upserted on the unique `sr_cyr` column with
 * `ignoreDuplicates`, i.e. `on conflict (sr_cyr) do nothing`, so re-running
 * adds new cards without touching (or duplicating) the ones already there.
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
const deckPath = path.join(scriptDir, '..', 'data', 'seed-deck.json');

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

const cards = JSON.parse(await readFile(deckPath, 'utf8'));
console.log(`Seeding ${cards.length} cards into ${supabaseUrl} ...`);

for (let start = 0; start < cards.length; start += BATCH_SIZE) {
  const batch = cards.slice(start, start + BATCH_SIZE);
  const { error } = await supabase
    .from('cards')
    .upsert(batch, { onConflict: 'sr_cyr', ignoreDuplicates: true });

  if (error) {
    console.error(`Batch starting at ${start} failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`  ...${Math.min(start + BATCH_SIZE, cards.length)}/${cards.length}`);
}

const { count, error: countError } = await supabase
  .from('cards')
  .select('*', { count: 'exact', head: true });

if (countError) {
  console.error(`Could not count cards: ${countError.message}`);
  process.exit(1);
}

console.log(`Done. public.cards now holds ${count} rows.`);
