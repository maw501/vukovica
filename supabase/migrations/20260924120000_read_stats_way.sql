-- Practise's "Meaning" stops being spaced repetition and becomes a drill.
--
-- Mark: "I want to drill all words - I don't want spaced repetition delays at
-- the moment." Meaning used to be the review queue limited to one set, which
-- meant most of a set was out of reach on any given day. It is now the Read
-- aloud run the other way round: the English on the face, say the Serbian, turn
-- it over to check. Same runs, same Got it / Not yet, same XP, no schedule.
--
-- It needs a tally of its own. Reading "мама" off the page and producing it from
-- "mum" are different skills, and one shared streak would let three good
-- readings make a word look solid in a drill he has never done. So `read_stats`
-- grows a `way` column and becomes one row per (user, card, way). Every row that
-- exists today is a reading, hence the default.
--
-- `user_cards` is still left alone, for the reason 20260918160000_read_stats.sql
-- gives: that table is the flashcard schedule, and nothing here is a flashcard.

-- ---------------------------------------------------------------------------
-- read_stats.way
--
-- A checked text column rather than an enum type: two values, and a new one
-- is a one-line constraint change rather than an `alter type` that cannot run
-- inside a transaction on older Postgres.
--
-- Part of the primary key, so the (user, card) upsert in `rate_read` below
-- becomes a (user, card, way) one and the two tallies can never collide. The
-- existing key is dropped and rebuilt; the rows already in it are all 'read'
-- by the default, so the new key is unique the moment it is created.
-- ---------------------------------------------------------------------------
alter table public.read_stats
  add column way text not null default 'read'
    constraint read_stats_way_check check (way in ('read', 'meaning'));

alter table public.read_stats drop constraint read_stats_pkey;
alter table public.read_stats add primary key (user_id, card_id, way);

-- ---------------------------------------------------------------------------
-- rate_read(p_card_id, p_got_it, p_way)
--
-- Dropped and recreated rather than overloaded. Two functions called
-- `rate_read` would leave PostgREST choosing between them by argument names,
-- and a 2-arg one left behind would be a second copy of the tally logic to keep
-- right. `p_way` has a default instead, so a client still sending only
-- `p_card_id` and `p_got_it` — the one in people's browsers until they reload —
-- keeps working and keeps writing reading tallies, exactly as before.
--
-- The return type is still `public.read_stats`, which now carries `way`; the
-- drop is what lets the recreated function return the widened row.
--
-- Everything else is 20260918160000_read_stats.sql's function unchanged: words
-- only, add rather than replace, "Not yet" resets the streak, 2 XP of kind
-- 'review' in the same transaction.
--
-- SECURITY INVOKER (the house rule for every RPC in this schema): the function
-- runs as the caller, so `read_stats`'s and `xp_events`'s owner-only policies
-- still apply, and `user_id` comes from `auth.uid()`, never from an argument.
-- ---------------------------------------------------------------------------
drop function public.rate_read(uuid, boolean);

create function public.rate_read(
  p_card_id uuid,
  p_got_it  boolean,
  p_way     text default 'read'
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

  -- The column's check constraint would refuse it too, but as a constraint
  -- violation naming a table the client never mentioned. This names the
  -- argument.
  if p_way is null or p_way not in ('read', 'meaning') then
    raise exception 'rate_read: p_way must be ''read'' or ''meaning'''
      using errcode = '22023';
  end if;

  -- Words only, checked against the deck rather than taken on trust: a letter
  -- card's `sr_cyr` is a pair, and the letters have their own drill and tally.
  if not exists (
    select 1 from public.cards
    where cards.id = p_card_id and cards.kind = 'word'
  ) then
    raise exception 'rate_read: % is not a word card', p_card_id
      using errcode = '22023';
  end if;

  insert into public.read_stats as rs (user_id, card_id, way, easy, hard, streak, last_seen)
  values (
    v_user_id,
    p_card_id,
    p_way,
    case when p_got_it then 1 else 0 end,
    case when p_got_it then 0 else 1 end,
    case when p_got_it then 1 else 0 end,
    now()
  )
  on conflict (user_id, card_id, way) do update set
    easy   = rs.easy + case when p_got_it then 1 else 0 end,
    hard   = rs.hard + case when p_got_it then 0 else 1 end,
    -- "Not yet" resets rather than decrements: three in a row means three in
    -- a row.
    streak = case when p_got_it then rs.streak + 1 else 0 end,
    last_seen = now()
  returning rs.* into v_row;

  -- 2 XP, the same tariff a word review and a letter rating pay. The literal is
  -- checked against `XP_AWARDS.review` by `lib/__tests__/readDrill.test.ts`.
  insert into public.xp_events (user_id, amount, kind)
  values (v_user_id, 2, 'review');

  return v_row;
end;
$$;

-- A dropped function takes its grants with it, and Postgres hands EXECUTE on
-- the new one to PUBLIC (Supabase's default privileges add `anon`). Take both
-- back and grant explicitly, the same way every function in this schema does.
revoke execute on function public.rate_read(uuid, boolean, text) from public;
revoke execute on function public.rate_read(uuid, boolean, text) from anon;
grant execute on function public.rate_read(uuid, boolean, text) to authenticated;
grant execute on function public.rate_read(uuid, boolean, text) to service_role;
