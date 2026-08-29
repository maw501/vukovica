# Vukovica MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working PWA Serbian learning app: FSRS flashcards over a ~600-card seed deck, AI tutor chat, Cyrillic trainer, TTS audio — single user (Mark).

**Architecture:** Expo (SDK 54, expo-router) app talking directly to Supabase (Postgres + Auth + Storage) via supabase-js under RLS. Supabase Edge Functions ONLY for secret-holding calls: `tutor` (streaming chat), `generate` (structured card/example generation), `tts` (audio with Storage caching). AI via Vercel AI SDK with env-switchable provider (anthropic default: chat=`claude-sonnet-5`, fast=`claude-haiku-4-5`; openai fallback works with Mark's existing key).

**Tech Stack:** Expo SDK 54 + expo-router, TypeScript, @supabase/supabase-js, ts-fsrs, zustand, @tanstack/react-query, Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) in Deno Edge Functions, vitest.

**Spec:** `docs/specs/2026-08-29-vukovica-design.md` — READ IT FIRST. Also read `~/development/haven/CLAUDE.md` §"Important Rules" for Supabase gotchas (grants, `--no-verify-jwt`, import maps, `getUser(token)`).

## Global Constraints

- Node >= 20. Expo SDK 54 managed workflow, expo-router file-based routing. PWA-first (web export); no EAS/native in MVP.
- Latin script is ALWAYS derived via `lib/transliterate.ts`, never stored in DB or JSON.
- Ekavian standard Serbian everywhere (seed data, prompts, examples).
- Every new `public` table migration MUST include `GRANT SELECT, INSERT, UPDATE, DELETE ON public.<t> TO authenticated;` and `GRANT ALL ON public.<t> TO service_role;` plus RLS enabled with owner policies (`cards` is the exception: all-authenticated read).
- All prompts live in `supabase/functions/_shared/prompts.ts` only.
- Edge Functions authenticate via `supabase.auth.getUser(token)` with the raw bearer token; deployed with `--no-verify-jwt`.
- Tests: vitest, colocated under `lib/__tests__/` and `supabase/functions/_shared/__tests__/`. `npm test` must pass at the end of every task.
- Commit at the end of every task (conventional commits). Never `supabase db reset` against anything but local.

---

### Task 1: Repo scaffold

**Files:**
- Create: Expo app at repo root (`app/`, `app.json`, `package.json`, `tsconfig.json`, `babel.config.js` or SDK-54 default), `vitest.config.ts`, `.gitignore`, `.env.example`, `README.md`, `supabase/config.toml` (via `supabase init`)
- Create: `app/_layout.tsx` (root stack with placeholder), `app/index.tsx` (placeholder "Vukovica" screen)

**Interfaces:**
- Produces: a bootable Expo project. npm scripts: `dev` (expo start), `web` (expo start --web), `test` (vitest run), `typecheck` (tsc --noEmit), `db:start`, `db:migrate` (`supabase db push --local`), `db:seed` (`node --env-file=.env.local scripts/seed.mjs` — script itself lands in Task 4), `functions` (`supabase functions serve --no-verify-jwt --env-file supabase/.env.local`), `build:web` (`expo export --platform web --output-dir dist`).

**Steps:**
- [ ] `npx create-expo-app@latest . --template default` (SDK 54), strip example screens to the two placeholder routes.
- [ ] Add deps: `@supabase/supabase-js`, `ts-fsrs`, `zustand`, `@tanstack/react-query`, `expo-secure-store`; dev: `vitest`, `typescript`.
- [ ] `npx supabase init` (creates `supabase/config.toml`).
- [ ] `vitest.config.ts` targeting `**/__tests__/**/*.test.ts`, environment `node`. Add a trivial smoke test so `npm test` passes non-empty.
- [ ] `.env.example` documenting `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `supabase/.env.local` keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` optional, `AI_PROVIDER=openai|anthropic`, `AI_CHAT_MODEL`/`AI_FAST_MODEL` optional overrides, `TTS_VOICE` optional).
- [ ] Verify: `npm test` passes, `npx tsc --noEmit` passes, `npx expo export --platform web` succeeds.
- [ ] Commit `feat: scaffold expo + supabase project`.

---

### Task 2: Transliteration module

**Files:**
- Create: `lib/transliterate.ts`, `lib/__tests__/transliterate.test.ts`

**Interfaces:**
- Produces: `cyrToLat(input: string): string`, `latToCyr(input: string): string`. Pure, zero deps. Later tasks import as `@/lib/transliterate` (configure `@/*` path alias in tsconfig if not present).

**Mapping (complete):** а=a б=b в=v г=g д=d ђ=đ е=e ж=ž з=z и=i ј=j к=k л=l љ=lj м=m н=n њ=nj о=o п=p р=r с=s т=t ћ=ć у=u ф=f х=h ц=c ч=č џ=dž ш=š. Non-Serbian chars pass through unchanged.

**Casing rules:** Ђ→Đ, Ж→Ž etc. Digraph capitals follow the next char: Љуба→Ljuba (title-case → `Lj`), ЉУБА→LJUBA (char after is uppercase or word is all-caps → `LJ`). latToCyr parses digraphs greedily (`lj`→љ, `nj`→њ, `dž`→џ, and uppercase/mixed variants `Lj/LJ/Nj/NJ/Dž/DŽ`) before single letters.

**Steps (TDD):**
- [ ] Write failing tests first. Required cases: round-trip `cyrToLat(latToCyr(x)) === x` for a word list incl. `ђак, ћирилица, џеп, љубав, њива, шљива, Београд, Живела Србија`; casing `Њ`→`Nj` in `Његош`, `ЊЕГОШ`→`NJEGOŠ`; passthrough `hello, 123!`; `latToCyr('džez') === 'џез'`, `latToCyr('Ljubav') === 'Љубав'`, `latToCyr('NJIVA') === 'ЊИВА'`.
- [ ] Run tests → fail. Implement. Run tests → pass. `npm run typecheck`.
- [ ] Commit `feat: serbian cyrillic<->latin transliteration`.

---

### Task 3: Database schema migration

**Files:**
- Create: `supabase/migrations/00001_schema.sql`
- Create: `lib/types.ts` (hand-written row types matching the schema — no codegen dependency in MVP)

**Interfaces:**
- Produces tables per spec §3.1: `cards`, `user_cards`, `review_logs`, `chat_messages`, `drill_stats`, `settings`, `ai_usage`; Storage bucket `audio` (public read). TS types: `CardRow`, `UserCardRow`, `ReviewLogInsert`, `ChatMessageRow`, `DrillStatRow`, `SettingsRow`.

**Schema (verbatim requirements):**
- `cards`: `id uuid pk default gen_random_uuid()`, `sr_cyr text not null unique`, `en text not null`, `pos text not null`, `gender text`, `aspect text`, `example_cyr text not null`, `example_en text not null`, `domain text not null`, `audio_path text`, `created_by uuid references auth.users`, `created_at timestamptz default now()`. RLS: SELECT for all `authenticated`; INSERT for `authenticated` with `created_by = auth.uid()`; UPDATE/DELETE where `created_by = auth.uid()` OR user owns a `user_cards` row for it (single-user app; keep policy simple: allow authenticated UPDATE/DELETE — it's Mark's private instance).
- `user_cards`: `user_id uuid references auth.users`, `card_id uuid references cards on delete cascade`, PK `(user_id, card_id)`, `due timestamptz not null default now()`, `stability float8 not null default 0`, `difficulty float8 not null default 0`, `reps int not null default 0`, `lapses int not null default 0`, `state text not null default 'new' check (state in ('new','learning','review','relearning'))`, `last_review timestamptz`. Owner-only RLS (`user_id = auth.uid()`) for all ops.
- `review_logs`: `id bigint generated always as identity pk`, `user_id`, `card_id`, `grade int check (grade between 1 and 4)`, `state_before text`, `state_after text`, `elapsed_days float8`, `reviewed_at timestamptz default now()`. Owner-only INSERT/SELECT.
- `chat_messages`: `id bigint identity pk`, `user_id`, `role text check (role in ('user','assistant'))`, `content text not null`, `created_at timestamptz default now()`. Owner-only.
- `drill_stats`: `user_id`, `letter text`, PK `(user_id, letter)`, `attempts int default 0`, `correct int default 0`. Owner-only.
- `settings`: `user_id uuid pk`, `show_latin bool default true`, `new_per_day int default 10`, `tts_enabled bool default true`. Owner-only.
- `ai_usage`: `id bigint identity pk`, `user_id`, `surface text`, `model text`, `input_tokens int`, `output_tokens int`, `cost_cents float8`, `created_at timestamptz default now()`. Owner SELECT; INSERT via service_role only (no authenticated INSERT policy).
- Grants block for EVERY table (Global Constraints). `insert into storage.buckets (id, name, public) values ('audio','audio',true) on conflict do nothing;`

**Steps:**
- [ ] Write migration; `npm run db:start` then `npx supabase db push --local` (or `supabase db reset --local` acceptable here ONLY on the fresh local stack) → applies clean.
- [ ] Smoke-verify RLS: `psql` (or supabase SQL) as anon → `select` on `user_cards` returns permission behavior consistent with policies (spot check, not exhaustive).
- [ ] Write `lib/types.ts` matching columns exactly.
- [ ] Commit `feat: database schema, RLS, grants, audio bucket`.

---

### Task 4: Seed deck (~600 cards) + validation + seeder

**Files:**
- Create: `data/seed-deck.json`, `lib/__tests__/seed-deck.test.ts`, `scripts/seed.mjs`

**Interfaces:**
- Consumes: `cyrToLat`/`latToCyr` from Task 2 (round-trip validation), schema from Task 3.
- Produces: JSON array of card objects `{ sr_cyr, en, pos, gender, aspect, example_cyr, example_en, domain }` (gender only for nouns m/f/n; aspect only for verbs pf/impf; others null). `scripts/seed.mjs` upserts into `cards` using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`, on-conflict `sr_cyr` do nothing.

**Content requirements (the content IS the deliverable — write it with care, Ekavian, correct genders/aspects):**
- ~600 entries. Domains and rough counts: `family` 60 (мама, тата, беба, свекрва, зет...), `baby` 50 (пелена, цуцла, колица, дојење...), `home` 60, `food` 80, `greetings-courtesy` 40, `verbs-core` 80 (aspect pairs where natural), `adjectives-core` 50, `numbers-time` 50, `everyday-objects` 50, `phrases` 80 (multi-word conversational units — transliteration round-trip must still hold).
- Example sentences: short (≤ 10 words), family-life register, natural Ekavian.
- Validation test asserts: valid schema for every entry; `sr_cyr` unique; every `sr_cyr` and `example_cyr` contains ONLY Serbian Cyrillic letters, spaces and basic punctuation; round-trip `latToCyr(cyrToLat(sr_cyr)) === sr_cyr`; per-domain minimum counts; nouns have gender ∈ {m,f,n}; verbs have aspect ∈ {pf,impf}; total ≥ 550.
- [ ] Write validation test → write/generate the JSON in batches → test passes.
- [ ] Run `npm run db:seed` against local stack; verify `select count(*) from cards` ≥ 550.
- [ ] Commit `feat: seed deck (~600 cards) + seeder`.

---

### Task 5: FSRS wrapper + review queue

**Files:**
- Create: `lib/fsrs.ts`, `lib/queue.ts`, `lib/__tests__/fsrs.test.ts`, `lib/__tests__/queue.test.ts`

**Interfaces:**
- Consumes: `UserCardRow`, `CardRow`, `ReviewLogInsert` from `lib/types.ts`.
- Produces:
  - `gradeCard(row: UserCardRow, grade: 1|2|3|4, now?: Date): { next: UserCardRow; log: ReviewLogInsert }` — wraps `ts-fsrs` (`fsrs()`, `Rating.Again|Hard|Good|Easy`, map our `state` strings ⇄ `State` enum; `elapsed_days` computed from `last_review`).
  - `buildQueue(args: { dueCards: UserCardRow[]; newCards: CardRow[]; newPerDay: number; newDoneToday: number }): { cardId: string; isNew: boolean }[]` — due first ordered by `due` asc, then `max(0, newPerDay - newDoneToday)` new cards.

**Steps (TDD):**
- [ ] Failing tests: grading a `new` card with Good → state leaves `new`, `due` in the future, `reps` 1; Again on a `review` card → `lapses` +1, state `relearning`; `log.state_before/state_after/grade` correct; queue ordering + new-card cap (incl. cap already exhausted → 0 new).
- [ ] Implement; tests pass; typecheck; commit `feat: fsrs scheduling + review queue`.

---

### Task 6: Edge Functions (provider, prompts, tutor, generate, tts)

**Files:**
- Create: `supabase/functions/_shared/provider.ts`, `_shared/prompts.ts`, `_shared/auth.ts`, `_shared/usage.ts`, `supabase/functions/tutor/index.ts`, `supabase/functions/generate/index.ts`, `supabase/functions/tts/index.ts`, per-function `deno.json` import maps + `supabase/config.toml` `[functions.<name>]` entries (`verify_jwt = false`, `import_map`)
- Create: `supabase/functions/_shared/__tests__/prompts.test.ts` (runs under vitest — prompts.ts must be Deno/Node-neutral, zero deps)

**Interfaces:**
- Consumes: schema (Task 3).
- Produces HTTP contracts consumed by Task 7's UI:
  - `POST /functions/v1/tutor` body `{ messages: {role:'user'|'assistant', content:string}[], learnerState?: string }` → plain text stream (`streamText(...).toTextStreamResponse()`). CORS headers on all functions (`Access-Control-Allow-Origin: *`, handle OPTIONS).
  - `POST /functions/v1/generate` body `{ mode: 'example', sr_cyr: string } | { mode: 'new_card', input: string }` → JSON: example mode `{ example_cyr, example_en }`; new_card mode the full card object (Task 4 JSON shape). Uses `generateObject` with zod schema, model `vuk('fast')`.
  - `POST /functions/v1/tts` body `{ text: string }` → `{ url: string | null }`. sha256(text).mp3 in bucket `audio`; on miss call OpenAI TTS REST (`POST https://api.openai.com/v1/audio/speech`, model from `TTS_MODEL` env default `gpt-4o-mini-tts`, voice `TTS_VOICE` default `alloy`, `response_format: 'mp3'`); upload; return public URL. No `OPENAI_API_KEY` → `{ url: null }` (client hides audio).
- `provider.ts`: `vuk(alias: 'chat'|'fast')` — `AI_PROVIDER=anthropic` (default) → `claude-sonnet-5`/`claude-haiku-4-5` via `@ai-sdk/anthropic`; `openai` → models from `AI_CHAT_MODEL`/`AI_FAST_MODEL` env (defaults `gpt-4o`/`gpt-4o-mini`) via `@ai-sdk/openai`. npm imports via deno import map (`npm:ai`, `npm:@ai-sdk/anthropic`, `npm:@ai-sdk/openai`, `npm:zod`).
- `auth.ts`: `getAuthenticatedUser(req): Promise<User>` — extract bearer token, `createClient(url, anonKey).auth.getUser(token)`, throw 401 on failure (haven pattern: pass raw JWT explicitly).
- `usage.ts`: `logUsage(supabaseServiceClient, { userId, surface, model, usage })` fire-and-forget insert into `ai_usage` (cost left 0 for openai; anthropic priced sonnet-5 $2/$10 per MTok, haiku-4-5 $1/$5).

**Prompt invariants (encode in `prompts.ts`, each asserted by a test):** `TUTOR_SYSTEM` must (1) instruct Serbian-first replies in Cyrillic with Latin + English help lines for a beginner, (2) mandate Ekavian and literally contain the word "Ekavian", (3) cap corrections at one short grammar note per reply, (4) cap reply length (2–4 Serbian sentences), (5) prefer family/home topics, (6) ban boilerplate — the string must instruct against "Great question" openers and emoji, (7) define the add-word convention: when suggesting vocab worth saving, end the message with lines `DODAJ: <cyrillic> = <english>`. `buildTutorSystem(learnerState?: string)` appends the volatile learner-state block AFTER the stable persona (cache-friendly ordering).

**Steps:**
- [ ] Prompt constraint tests first (string assertions on invariants) → write `prompts.ts` → pass.
- [ ] Implement functions; `npm run functions` locally; smoke test each with `curl` (tutor streams text; generate returns valid JSON for both modes; tts returns url or null) using a real signed-in user token (`supabase.auth.signInWithPassword` via a tiny script or the Studio).
- [ ] Commit `feat: tutor/generate/tts edge functions + prompts`.

---

### Task 7: App core — supabase client, auth, dashboard, settings

**Files:**
- Create: `lib/supabase.ts`, `lib/stores/auth.ts`, `lib/api.ts` (typed query/mutation helpers over supabase-js: fetch settings/ensure row, due counts, streak from `review_logs`, upsert settings), `app/_layout.tsx` (QueryClientProvider + auth gate), `app/(auth)/sign-in.tsx`, `app/(app)/_layout.tsx` (tab or stack nav), `app/(app)/index.tsx` (dashboard), `app/(app)/settings.tsx`

**Interfaces:**
- Consumes: schema types (Task 3).
- Produces: `supabase` singleton (SecureStore adapter on native, default storage on web — platform-gated); `useAuth()` zustand store with `session`, `signIn(email, pw)`, `signOut()`, initialized from `supabase.auth.onAuthStateChange`; `api.getSettings(): Promise<SettingsRow>` (inserts defaults row if missing), `api.getDashboard(): Promise<{ dueCount: number; newAvailable: number; newDoneToday: number; streakDays: number }>` (streak = consecutive calendar days with ≥1 review_log ending today/yesterday).
- Dashboard shows due count, streak, buttons → Review / Chat / Trainer / Deck. Settings screen: show_latin toggle, new_per_day stepper, tts toggle, sign out.
- Sign-up: allowed only when `EXPO_PUBLIC_ALLOW_SIGNUP=true`; otherwise sign-in only.

**Steps:**
- [ ] Implement; manual verify on web (`npm run web`) against local stack: sign up (flag on), land on dashboard, counts render (0 due until Task 8 wiring is fine — `user_cards` may be empty; dashboard's `newAvailable` = cards without a `user_cards` row).
- [ ] Unit-test the streak computation (pure function in `lib/api.ts`, exported for test) in `lib/__tests__/streak.test.ts`: cases — empty logs → 0; today only → 1; yesterday+today → 2; gap → resets.
- [ ] `npm test` + typecheck green. Commit `feat: auth, dashboard, settings`.

---

### Task 8: Review + Deck screens

**Files:**
- Create: `app/(app)/review.tsx`, `app/(app)/deck.tsx`, `lib/audio.ts`, extend `lib/api.ts` (`getQueue`, `submitReview`, `listCards(search)`, `addCard`, `updateCard`, `deleteCard`, `ensureUserCard`)

**Interfaces:**
- Consumes: `buildQueue`/`gradeCard` (Task 5), `cyrToLat` (Task 2), `tts` + `generate` endpoints (Task 6), settings (Task 7).
- Produces: Review session — fetch queue (`api.getQueue()`: due `user_cards` join `cards`, plus new cards up to allowance; lazily `insert user_cards` rows for new cards on first grade), card UI (Cyrillic large; tap to reveal Latin — respecting `show_latin` — English, metadata, example; audio button via `lib/audio.ts` `playText(text)` which POSTs `/tts` once and caches url in memory; grade buttons Again/Hard/Good/Easy → `api.submitReview(gradeCard(...))` writes `user_cards` + `review_logs` optimistically). Session-end screen with counts.
- Deck screen: searchable list (Cyrillic + derived Latin + English), add-word flow (input either script → POST `/generate` mode `new_card` → preview → save to `cards` + `ensureUserCard`), edit/delete card (wife-QA path).

**Steps:**
- [ ] Implement; manual verify full review loop on web with seeded deck: new cards appear (≤ new_per_day), grading persists (`user_cards.due` advances; re-entering review shows correct queue), streak increments on dashboard.
- [ ] Verify add-word flow creates a card that round-trips transliteration.
- [ ] Commit `feat: review session + deck management`.

---

### Task 9: Cyrillic trainer

**Files:**
- Create: `app/(app)/trainer.tsx`, `lib/drills.ts`, `lib/__tests__/drills.test.ts`

**Interfaces:**
- Consumes: seed cards (`api.listCards`), `cyrToLat`/`latToCyr`, `drill_stats` table.
- Produces: `pickDrillWords(cards: CardRow[], stats: DrillStatRow[], n: number): CardRow[]` — biases selection toward words containing the user's weakest letters (accuracy = correct/attempts, unattempted letters count as weakest; weight words by sum of (1 - accuracy) over their unique letters). `scoreAttempt(expected: string, actual: string): { correct: boolean; perLetter: { letter: string; correct: boolean }[] }` — per-Cyrillic-letter correctness by aligning expected transliteration.
- UI: two modes (Cyr→Lat: show Cyrillic, type Latin; Lat→Cyr: show derived Latin, type Cyrillic — on-screen Cyrillic keyboard row for web where no Serbian layout). 10-word rounds, instant feedback, updates `drill_stats` per letter.

**Steps (TDD for lib):**
- [ ] Failing tests for `pickDrillWords` bias + `scoreAttempt` (exact match, single-letter miss maps to the right Cyrillic letter, digraph handling: typing `dz` for `џ` marks џ wrong).
- [ ] Implement lib → pass; build screen; manual verify a round persists stats.
- [ ] Commit `feat: cyrillic trainer`.

---

### Task 10: Tutor chat screen

**Files:**
- Create: `app/(app)/chat.tsx`, `lib/chat.ts` (stream reader + DODAJ parser), `lib/__tests__/chat.test.ts`

**Interfaces:**
- Consumes: `tutor` + `generate` endpoints (Task 6), `chat_messages` table, `api.addCard`/`ensureUserCard` (Task 8).
- Produces: `streamTutor(args: { messages; learnerState; token; onChunk })` — fetch POST to functions URL with `Authorization: Bearer <token>`, read `response.body` chunks (plain text, no SSE parsing — haven pattern); `parseDodaj(text: string): { display: string; suggestions: { sr_cyr: string; en: string }[] }` — strips trailing `DODAJ:` lines into suggestion chips.
- UI: message list (persisted to `chat_messages`, last 20 sent as context), streaming assistant bubble, per-suggestion "＋ у шпил" chip → `generate new_card` → save; Latin subtitle line under assistant Serbian text (derived, respects `show_latin`); learnerState string built from dashboard stats + 5 most-lapsed cards.
- [ ] Test `parseDodaj` (no suggestions; multiple; malformed line ignored). Implement, manual verify streaming + add-to-deck end-to-end.
- [ ] Commit `feat: tutor chat`.

---

### Task 11: Polish, verification, README, deploy docs

**Files:**
- Modify: `README.md`, `app.json` (PWA metadata: name Vukovica, icons, theme), any loose ends
- Create: `docs/plans/ship-runbook.md`

**Steps:**
- [ ] Full local walkthrough of spec §6 success criteria 1–5; fix anything broken.
- [ ] `npm test`, `npm run typecheck`, `npm run build:web` all green.
- [ ] README: setup (env, `db:start`→`db:migrate`→`db:seed`, functions serve, web), architecture summary, deploy steps (hosted Supabase: push migrations, deploy functions `--no-verify-jwt`, set secrets; Vercel: `npx vercel dist --prod` or project config).
- [ ] Commit `chore: readme + ship runbook`.

---

## Self-review notes

- Spec coverage: §2 surfaces → Tasks 8/9/10 + dashboard Task 7; §3.1 → Task 3; §3.2 → Task 6; §3.3 → Task 6 prompts; §3.4 → Task 2; §3.5 → Task 5; seed §2 → Task 4; §4 auth/deploy → Tasks 7/11; §5 tests → embedded per task.
- Type names used across tasks: `CardRow`/`UserCardRow`/`ReviewLogInsert`/`SettingsRow`/`DrillStatRow` defined once in Task 3's `lib/types.ts`.
- Parallelization for the orchestrator: after Task 1 → Tasks 2, 3, 6(prompts/provider parts) can run in parallel (disjoint files); Task 4 needs 2+3; Task 5 needs 3; Tasks 7–10 sequential (shared app files); Task 11 last.
