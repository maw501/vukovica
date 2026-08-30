-- Phase 3 schema: the letters deck marker, books + their pages, the capture
-- queue, the grammar section, XP events, and the private `book-photos` bucket.
--
-- Spec: docs/specs/2026-08-30-phase3-revamp.md §§4, 6, 7, 9, 10.
--
-- Same conventions as every earlier migration here (see 20260829120000_schema.sql):
-- every table enables RLS, carries explicit policies, and states its grants
-- rather than relying on whatever the database hands out by default.
--
-- One correction to that file's note, found while verifying this one: this
-- database *does* still carry Supabase's `alter default privileges ... in
-- schema public grant all to anon, authenticated, service_role`, so a new table
-- in `public` arrives with every privilege already granted to both roles. The
-- `grant` lines below are therefore documentation, not enforcement -- RLS is
-- what actually holds, and it holds fine, because every policy here names
-- `authenticated` and keys on `auth.uid()`. Where a privilege genuinely has to
-- be *absent* rather than merely unused, this migration revokes it explicitly.
--
-- Two ownership shapes appear below. Most tables are owner-only: policies key on
-- `user_id = auth.uid()`. `grammar_topics` and `grammar_items` are the exception
-- -- global seeded content with no owner at all, readable by every authenticated
-- user and written only with the service role.

-- ---------------------------------------------------------------------------
-- cards.kind: which deck a card belongs to.
--
-- The letters deck rides on the same table, the same FSRS state and the same
-- `submit_review` RPC as words, but the two never mix in one session queue --
-- the review screen filters on this column and the dashboard counts each deck's
-- due cards separately (spec §4). Defaulting to 'word' is what makes the 681
-- existing seed rows land in the word deck without a data migration.
--
-- `cards.audio_path` already exists (20260829120000_schema.sql); phase 3 only
-- starts filling it, from the offline batch script, so there is nothing to add.
-- ---------------------------------------------------------------------------
alter table public.cards
  add column kind text not null default 'word'
    check (kind in ('word', 'letter'));

-- Partial, because the interesting query is only ever "the letters": they are a
-- ~30-row slice of a table that is otherwise entirely words, so an index over
-- the whole column would be one huge entry for the value nobody filters on.
create index cards_kind_idx on public.cards (kind) where kind = 'letter';

-- ---------------------------------------------------------------------------
-- books: one row per book Mark is reading with his son.
--
-- `source` records where the text came from: 'claude' for a Claude-authored
-- rendering seeded before the real pages exist, 'photos' for one built from
-- photographs of the physical book. `status` is 'pending' until the pages have
-- text -- a photographed book is saved immediately and transcribed offline, so
-- the list has to be able to show "waiting for transcription".
--
-- `finished_at` null means unread, matching `stories`; the Books rung of the
-- progression ladder counts the non-null rows.
-- ---------------------------------------------------------------------------
create table public.books (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title_en    text not null,
  title_cyr   text,
  status      text not null default 'pending'
              check (status in ('pending', 'ready')),
  source      text not null check (source in ('claude', 'photos')),
  finished_at timestamptz,
  created_at  timestamptz default now(),
  -- Redundant on its own -- `id` is already unique -- but it is the target
  -- `book_pages` needs for its composite foreign key. See that table.
  unique (id, user_id)
);

-- The library lists newest-first per user, exactly like `stories`.
create index books_user_created_idx on public.books (user_id, created_at desc);

alter table public.books enable row level security;

create policy books_select_own on public.books
  for select to authenticated
  using (user_id = auth.uid());

create policy books_insert_own on public.books
  for insert to authenticated
  with check (user_id = auth.uid());

create policy books_update_own on public.books
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy books_delete_own on public.books
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.books to authenticated;
grant all on public.books to service_role;

-- ---------------------------------------------------------------------------
-- book_pages: the pages of a book, in order.
--
-- `text_cyr` is null while the book is pending -- the photo lands first and the
-- transcription follows. `photo_path` is a `book-photos` storage path, null for
-- a Claude-authored book that never had a photograph.
--
-- `user_id` is denormalised from `books` deliberately: it lets the owner policy
-- be a plain column comparison rather than a subquery into `books`, which every
-- page read would otherwise pay for.
--
-- That denormalisation is only safe if the two can never disagree, and the RLS
-- policies alone do not make it so: they check `user_id = auth.uid()`, which a
-- client satisfies by writing its *own* id -- so holding somebody else's
-- `book_id` would be enough to staple pages onto their book. The composite
-- foreign key closes that: `(book_id, user_id)` has to name a real row of
-- `books`, so the page's owner is the book's owner by construction rather than
-- by convention. `books (id, user_id)` carries the unique constraint it needs
-- as a target.
-- ---------------------------------------------------------------------------
create table public.book_pages (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  page_no    int not null,
  text_cyr   text,
  photo_path text,
  created_at timestamptz default now(),
  foreign key (book_id, user_id)
    references public.books (id, user_id) on delete cascade,
  unique (book_id, page_no)
);

alter table public.book_pages enable row level security;

create policy book_pages_select_own on public.book_pages
  for select to authenticated
  using (user_id = auth.uid());

create policy book_pages_insert_own on public.book_pages
  for insert to authenticated
  with check (user_id = auth.uid());

create policy book_pages_update_own on public.book_pages
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy book_pages_delete_own on public.book_pages
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.book_pages to authenticated;
grant all on public.book_pages to service_role;

-- ---------------------------------------------------------------------------
-- requests: the capture queue -- "how do I say this?", answered offline.
--
-- Two ways in (`source`): typed into the quick-add box, or filed from a reading
-- view when a tapped word is not in the deck. Fulfilment is a Claude job between
-- sessions: it inserts the card, points `card_id` at it, writes `note`, and
-- flips `status` to 'done'.
--
-- `card_id` is `on delete set null` rather than cascade: deleting a card should
-- not erase the record that the request was answered.
-- ---------------------------------------------------------------------------
create table public.requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  text_en    text not null,
  source     text not null default 'typed'
             check (source in ('typed', 'reader')),
  status     text not null default 'pending'
             check (status in ('pending', 'done')),
  card_id    uuid references public.cards (id) on delete set null,
  note       text,
  created_at timestamptz default now(),
  done_at    timestamptz
);

-- The queue screen lists newest-first per user.
create index requests_user_created_idx on public.requests (user_id, created_at desc);

alter table public.requests enable row level security;

create policy requests_select_own on public.requests
  for select to authenticated
  using (user_id = auth.uid());

create policy requests_insert_own on public.requests
  for insert to authenticated
  with check (user_id = auth.uid());

create policy requests_update_own on public.requests
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy requests_delete_own on public.requests
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.requests to authenticated;
grant all on public.requests to service_role;

-- ---------------------------------------------------------------------------
-- grammar_topics: global seeded content -- one row per beginner topic.
--
-- No `user_id`: these rows belong to the app, not to a user. RLS is still on,
-- with a read-only policy, and `authenticated` holds SELECT alone -- so a
-- client cannot write content even if a future policy were added by mistake.
-- Seeding happens with the service role.
--
-- The REVOKE is doing the real work here, not the GRANT (see the note at the top
-- of this file): the default privileges hand out everything at create time, so
-- granting SELECT on top would withhold nothing. On the owner-only tables the
-- surplus privileges are inert because no policy admits the row -- but a table
-- every authenticated user can already read is exactly the case where write has
-- to be taken away to be absent.
-- ---------------------------------------------------------------------------
create table public.grammar_topics (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  title_en   text not null,
  explain_md text not null,
  sort       int not null
);

alter table public.grammar_topics enable row level security;

create policy grammar_topics_select_authenticated on public.grammar_topics
  for select to authenticated
  using (true);

revoke all on public.grammar_topics from authenticated, anon;
grant select on public.grammar_topics to authenticated;
grant all on public.grammar_topics to service_role;

-- ---------------------------------------------------------------------------
-- grammar_items: the drill items of a topic. Global content, same shape.
--
-- `answer_cyr` is the canonical answer; the drill accepts a Latin-typed answer
-- by transliterating the input before comparing (lib/transliterate.ts), so no
-- second accepted-forms column is stored.
-- ---------------------------------------------------------------------------
create table public.grammar_items (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references public.grammar_topics (id) on delete cascade,
  prompt     text not null,
  answer_cyr text not null,
  note       text,
  sort       int not null
);

-- A drill run reads one topic's items in order.
create index grammar_items_topic_sort_idx on public.grammar_items (topic_id, sort);

alter table public.grammar_items enable row level security;

create policy grammar_items_select_authenticated on public.grammar_items
  for select to authenticated
  using (true);

-- Same as `grammar_topics`: the REVOKE, not the GRANT, is what withholds write.
revoke all on public.grammar_items from authenticated, anon;
grant select on public.grammar_items to authenticated;
grant all on public.grammar_items to service_role;

-- ---------------------------------------------------------------------------
-- grammar_stats: per-topic accuracy, one row per user per topic.
--
-- The same shape as `drill_stats`, and bumped the same way -- see
-- `bump_grammar_stats` at the bottom of this file.
-- ---------------------------------------------------------------------------
create table public.grammar_stats (
  user_id    uuid not null references auth.users (id) on delete cascade,
  topic_id   uuid not null references public.grammar_topics (id) on delete cascade,
  attempts   int not null default 0,
  correct    int not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, topic_id)
);

alter table public.grammar_stats enable row level security;

create policy grammar_stats_select_own on public.grammar_stats
  for select to authenticated
  using (user_id = auth.uid());

create policy grammar_stats_insert_own on public.grammar_stats
  for insert to authenticated
  with check (user_id = auth.uid());

create policy grammar_stats_update_own on public.grammar_stats
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy grammar_stats_delete_own on public.grammar_stats
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.grammar_stats to authenticated;
grant all on public.grammar_stats to service_role;

-- ---------------------------------------------------------------------------
-- xp_events: append-only XP ledger. Total, level and today's ring are all sums
-- over this table rather than counters, so nothing can drift out of step.
--
-- INSERT and SELECT only, in both the policies and the grant: an awarded event
-- is a fact about something that already happened, and editing or deleting one
-- would silently rewrite the streak and the level.
-- ---------------------------------------------------------------------------
create table public.xp_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  amount     int not null,
  kind       text not null
             check (kind in ('review', 'drill', 'grammar', 'story',
                             'book_page', 'book_finish', 'request')),
  created_at timestamptz default now()
);

-- Today's ring is a sum over one user's recent rows; the total scans the same
-- index.
create index xp_events_user_created_idx on public.xp_events (user_id, created_at desc);

alter table public.xp_events enable row level security;

create policy xp_events_select_own on public.xp_events
  for select to authenticated
  using (user_id = auth.uid());

create policy xp_events_insert_own on public.xp_events
  for insert to authenticated
  with check (user_id = auth.uid());

-- As with the grammar content tables, the REVOKE is what makes UPDATE and
-- DELETE actually absent; the GRANT below would otherwise be decorative. Here
-- it matters twice over: without the missing privilege the write would still be
-- blocked by RLS, but silently -- PostgREST answers a policy-filtered DELETE
-- with 204 and no rows changed, so a mistaken caller would look successful.
revoke all on public.xp_events from authenticated, anon;
grant select, insert on public.xp_events to authenticated;
grant all on public.xp_events to service_role;

-- ---------------------------------------------------------------------------
-- bump_grammar_stats: incrementing a topic's counters after a drill run.
--
-- The same problem `bump_drill_stats` solves, for the same reason: PostgREST's
-- upsert (`Prefer: resolution=merge-duplicates`) writes `excluded.attempts`,
-- i.e. it *replaces* the count, so the only client-side alternative is
-- read-modify-write -- which loses an increment whenever two tabs (or a retry)
-- overlap. `on conflict do update set attempts = gs.attempts + excluded.attempts`
-- inside the database has no such window.
--
-- One call carries a whole run rather than a row per item.
--
-- SECURITY INVOKER (the default, stated because it is load-bearing): the
-- function runs as the caller, so `grammar_stats`'s owner-only RLS policies
-- still apply. `user_id` comes from `auth.uid()`, never from an argument, so a
-- client cannot write somebody else's counters even by asking.
-- ---------------------------------------------------------------------------
create function public.bump_grammar_stats(
  p_topic_id uuid,
  p_attempts int,
  p_correct  int
)
returns public.grammar_stats
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row     public.grammar_stats;
begin
  -- RLS would refuse the write anyway; failing here says why.
  if v_user_id is null then
    raise exception 'bump_grammar_stats requires an authenticated user'
      using errcode = '28000';
  end if;

  -- Nonsense counts would poison the per-topic accuracy the grammar screen
  -- shows, and nothing downstream could tell them from real ones.
  if p_attempts is null or p_correct is null
     or p_attempts < 0 or p_correct < 0 or p_correct > p_attempts then
    raise exception 'bump_grammar_stats: need 0 <= correct <= attempts'
      using errcode = '22023';
  end if;

  insert into public.grammar_stats as gs (user_id, topic_id, attempts, correct, updated_at)
  values (v_user_id, p_topic_id, p_attempts, p_correct, now())
  on conflict (user_id, topic_id) do update set
    attempts   = gs.attempts + excluded.attempts,
    correct    = gs.correct + excluded.correct,
    updated_at = now()
  returning gs.* into v_row;

  return v_row;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC, and Supabase's own
-- default privileges hand it to `anon` as well. Take both back and grant
-- explicitly, the same way every table in this schema does.
revoke execute on function public.bump_grammar_stats(uuid, int, int) from public;
revoke execute on function public.bump_grammar_stats(uuid, int, int) from anon;
grant execute on function public.bump_grammar_stats(uuid, int, int) to authenticated;
grant execute on function public.bump_grammar_stats(uuid, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Storage: the private `book-photos` bucket.
--
-- Unlike `audio` -- public-read, written only by Edge Functions with the
-- service role, hence no policies at all -- these are photographs of a private
-- book, uploaded by the client from the phone. So the bucket is private and
-- carries owner-scoped policies over `storage.objects`.
--
-- Ownership is the first path segment: every object lives at
-- `<user_id>/<book_id>/<page_no>.jpg`, and `storage.foldername(name)` is
-- 1-indexed, so `[1]` is that user id. `storage.objects` is already granted to
-- `authenticated` by Supabase's own storage schema, so only policies are needed
-- here -- and they are scoped to this bucket alone, leaving `audio` untouched.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('book-photos', 'book-photos', false)
on conflict do nothing;

create policy book_photos_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'book-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy book_photos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'book-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy book_photos_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'book-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'book-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy book_photos_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'book-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
