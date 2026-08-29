/**
 * The wire contract for `public.submit_review`
 * (`supabase/migrations/20260830000000_submit_review.sql`).
 *
 * Scheduling a card writes two rows — the `user_cards` state and the
 * `review_logs` entry — and they must land together, so the write goes through
 * one Postgres function instead of two PostgREST requests. This module is the
 * translation between the FSRS result and that function's arguments, kept free
 * of Supabase imports so the mapping can be tested against the migration itself.
 *
 * Argument names here and in the SQL are one contract with no compiler across
 * it: rename one side and PostgREST answers 404 at runtime. `reviewRpc.test.ts`
 * parses the migration and compares, which is what stops that happening.
 */

import type { ReviewLogInsert, UserCardRow } from '@/lib/types';

/** The function's name, as `supabase.rpc()` needs it. */
export const SUBMIT_REVIEW_FN = 'submit_review';

export interface SubmitReviewParams {
  p_card_id: string;
  p_due: string;
  p_stability: number;
  p_difficulty: number;
  p_reps: number;
  p_lapses: number;
  p_state: string;
  p_last_review: string | null;
  p_grade: number;
  p_state_before: string | null;
  p_state_after: string | null;
  p_elapsed_days: number | null;
}

/**
 * A `gradeCard` result as `submit_review` arguments.
 *
 * Deliberately no `p_user_id`: the function fills `user_id` from `auth.uid()`,
 * so the id never travels on the wire and a client cannot ask to write somebody
 * else's row.
 */
export function submitReviewParams(
  next: UserCardRow,
  log: ReviewLogInsert,
): SubmitReviewParams {
  return {
    p_card_id: next.card_id,
    p_due: next.due,
    p_stability: next.stability,
    p_difficulty: next.difficulty,
    p_reps: next.reps,
    p_lapses: next.lapses,
    p_state: next.state,
    p_last_review: next.last_review,
    p_grade: log.grade,
    p_state_before: log.state_before ?? null,
    p_state_after: log.state_after ?? null,
    p_elapsed_days: log.elapsed_days ?? null,
  };
}
