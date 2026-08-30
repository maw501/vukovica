import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `bump_grammar_stats` has no client wrapper yet — the grammar screen builds one
 * later — so these are the migration-text assertions alone, the same guards
 * `reviewRpc.test.ts` and `drills.test.ts` put on the other two RPCs. They are
 * cheap and they catch the class of mistake nothing else can: the SQL is not
 * TypeScript, so a `security definer` slipped in during a later edit, or a
 * `p_user_id` argument added "for convenience", would type-check perfectly and
 * hand one user's counters to another.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260830150000_phase3_schema.sql'),
  'utf8',
);

/** The `p_*` argument names the migration declares, in declaration order. */
function migrationParameterNames(): string[] {
  const signature = migration.slice(
    migration.indexOf('create function public.bump_grammar_stats('),
    migration.indexOf('returns public.grammar_stats'),
  );
  return [...signature.matchAll(/^\s*(p_[a-z_]+)\s+/gm)].map((match) => match[1]);
}

describe('the bump_grammar_stats migration keeps its contract', () => {
  it('creates the function at all (guards every assertion below)', () => {
    expect(migration).toContain('create function public.bump_grammar_stats(');
  });

  it('declares exactly the three arguments the grammar drill will send', () => {
    expect(migrationParameterNames()).toEqual(['p_topic_id', 'p_attempts', 'p_correct']);
  });

  it('keeps the function under the caller’s RLS, not the definer’s', () => {
    expect(migration).toContain('security invoker');
    expect(migration).not.toContain('security definer');
  });

  it('fills user_id from auth.uid() rather than trusting an argument', () => {
    expect(migration).toContain('auth.uid()');
    expect(migrationParameterNames()).not.toContain('p_user_id');
  });

  it('adds to the existing counts instead of replacing them', () => {
    // The whole reason the RPC exists: PostgREST's upsert would write
    // `excluded.attempts` and silently lose every concurrent increment.
    expect(migration).toMatch(/attempts\s*=\s*gs\.attempts\s*\+/);
    expect(migration).toMatch(/correct\s*=\s*gs\.correct\s*\+/);
  });

  it('grants execute explicitly and takes the default PUBLIC and anon grants back', () => {
    expect(migration).toMatch(
      /revoke execute on function public\.bump_grammar_stats\([\s\S]*?\) from public;/,
    );
    expect(migration).toMatch(
      /revoke execute on function public\.bump_grammar_stats\([\s\S]*?\) from anon;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.bump_grammar_stats\([\s\S]*?\) to authenticated;/,
    );
  });
});
