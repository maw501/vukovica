-- stories: the graded reader's library, one row per generated story.
--
-- Spec: docs/specs/2026-08-30-phase2-progression-reader.md §3.1.
--
-- Rows are written by the `story` Edge Function with the service role (it holds
-- the model call, so it owns the insert -- one round trip, no client-side write
-- of unvalidated model output). The owner-only policies below still matter: the
-- client reads and updates its own rows directly (the library list, and setting
-- `finished_at` when the reader taps "Завршио сам").
--
-- `finished_at` null means unread; the progression layer counts the non-null
-- ones (see lib/stages.ts, Читање ladder).
--
-- Same conventions as every other table here: RLS on, explicit policies for all
-- four operations, and explicit grants -- Supabase no longer auto-grants to
-- `authenticated`, and without them PostgREST returns "permission denied"
-- before RLS is ever evaluated.

create table public.stories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title_cyr   text not null,
  body_cyr    text not null,
  level       int not null check (level between 1 and 3),
  word_count  int not null,
  created_at  timestamptz default now(),
  finished_at timestamptz
);

-- The library lists newest-first, and the progression layer counts finished
-- rows; both are per-user, so the user column leads the index.
create index stories_user_created_idx on public.stories (user_id, created_at desc);

alter table public.stories enable row level security;

create policy stories_select_own on public.stories
  for select to authenticated
  using (user_id = auth.uid());

create policy stories_insert_own on public.stories
  for insert to authenticated
  with check (user_id = auth.uid());

create policy stories_update_own on public.stories
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy stories_delete_own on public.stories
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.stories to authenticated;
grant all on public.stories to service_role;
