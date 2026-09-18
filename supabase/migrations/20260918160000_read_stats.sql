-- "Read it": the same drill the letters get, for whole words.
--
-- Mark learnt the alphabet letter by letter (`app/(app)/letters.tsx`) and asked
-- for the same thing one level up: see a word in Cyrillic and nothing else, read
-- it out loud, say what it means, turn it over to check. That is a *reading*
-- exercise, not a vocabulary one -- the word may well be one he already knows in
-- speech -- so it has its own record and leaves the review queue alone.
--
-- Like `letter_stats`, and for the same reason, what this table holds is a tally
-- and not a schedule: how often a word was read, how often it was not, and how
-- many times in a row it has come out right. The tally only *orders* a run
-- (shakiest first) and marks a word solid at three in a row. Nothing in it can
-- make a word unavailable to practise.
--
-- `user_cards` is the neighbouring table and is deliberately left alone: that
-- one is the spaced-repetition system's scheduling state for the *meaning* of a
-- word, and it is what the Words ladder counts. Reading a word aloud is not
-- answering a review, so a rating here never touches it.

-- ---------------------------------------------------------------------------
-- read_stats: one row per (user, word card).
--
-- Keyed by `card_id` rather than by the headword: unlike a letter pair, a word
-- can be edited (`updateCard`), and a tally keyed by text would be orphaned the
-- moment a typo in `sr_cyr` was fixed. The FK takes the row with the card when
-- one is deleted.
--
-- `streak` is consecutive "Got it"s: bumped on got it, reset to zero on not yet.
-- Three in a row is "solid", which is a count on the theme picker -- never a
-- lock.
--
-- Owner-only, and no DELETE at all: a tally is a record of practice done, and
-- nothing in the app removes one.
--
-- Nothing in the app writes this table directly either -- every write goes
-- through `rate_read` below, which has to add to a count and pay the XP in one
-- transaction. That is a convention rather than a wall, deliberately:
-- `rate_read` is `security invoker` (the house rule for every function in this
-- schema), so it writes *as the caller* and the INSERT and UPDATE policies have
-- to exist for it to work at all. Taking them away would not lock the client
-- out, it would break the RPC. What the policies do guarantee is the thing that
-- matters: `user_id = auth.uid()`, so no caller can touch anybody else's tally
-- by any route.
-- ---------------------------------------------------------------------------
create table public.read_stats (
  user_id   uuid not null references auth.users (id) on delete cascade,
  card_id   uuid not null references public.cards (id) on delete cascade,
  easy      int not null default 0,
  hard      int not null default 0,
  streak    int not null default 0,
  last_seen timestamptz not null default now(),
  primary key (user_id, card_id)
);

alter table public.read_stats enable row level security;

create policy read_stats_select_own on public.read_stats
  for select to authenticated
  using (user_id = auth.uid());

create policy read_stats_insert_own on public.read_stats
  for insert to authenticated
  with check (user_id = auth.uid());

create policy read_stats_update_own on public.read_stats
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Supabase's default privileges hand every new table in `public` to `anon` as
-- well as to `authenticated`, so the REVOKE is what makes the grant below the
-- truth rather than a comment (the same reasoning as `xp_events` in
-- 20260830150000_phase3_schema.sql).
revoke all on public.read_stats from authenticated, anon;
grant select, insert, update on public.read_stats to authenticated;
grant all on public.read_stats to service_role;

-- ---------------------------------------------------------------------------
-- rate_read: one reading, recorded atomically.
--
-- `rate_letter`'s twin, and it exists for the same two reasons. PostgREST's
-- upsert (`Prefer: resolution=merge-duplicates`) *replaces* a count rather than
-- adding to it, so the client-side alternative is read-modify-write, which loses
-- a rating whenever two tabs or a retry overlap. And the XP has to land in the
-- same transaction: the ring and the day streak are both read off `xp_events`,
-- so a rating that tallied but did not pay would be a morning's reading that the
-- dashboard never saw.
--
-- The same 2 XP and the same `review` kind a word review and a letter rating
-- pay (`XP_AWARDS.review` in `lib/xp.ts`, spec §10 -- one review tariff, not one
-- per activity), so a day spent reading words counts towards the streak exactly
-- as a day spent answering them. `xp_events.kind` is a checked enumeration
-- (20260830150000_phase3_schema.sql) and 'review' is a member of it; a new kind
-- would need that constraint changed, and would leave every existing reader of
-- the ledger to be checked.
--
-- SECURITY INVOKER (the default, stated because it is load-bearing, and the
-- house rule for every RPC in this schema): the function runs as the caller, so
-- `read_stats`'s and `xp_events`'s owner-only policies still apply. `user_id`
-- comes from `auth.uid()`, never from an argument, so a client cannot write
-- somebody else's counters even by asking.
-- ---------------------------------------------------------------------------
create function public.rate_read(
  p_card_id uuid,
  p_got_it  boolean
)
returns public.read_stats
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row     public.read_stats;
begin
  -- RLS would refuse the write anyway; failing here says why.
  if v_user_id is null then
    raise exception 'rate_read requires an authenticated user'
      using errcode = '28000';
  end if;

  if p_card_id is null then
    raise exception 'rate_read: p_card_id must name a card'
      using errcode = '22023';
  end if;

  if p_got_it is null then
    raise exception 'rate_read: p_got_it must be true or false'
      using errcode = '22023';
  end if;

  -- Words only, checked against the deck rather than taken on trust. A letter
  -- card's `sr_cyr` is a *pair* ("Б б") and there is nothing to read aloud and
  -- translate about it -- the letters have their own drill and their own tally
  -- -- and a stale client sending one would mint a row this screen would then
  -- show as a word. `cards` is readable by every signed-in user (the deck is
  -- shared), so this costs one primary-key probe and no privilege.
  if not exists (
    select 1 from public.cards
    where cards.id = p_card_id and cards.kind = 'word'
  ) then
    raise exception 'rate_read: % is not a word card', p_card_id
      using errcode = '22023';
  end if;

  insert into public.read_stats as rs (user_id, card_id, easy, hard, streak, last_seen)
  values (
    v_user_id,
    p_card_id,
    case when p_got_it then 1 else 0 end,
    case when p_got_it then 0 else 1 end,
    case when p_got_it then 1 else 0 end,
    now()
  )
  on conflict (user_id, card_id) do update set
    easy   = rs.easy + case when p_got_it then 1 else 0 end,
    hard   = rs.hard + case when p_got_it then 0 else 1 end,
    -- "Not yet" does not decrement; it resets. A run of three is meant to say
    -- "three in a row", and subtracting one would let a word creep to solid on
    -- a long enough history of getting it wrong.
    streak = case when p_got_it then rs.streak + 1 else 0 end,
    last_seen = now()
  returning rs.* into v_row;

  -- 2 XP, the same tariff a word review and a letter rating pay. The literal is
  -- checked against `XP_AWARDS.review` by `lib/__tests__/readDrill.test.ts`,
  -- because nothing else spans the two languages.
  insert into public.xp_events (user_id, amount, kind)
  values (v_user_id, 2, 'review');

  return v_row;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC, and Supabase's own
-- default privileges hand it to `anon` as well. Take both back and grant
-- explicitly, the same way every function in this schema does.
revoke execute on function public.rate_read(uuid, boolean) from public;
revoke execute on function public.rate_read(uuid, boolean) from anon;
grant execute on function public.rate_read(uuid, boolean) to authenticated;
grant execute on function public.rate_read(uuid, boolean) to service_role;
