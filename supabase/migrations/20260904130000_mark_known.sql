-- "I already know this."
--
-- Mark is a beginner, but not at every word: the deck holds 724 of them and a
-- fair few are ones he already has — the family words, the ones on every menu,
-- the ones his wife says twenty times a day. Grading those through the review
-- queue four at a time is a fortnight of taps to tell the app something he
-- already knows, and until he has, they are missing from "My words".
--
-- So the Deck screen and the review session both offer one button that says it
-- outright. It does two things and no more: the word appears under Known
-- immediately, and it does not come round again for a season.
--
-- What it deliberately does NOT do is pay XP. Every other write in this schema
-- that touches the ledger does so because work was done — a review answered, a
-- letter rated. Declaring a word known is not work, and paying for it would make
-- the fastest way to a day's XP a run down the deck tapping a button.
--
-- One statement rather than a PostgREST upsert, for the same reason
-- `bump_drill_stats` and `rate_letter` exist: `reps = greatest(uc.reps, 1)`
-- reads the row it is writing, and `Prefer: resolution=merge-duplicates` can
-- only replace. Read-modify-write from the client would lose a rep whenever a
-- review and a mark overlap.
--
-- SECURITY INVOKER (the default, stated because it is load-bearing, and the
-- house rule for every RPC in this schema): the function runs as the caller, so
-- `user_cards`'s owner-only policies still apply. `user_id` comes from
-- `auth.uid()`, never from an argument, so a client cannot write somebody
-- else's scheduling row even by asking.

create function public.mark_known(
  p_card_id uuid
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
  -- RLS would refuse the write anyway; failing here says why.
  if v_user_id is null then
    raise exception 'mark_known requires an authenticated user'
      using errcode = '28000';
  end if;

  if p_card_id is null then
    raise exception 'mark_known: p_card_id must name a card'
      using errcode = '22023';
  end if;

  -- Words only. The letters left `user_cards` in 20260904120000 -- they are
  -- drilled from `letter_stats` now and are not scheduled at all -- so a letter
  -- card arriving here would put back exactly the junk row that migration swept
  -- out, and inflate the Words ladder by one while it sat there.
  if not exists (
    select 1 from public.cards
    where cards.id = p_card_id and cards.kind = 'word'
  ) then
    raise exception 'mark_known: % is not a word card', p_card_id
      using errcode = '22023';
  end if;

  insert into public.user_cards as uc (
    user_id, card_id, due, stability, difficulty, reps, lapses, state, last_review
  )
  values (
    v_user_id,
    p_card_id,
    now() + interval '90 days',
    90,
    -- The middle of FSRS's 1..10 difficulty scale. `newUserCard` starts a card
    -- at 0, which is what "never graded" means and what the scheduler replaces
    -- on the first answer -- but this row goes straight into `review`, so the
    -- next real grade schedules *from* this number. 5 says "no evidence either
    -- way", where 0 would be clamped to 1 and read as the easiest word in the
    -- deck.
    5,
    1,
    0,
    'review',
    now()
  )
  on conflict (user_id, card_id) do update set
    due        = now() + interval '90 days',
    stability  = 90,
    state      = 'review',
    -- Never downwards: a word with a real review history keeps it, and one
    -- marked known without ever being answered still counts as seen once.
    -- `lapses` and `difficulty` are left exactly as they are for the same
    -- reason -- this is a shortcut past the queue, not an erasure of what
    -- happened before it.
    reps       = greatest(uc.reps, 1),
    last_review = now()
  returning uc.* into v_row;

  return v_row;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC, and Supabase's own
-- default privileges hand it to `anon` as well. Take both back and grant
-- explicitly, the same way every function in this schema does.
revoke execute on function public.mark_known(uuid) from public;
revoke execute on function public.mark_known(uuid) from anon;
grant execute on function public.mark_known(uuid) to authenticated;
grant execute on function public.mark_known(uuid) to service_role;
