import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { gradeCard } from '@/lib/fsrs';
import { SUBMIT_REVIEW_FN, submitReviewParams } from '@/lib/reviewRpc';
import type { ReviewLogInsert, UserCardRow } from '@/lib/types';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260830000000_submit_review.sql'),
  'utf8',
);

const USER_ID = '11111111-1111-1111-1111-111111111111';
const CARD_ID = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-08-30T12:00:00.000Z');

const next: UserCardRow = {
  user_id: USER_ID,
  card_id: CARD_ID,
  due: '2026-09-01T12:00:00.000Z',
  stability: 2.31,
  difficulty: 5.5,
  reps: 3,
  lapses: 1,
  state: 'review',
  last_review: NOW.toISOString(),
};

const log: ReviewLogInsert = {
  user_id: USER_ID,
  card_id: CARD_ID,
  grade: 3,
  state_before: 'learning',
  state_after: 'review',
  elapsed_days: 1.5,
};

/** The `p_*` argument names the migration declares, in declaration order. */
function migrationParameterNames(): string[] {
  const signature = migration.slice(
    migration.indexOf('create function public.submit_review('),
    migration.indexOf('returns public.user_cards'),
  );
  return [...signature.matchAll(/^\s*(p_[a-z_]+)\s+/gm)].map((match) => match[1]);
}

describe('submitReviewParams', () => {
  it('maps the graded row and its log onto the function arguments', () => {
    expect(submitReviewParams(next, log)).toEqual({
      p_card_id: CARD_ID,
      p_due: next.due,
      p_stability: 2.31,
      p_difficulty: 5.5,
      p_reps: 3,
      p_lapses: 1,
      p_state: 'review',
      p_last_review: next.last_review,
      p_grade: 3,
      p_state_before: 'learning',
      p_state_after: 'review',
      p_elapsed_days: 1.5,
    });
  });

  it('never sends a user id — the function takes it from auth.uid()', () => {
    const params = submitReviewParams(next, log);
    expect(Object.keys(params)).not.toContain('p_user_id');
    expect(JSON.stringify(params)).not.toContain(USER_ID);
  });

  it('passes the optional log columns through as null rather than dropping them', () => {
    const params = submitReviewParams(next, {
      user_id: USER_ID,
      card_id: CARD_ID,
      grade: 1,
    });
    expect(params.p_state_before).toBeNull();
    expect(params.p_state_after).toBeNull();
    expect(params.p_elapsed_days).toBeNull();
  });

  it('keeps `last_review` null for a row that has never been reviewed', () => {
    expect(submitReviewParams({ ...next, last_review: null }, log).p_last_review).toBeNull();
  });

  it('carries a real gradeCard result, so the two stay in step', () => {
    const fresh: UserCardRow = {
      user_id: USER_ID,
      card_id: CARD_ID,
      due: NOW.toISOString(),
      stability: 0,
      difficulty: 0,
      reps: 0,
      lapses: 0,
      state: 'new',
      last_review: null,
    };
    const graded = gradeCard(fresh, 3, NOW);
    const params = submitReviewParams(graded.next, graded.log);

    expect(params.p_state).toBe(graded.next.state);
    expect(params.p_state).not.toBe('new'); // the whole point of grading it
    expect(params.p_state_before).toBe('new'); // what the daily allowance counts
    expect(params.p_due).toBe(graded.next.due);
    expect(params.p_reps).toBe(1);
  });
});

describe('the client and the migration agree on the contract', () => {
  it('sends exactly the arguments the function declares', () => {
    // A renamed argument on either side is a runtime 404 from PostgREST, which
    // no amount of type-checking would catch -- the SQL is not TypeScript.
    expect(Object.keys(submitReviewParams(next, log)).sort()).toEqual(
      migrationParameterNames().sort(),
    );
  });

  it('names the function the migration creates', () => {
    expect(migration).toContain(`create function public.${SUBMIT_REVIEW_FN}(`);
  });

  it('the migration found its arguments at all (guards the regex above)', () => {
    expect(migrationParameterNames()).toHaveLength(12);
  });

  it('keeps the function under the caller’s RLS, not the definer’s', () => {
    expect(migration).toContain('security invoker');
    expect(migration).not.toContain('security definer');
  });

  it('grants execute explicitly and takes the default PUBLIC grant back', () => {
    expect(migration).toMatch(/revoke execute on function public\.submit_review\(/);
    expect(migration).toMatch(/grant execute on function public\.submit_review\([\s\S]*?\) to authenticated;/);
  });

  it('fills user_id from auth.uid() rather than trusting an argument', () => {
    expect(migration).toContain('auth.uid()');
    expect(migrationParameterNames()).not.toContain('p_user_id');
  });

  it('writes both tables in the one function body', () => {
    expect(migration).toContain('insert into public.user_cards');
    expect(migration).toContain('insert into public.review_logs');
  });
});
