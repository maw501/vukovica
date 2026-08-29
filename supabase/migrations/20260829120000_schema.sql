-- Vukovica MVP schema: cards, FSRS user state, review logs, chat, drills,
-- settings, AI usage + the public `audio` storage bucket.
--
-- Conventions enforced throughout (see docs/specs/2026-08-29-vukovica-design.md §3.1):
--   * every table enables RLS and carries explicit policies;
--   * every table gets explicit grants -- Supabase no longer auto-grants to
--     `authenticated`, and without them PostgREST returns "permission denied"
--     before RLS is ever evaluated.

-- ---------------------------------------------------------------------------
-- cards: the shared deck. Readable by any authenticated user; seed rows have
-- created_by = null. This is a single-user private instance, so UPDATE/DELETE
-- are left open to authenticated rather than modelled per-owner.
-- ---------------------------------------------------------------------------
create table public.cards (
  id          uuid primary key default gen_random_uuid(),
  sr_cyr      text not null unique,
  en          text not null,
  pos         text not null,
  gender      text,
  aspect      text,
  example_cyr text not null,
  example_en  text not null,
  domain      text not null,
  audio_path  text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz default now()
);

alter table public.cards enable row level security;

create policy cards_select_authenticated on public.cards
  for select to authenticated
  using (true);

create policy cards_insert_own on public.cards
  for insert to authenticated
  with check (created_by = auth.uid());

create policy cards_update_authenticated on public.cards
  for update to authenticated
  using (true)
  with check (true);

create policy cards_delete_authenticated on public.cards
  for delete to authenticated
  using (true);

grant select, insert, update, delete on public.cards to authenticated;
grant all on public.cards to service_role;

-- ---------------------------------------------------------------------------
-- user_cards: per-user FSRS scheduling state, one row per card in the queue.
-- ---------------------------------------------------------------------------
create table public.user_cards (
  user_id     uuid not null references auth.users (id) on delete cascade,
  card_id     uuid not null references public.cards (id) on delete cascade,
  due         timestamptz not null default now(),
  stability   float8 not null default 0,
  difficulty  float8 not null default 0,
  reps        int not null default 0,
  lapses      int not null default 0,
  state       text not null default 'new'
              check (state in ('new', 'learning', 'review', 'relearning')),
  last_review timestamptz,
  primary key (user_id, card_id)
);

create index user_cards_due_idx on public.user_cards (user_id, due);

alter table public.user_cards enable row level security;

create policy user_cards_select_own on public.user_cards
  for select to authenticated
  using (user_id = auth.uid());

create policy user_cards_insert_own on public.user_cards
  for insert to authenticated
  with check (user_id = auth.uid());

create policy user_cards_update_own on public.user_cards
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_cards_delete_own on public.user_cards
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.user_cards to authenticated;
grant all on public.user_cards to service_role;

-- ---------------------------------------------------------------------------
-- review_logs: append-only grade history. Powers streaks and stats.
-- ---------------------------------------------------------------------------
create table public.review_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid references auth.users (id) on delete cascade,
  card_id      uuid references public.cards (id) on delete cascade,
  grade        int check (grade between 1 and 4),
  state_before text,
  state_after  text,
  elapsed_days float8,
  reviewed_at  timestamptz default now()
);

create index review_logs_user_reviewed_idx on public.review_logs (user_id, reviewed_at);

alter table public.review_logs enable row level security;

create policy review_logs_select_own on public.review_logs
  for select to authenticated
  using (user_id = auth.uid());

create policy review_logs_insert_own on public.review_logs
  for insert to authenticated
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.review_logs to authenticated;
grant all on public.review_logs to service_role;

-- ---------------------------------------------------------------------------
-- chat_messages: tutor conversation history; client loads the last N for context.
-- ---------------------------------------------------------------------------
create table public.chat_messages (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users (id) on delete cascade,
  role       text check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz default now()
);

create index chat_messages_user_created_idx on public.chat_messages (user_id, created_at);

alter table public.chat_messages enable row level security;

create policy chat_messages_select_own on public.chat_messages
  for select to authenticated
  using (user_id = auth.uid());

create policy chat_messages_insert_own on public.chat_messages
  for insert to authenticated
  with check (user_id = auth.uid());

create policy chat_messages_update_own on public.chat_messages
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy chat_messages_delete_own on public.chat_messages
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.chat_messages to authenticated;
grant all on public.chat_messages to service_role;

-- ---------------------------------------------------------------------------
-- drill_stats: per-letter accuracy for the Cyrillic trainer.
-- ---------------------------------------------------------------------------
create table public.drill_stats (
  user_id  uuid not null references auth.users (id) on delete cascade,
  letter   text not null,
  attempts int default 0,
  correct  int default 0,
  primary key (user_id, letter)
);

alter table public.drill_stats enable row level security;

create policy drill_stats_select_own on public.drill_stats
  for select to authenticated
  using (user_id = auth.uid());

create policy drill_stats_insert_own on public.drill_stats
  for insert to authenticated
  with check (user_id = auth.uid());

create policy drill_stats_update_own on public.drill_stats
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy drill_stats_delete_own on public.drill_stats
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.drill_stats to authenticated;
grant all on public.drill_stats to service_role;

-- ---------------------------------------------------------------------------
-- settings: one row per user.
-- ---------------------------------------------------------------------------
create table public.settings (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  show_latin  bool default true,
  new_per_day int default 10,
  tts_enabled bool default true
);

alter table public.settings enable row level security;

create policy settings_select_own on public.settings
  for select to authenticated
  using (user_id = auth.uid());

create policy settings_insert_own on public.settings
  for insert to authenticated
  with check (user_id = auth.uid());

create policy settings_update_own on public.settings
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy settings_delete_own on public.settings
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.settings to authenticated;
grant all on public.settings to service_role;

-- ---------------------------------------------------------------------------
-- ai_usage: observability only. Written by Edge Functions via the service role;
-- authenticated users may read their own rows but never insert (no INSERT
-- policy for `authenticated` -- deliberate).
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users (id) on delete cascade,
  surface       text,
  model         text,
  input_tokens  int,
  output_tokens int,
  cost_cents    float8,
  created_at    timestamptz default now()
);

alter table public.ai_usage enable row level security;

create policy ai_usage_select_own on public.ai_usage
  for select to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.ai_usage to authenticated;
grant all on public.ai_usage to service_role;

-- ---------------------------------------------------------------------------
-- Storage: public-read `audio` bucket for cached TTS mp3s. Uploads happen
-- through Edge Functions using the service role, so no extra storage policies
-- are needed for the MVP.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('audio', 'audio', true)
on conflict do nothing;
