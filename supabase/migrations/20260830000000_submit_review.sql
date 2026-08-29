-- Atomic review submission.
--
-- Grading a card is two writes: the rescheduled `user_cards` row and the
-- `review_logs` entry recording the answer. As two PostgREST requests they can
-- half-succeed, and a missing log is not a cosmetic loss -- it is what
-- `newDoneToday` counts (the daily new-card allowance) and what the streak is
-- built from. An advanced `user_cards` row with no log therefore under-counts
-- both *and* keeps the card out of the new pile, so nothing ever puts it right.
-- One function, one statement, one transaction: both writes land or neither does.
--
-- SECURITY INVOKER (the default, stated here because it is load-bearing): the
-- function runs as the caller, so the RLS policies on both tables still apply.
-- `user_id` comes from `auth.uid()` rather than from an argument, so a client
-- cannot write a row for anybody else even by asking.

create function public.submit_review(
  p_card_id      uuid,
  p_due          timestamptz,
  p_stability    float8,
  p_difficulty   float8,
  p_reps         int,
  p_lapses       int,
  p_state        text,
  p_last_review  timestamptz,
  p_grade        int,
  p_state_before text,
  p_state_after  text,
  p_elapsed_days float8
)
returns public.user_cards
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row     public.user_cards;
begin
  -- RLS would refuse the writes anyway; failing here says why.
  if v_user_id is null then
    raise exception 'submit_review requires an authenticated user'
      using errcode = '28000';
  end if;

  -- The upsert is where a never-studied card gets its row: the client holds no
  -- `user_cards` row for it until this runs, which is what keeps a displayed-
  -- but-unanswered card out of both the due count and the daily allowance.
  insert into public.user_cards as uc
    (user_id, card_id, due, stability, difficulty, reps, lapses, state, last_review)
  values
    (v_user_id, p_card_id, p_due, p_stability, p_difficulty,
     p_reps, p_lapses, p_state, p_last_review)
  on conflict (user_id, card_id) do update set
    due         = excluded.due,
    stability   = excluded.stability,
    difficulty  = excluded.difficulty,
    reps        = excluded.reps,
    lapses      = excluded.lapses,
    state       = excluded.state,
    last_review = excluded.last_review
  returning uc.* into v_row;

  insert into public.review_logs
    (user_id, card_id, grade, state_before, state_after, elapsed_days)
  values
    (v_user_id, p_card_id, p_grade, p_state_before, p_state_after, p_elapsed_days);

  return v_row;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC, and Supabase's own
-- default privileges hand it to `anon` as well. Take both back and grant
-- explicitly, the same way every table in this schema does. `anon` calling this
-- would fail on the auth.uid() check above anyway -- this is so it cannot even
-- reach it.
revoke execute on function public.submit_review(
  uuid, timestamptz, float8, float8, int, int, text, timestamptz, int, text, text, float8
) from public;

revoke execute on function public.submit_review(
  uuid, timestamptz, float8, float8, int, int, text, timestamptz, int, text, text, float8
) from anon;

grant execute on function public.submit_review(
  uuid, timestamptz, float8, float8, int, int, text, timestamptz, int, text, text, float8
) to authenticated;

grant execute on function public.submit_review(
  uuid, timestamptz, float8, float8, int, int, text, timestamptz, int, text, text, float8
) to service_role;
