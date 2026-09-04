-- The letters leave the spaced-repetition system.
--
-- Phase 3 scheduled the thirty letter cards with FSRS, exactly like words: five
-- new ones a day, then "come back tomorrow". That is the wrong shape for an
-- alphabet. Mark asked for the opposite -- "I want to be able to drill again and
-- again as much as I want... I don't want cards / letters unavailable for
-- practice" -- so the letters drill (`app/(app)/letters.tsx`) always offers all
-- thirty and never withholds one.
--
-- What replaces the schedule is a tally, not a schedule: how often each letter
-- was found easy, how often it was not, and how many times in a row it has been
-- got right. The tally only *orders* a run (shakiest first) and marks a letter
-- solid at three in a row. Nothing in it can make a letter unavailable.
--
-- `drill_stats` is the neighbouring table and is deliberately left alone: that
-- one is the Cyrillic *trainer's* per-letter typing accuracy (single lowercase
-- letters, keyed by `CYRILLIC_ALPHABET`), and it is what the Alphabet stage's
-- progress is still measured by. This table is the flashcard drill's own record,
-- keyed by the card, and the two answer different questions.

-- ---------------------------------------------------------------------------
-- letter_stats: one row per (user, letter card).
--
-- `letter` is the card's `sr_cyr`, i.e. the pair as printed -- "Б б", not "б".
-- That is the card's own unique key, so a row can always be traced back to the
-- card it came from, and it can never be confused with a `drill_stats.letter`
-- (a single lowercase glyph) if the two are ever read side by side.
--
-- `streak` is consecutive "Got it"s: bumped on easy, reset to zero on hard.
-- Three in a row is "solid", which is a label on the alphabet browser and the
-- filter behind "Only the tricky ones" -- never a lock.
--
-- Owner-only RLS, the same four policies `drill_stats` carries.
-- ---------------------------------------------------------------------------
create table public.letter_stats (
  user_id   uuid not null references auth.users (id) on delete cascade,
  letter    text not null,
  easy      int not null default 0,
  hard      int not null default 0,
  streak    int not null default 0,
  last_seen timestamptz,
  primary key (user_id, letter)
);

alter table public.letter_stats enable row level security;

create policy letter_stats_select_own on public.letter_stats
  for select to authenticated
  using (user_id = auth.uid());

create policy letter_stats_insert_own on public.letter_stats
  for insert to authenticated
  with check (user_id = auth.uid());

create policy letter_stats_update_own on public.letter_stats
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy letter_stats_delete_own on public.letter_stats
  for delete to authenticated
  using (user_id = auth.uid());

-- Supabase's default privileges hand every new table in `public` to `anon` as
-- well as to `authenticated`, so the REVOKE is what makes the grant below the
-- truth rather than a comment (the same reasoning as `xp_events` in
-- 20260830150000_phase3_schema.sql).
revoke all on public.letter_stats from authenticated, anon;
grant select, insert, update, delete on public.letter_stats to authenticated;
grant all on public.letter_stats to service_role;

-- ---------------------------------------------------------------------------
-- rate_letter: one rating, recorded atomically.
--
-- The same problem `bump_drill_stats` solves: PostgREST's upsert
-- (`Prefer: resolution=merge-duplicates`) *replaces* a count rather than adding
-- to it, so the client-side alternative is read-modify-write, which loses a
-- rating whenever two tabs or a retry overlap. `on conflict do update set easy =
-- ls.easy + 1` inside the database has no such window.
--
-- It also writes the XP, which `awardXp` would otherwise do in a second request.
-- Here that matters more than it does for a review: a rating is a small event,
-- the drill fires one every couple of seconds, and the ring and the day streak
-- are both read off `xp_events`. One statement in one transaction is what stops
-- a rating being counted for the tally but not for the day.
--
-- SECURITY INVOKER (the default, stated because it is load-bearing, and the
-- house rule for every RPC in this schema): the function runs as the caller, so
-- `letter_stats`'s and `xp_events`'s owner-only policies still apply. `user_id`
-- comes from `auth.uid()`, never from an argument, so a client cannot write
-- somebody else's counters even by asking.
-- ---------------------------------------------------------------------------
create function public.rate_letter(
  p_letter text,
  p_got_it boolean
)
returns public.letter_stats
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row     public.letter_stats;
begin
  -- RLS would refuse the write anyway; failing here says why.
  if v_user_id is null then
    raise exception 'rate_letter requires an authenticated user'
      using errcode = '28000';
  end if;

  if p_letter is null or btrim(p_letter) = '' then
    raise exception 'rate_letter: p_letter must name a letter card'
      using errcode = '22023';
  end if;

  if p_got_it is null then
    raise exception 'rate_letter: p_got_it must be true or false'
      using errcode = '22023';
  end if;

  insert into public.letter_stats as ls (user_id, letter, easy, hard, streak, last_seen)
  values (
    v_user_id,
    p_letter,
    case when p_got_it then 1 else 0 end,
    case when p_got_it then 0 else 1 end,
    case when p_got_it then 1 else 0 end,
    now()
  )
  on conflict (user_id, letter) do update set
    easy   = ls.easy + case when p_got_it then 1 else 0 end,
    hard   = ls.hard + case when p_got_it then 0 else 1 end,
    -- "Not yet" does not decrement; it resets. A run of three is meant to say
    -- "three in a row", and subtracting one would let a letter creep to solid
    -- on a long enough history of getting it wrong.
    streak = case when p_got_it then ls.streak + 1 else 0 end,
    last_seen = now()
  returning ls.* into v_row;

  -- 2 XP, the same tariff a word review pays (`XP_AWARDS.review` in
  -- `lib/xp.ts`, spec §10 -- one review tariff, not one per activity). The
  -- literal is checked against that constant by `lib/__tests__/letters.test.ts`,
  -- because nothing else spans the two languages.
  insert into public.xp_events (user_id, amount, kind)
  values (v_user_id, 2, 'review');

  return v_row;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC, and Supabase's own
-- default privileges hand it to `anon` as well. Take both back and grant
-- explicitly, the same way every function in this schema does.
revoke execute on function public.rate_letter(text, boolean) from public;
revoke execute on function public.rate_letter(text, boolean) from anon;
grant execute on function public.rate_letter(text, boolean) to authenticated;
grant execute on function public.rate_letter(text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- The letters leave `user_cards`.
--
-- Their scheduling rows are what made a letter "not due", and nothing reads them
-- any more: the drill orders itself from `letter_stats`, the dashboard counts
-- solid letters rather than due ones, and the review screen is words only. Left
-- in place they would be silent junk that the Words ladder has to keep
-- explaining why it excludes.
--
-- `review_logs` is deliberately NOT cleaned out. Those rows are history -- days
-- on which Mark actually studied -- and the day streak counts them. Deleting
-- them would shorten a streak he earned.
-- ---------------------------------------------------------------------------
delete from public.user_cards
using public.cards
where cards.id = user_cards.card_id
  and cards.kind = 'letter';
