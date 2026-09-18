-- Quick add: two boxes, and the word is one he knows.
--
-- The full add-a-word form asks for eight things — the headword, the English,
-- the part of speech, the gender, whether a verb is ongoing or one-off, an
-- example sentence in both languages, and a domain. Mark's verdict on it was
-- that it is so much work he will never use it, and he is right: the usual
-- occasion is his wife saying a word at the kitchen table, and what he wants to
-- record is "I know this one now", not to fill in a dictionary entry standing
-- up.
--
-- So there is a second door into the deck that asks for the two things only he
-- can supply — the Serbian and what it means — and leaves the rest empty for
-- later. Empty, not absent: the columns stay `not null`, and the empty string is
-- what "not filled in yet" looks like. A backfill run between sessions writes
-- the part of speech, the examples and the audio in batches, and every screen
-- that prints those fields now hides the line when it is blank rather than
-- printing an empty one.
--
-- The defaults below are what make a two-column insert legal. They are on the
-- columns rather than in the function so that the *same* rule holds for any
-- other writer that ever adds a card without an example -- a seed script, a
-- backfill, psql at three in the morning.

alter table public.cards alter column pos set default '';
alter table public.cards alter column example_cyr set default '';
alter table public.cards alter column example_en set default '';

-- ---------------------------------------------------------------------------
-- quick_add_word: the card, and the claim that he knows it, in one call.
--
-- Two writes that must not come apart: a card with no `user_cards` row is a
-- word the app thinks he has never met, which is the opposite of what the
-- button says. Doing it from the client would be an insert, a round trip, and
-- an RPC, with a window in between in which a dropped connection leaves a
-- half-added word in the shared deck and nothing in My words.
--
-- The second half is `public.mark_known` itself rather than a copy of it. That
-- function owns the rule for what "known" means -- the state, the stability, the
-- ninety days, and the deliberate absence of any XP -- and `lib/library.ts` and
-- the dashboard both read it back. A replica here would be a second definition
-- of the same rule, free to drift.
--
-- SECURITY INVOKER (the default, stated because it is load-bearing, and the
-- house rule for every RPC in this schema): the function runs as the caller, so
-- `cards_insert_own` and `user_cards`'s owner-only policies still apply, and the
-- nested `mark_known` runs as the caller too. `created_by` and `user_id` come
-- from `auth.uid()`, never from an argument.
-- ---------------------------------------------------------------------------
create function public.quick_add_word(
  p_sr_cyr text,
  p_en text
)
-- The card, and whether this call is what put it there. The screen says one of
-- two different things afterwards -- "Added to My words" or "Already in the
-- deck, now in My words" -- and that is the whole point of the second column:
-- the client could only otherwise guess, by looking the id up in a copy of the
-- deck that may still be loading.
returns table (card_id uuid, created boolean)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_sr_cyr  text := btrim(coalesce(p_sr_cyr, ''));
  v_en      text := btrim(coalesce(p_en, ''));
  v_card_id uuid;
  v_created boolean := false;
begin
  -- RLS would refuse the write anyway; failing here says why.
  if v_user_id is null then
    raise exception 'quick_add_word requires an authenticated user'
      using errcode = '28000';
  end if;

  if v_sr_cyr = '' then
    raise exception 'quick_add_word: p_sr_cyr must be a word'
      using errcode = '22023';
  end if;

  if v_en = '' then
    raise exception 'quick_add_word: p_en must be what it means'
      using errcode = '22023';
  end if;

  -- The whole app assumes `sr_cyr` is Cyrillic: the review screen sets it in
  -- the serif, search derives the Latin form from it with `cyrToLat`, and the
  -- reader looks words up by it. The client converts a Latin headword before it
  -- sends it (`toCyrillicHeadword`), so a Latin one arriving here means that
  -- step was skipped, not that the user typed Latin.
  --
  -- Every letter, not merely one of them. `toCyrillicHeadword` leaves a string
  -- that already contains any Cyrillic *unconverted*, so one slipped keyboard
  -- switch halfway through a word gives "кasika" -- and `sr_cyr` is unique in a
  -- deck the app assumes is pure Cyrillic, with no way to correct it from this
  -- screen. `Ѐ-ӿ` is the Cyrillic block; the rest of the class is the space and
  -- the punctuation the seeded deck's own headwords already use.
  if v_sr_cyr !~ E'^[\\u0400-\\u04FF .,!?''-]+$'
     or v_sr_cyr !~ E'[\\u0400-\\u04FF]' then
    raise exception 'quick_add_word: “%” is not written in Cyrillic', v_sr_cyr
      using errcode = '22023';
  end if;

  -- The deck is shared and `sr_cyr` is unique, so the word may well be there
  -- already -- which is the point of this being one call. Half the value of the
  -- screen is Mark finding out that "trainers" has been in the deck as патике
  -- all along. An existing card is used **as it stands**: its English, its
  -- examples and its audio are somebody's work (the seed deck's, or a
  -- backfill's) and a two-box form is not the place to overwrite them.
  select cards.id into v_card_id
  from public.cards
  where cards.sr_cyr = v_sr_cyr and cards.kind = 'word';

  if v_card_id is null then
    insert into public.cards (sr_cyr, en, pos, example_cyr, example_en, domain, created_by)
    values (
      v_sr_cyr,
      v_en,
      -- Spelled out rather than left to the column defaults above, because
      -- these three empties are this function's own promise -- the screen shows
      -- no box for them -- and not a default anyone may later change.
      '',
      '',
      '',
      'my-words',
      -- Not decoration: the `cards_insert_own` policy checks it.
      v_user_id
    )
    -- Two tabs, or a double tap on a slow connection: the row can appear
    -- between the select above and this insert. `do nothing` turns that race
    -- into the same outcome as finding it first time round, rather than a
    -- unique-violation the user has to read.
    on conflict (sr_cyr) do nothing
    returning cards.id into v_card_id;

    v_created := v_card_id is not null;

    if v_card_id is null then
      select cards.id into v_card_id
      from public.cards
      where cards.sr_cyr = v_sr_cyr and cards.kind = 'word';
    end if;

    -- The headword is taken, but not by a word: `sr_cyr` is unique across both
    -- decks, and a letter card's is a pair ("Б б"). Unreachable for anything a
    -- user can type into a two-box form, and worth saying out loud rather than
    -- letting `mark_known` refuse a null card id.
    if v_card_id is null then
      raise exception 'quick_add_word: “%” is already in the deck, but not as a word', v_sr_cyr
        using errcode = '22023';
    end if;
  end if;

  perform public.mark_known(v_card_id);

  return query select v_card_id, v_created;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC, and Supabase's own
-- default privileges hand it to `anon` as well. Take both back and grant
-- explicitly, the same way every function in this schema does.
revoke execute on function public.quick_add_word(text, text) from public;
revoke execute on function public.quick_add_word(text, text) from anon;
grant execute on function public.quick_add_word(text, text) to authenticated;
grant execute on function public.quick_add_word(text, text) to service_role;
