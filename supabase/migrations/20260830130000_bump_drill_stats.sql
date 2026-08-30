-- Incrementing the Cyrillic trainer's per-letter counters.
--
-- A drill answer adds to `drill_stats.attempts` / `.correct` for every letter of
-- the word. PostgREST's upsert cannot do that: `Prefer: resolution=merge-
-- duplicates` writes `excluded.attempts`, i.e. it *replaces* the count, so the
-- only client-side alternative is read-modify-write -- which loses an increment
-- whenever two tabs (or a retry) overlap. `on conflict do update set attempts =
-- ds.attempts + excluded.attempts` inside the database has no such window.
--
-- One call carries a whole word (or a whole round): three parallel arrays rather
-- than a row per request, so a ten-word round is ten small writes at most and
-- never one per keystroke.
--
-- SECURITY INVOKER (the default, stated because it is load-bearing): the
-- function runs as the caller, so `drill_stats`'s owner-only RLS policies still
-- apply. `user_id` comes from `auth.uid()`, never from an argument, so a client
-- cannot write somebody else's counters even by asking.

create function public.bump_drill_stats(
  p_letters  text[],
  p_attempts int[],
  p_correct  int[]
)
returns setof public.drill_stats
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  -- RLS would refuse the write anyway; failing here says why.
  if v_user_id is null then
    raise exception 'bump_drill_stats requires an authenticated user'
      using errcode = '28000';
  end if;

  if coalesce(array_length(p_letters, 1), 0) <> coalesce(array_length(p_attempts, 1), 0)
     or coalesce(array_length(p_letters, 1), 0) <> coalesce(array_length(p_correct, 1), 0) then
    raise exception 'bump_drill_stats: the three arrays must be the same length'
      using errcode = '22023';
  end if;

  -- Nonsense counts would poison the accuracy the drill picks its words by, and
  -- nothing downstream could tell them from real ones.
  if exists (
    select 1
    from unnest(p_attempts, p_correct) as d(attempts, correct)
    where d.attempts < 0 or d.correct < 0 or d.correct > d.attempts
  ) then
    raise exception 'bump_drill_stats: need 0 <= correct <= attempts'
      using errcode = '22023';
  end if;

  return query
  with delta as (
    -- Grouped, not just unnested: `on conflict do update` refuses to touch the
    -- same row twice in one statement, so a letter listed twice would abort the
    -- whole call rather than add up.
    select
      d.letter             as letter,
      sum(d.attempts)::int as attempts,
      sum(d.correct)::int  as correct
    from unnest(p_letters, p_attempts, p_correct) as d(letter, attempts, correct)
    group by d.letter
  )
  insert into public.drill_stats as ds (user_id, letter, attempts, correct)
  select v_user_id, c.letter, c.attempts, c.correct from delta c
  on conflict (user_id, letter) do update set
    attempts = coalesce(ds.attempts, 0) + excluded.attempts,
    correct  = coalesce(ds.correct, 0) + excluded.correct
  returning ds.*;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC, and Supabase's own
-- default privileges hand it to `anon` as well. Take both back and grant
-- explicitly, the same way every table in this schema does.
revoke execute on function public.bump_drill_stats(text[], int[], int[]) from public;
revoke execute on function public.bump_drill_stats(text[], int[], int[]) from anon;
grant execute on function public.bump_drill_stats(text[], int[], int[]) to authenticated;
grant execute on function public.bump_drill_stats(text[], int[], int[]) to service_role;
