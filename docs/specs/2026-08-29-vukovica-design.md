# Vukovica — Personal Serbian Learning App (Design Spec)

**Date:** 2026-08-29
**Status:** Approved by Mark (chat, 29 Aug 2026)
**Owner:** Mark Worrall (single user — this is a personal app)

## 1. Purpose & Goals

Mark is a beginner in Serbian (some vocab from evening classes). His wife is Serbian and they have a baby — the goal is real family conversation and reading. Priorities:

- **Conversational** Serbian for home/family life
- **Reading**, Cyrillic-first (Latin script shown as secondary, toggleable)
- Ekavian variant (standard Serbia)
- Daily-habit friendly: 10 minutes on the phone must be productive

No Duolingo Serbian course exists; content is AI-generated over a curated skeleton.

## 2. Product Scope (MVP)

Four surfaces, one Expo app shipped as a PWA:

1. **SRS vocabulary review** — FSRS-scheduled flashcards. Card front: Cyrillic word (+audio button); reveal: Latin transliteration, English, grammar metadata (gender/aspect/POS), example sentence (Cyrillic + English). Four grade buttons (Again / Hard / Good / Easy). Daily queue = due cards + configurable new-cards-per-day (default 10).
2. **AI tutor chat** — streaming conversation with a Serbian tutor persona. Replies in Serbian (Cyrillic) pitched at beginner level with Latin + English support, inline gentle corrections with a one-line grammar reason, switches to English when the user is stuck. Can propose words to add to the deck ("add to deck" affordance on tutor-suggested vocab).
3. **Cyrillic trainer** — deterministic transliteration drills, no AI: show a Serbian word in one script, user types it in the other; instant feedback. Tracks per-letter accuracy to bias drills toward weak letters (ђ, ћ, џ, љ, њ...).
4. **Home dashboard** — due-card count, streak, quick links to the three activities.

**Seed content:** ~600-word deck: core frequency vocabulary plus a family/baby/home domain layer (family members, baby care, food, household, greetings, courtesy). Stored as JSON in-repo, loaded by seed migration/script. Each entry: Cyrillic form, English gloss, POS, gender (nouns), aspect (verbs), example sentence (Cyrillic + English), domain tag. Latin forms are ALWAYS derived by transliteration, never stored.

**Explicitly out of MVP (Phase 2):** grammar path (~40–60 curated topics + generated drills), graded reader mini-stories, speaking practice (Whisper), TTS pre-generation of full audio library, native EAS build, push notifications.

**Audio in MVP:** on-demand TTS via Edge Function with Supabase Storage caching (generate once per text, serve cached file thereafter). If no TTS key is configured, the audio button hides gracefully.

## 3. Architecture

Modeled on haven (`~/development/haven` — read its CLAUDE.md for Supabase gotchas) but deliberately simpler: **no tRPC, no API package, no esbuild bundling**.

```
app/                    -- expo-router routes (Expo SDK 54, managed)
  (auth)/sign-in.tsx
  (app)/index.tsx       -- dashboard
  (app)/review.tsx      -- SRS session
  (app)/chat.tsx        -- tutor
  (app)/trainer.tsx     -- Cyrillic drills
  (app)/deck.tsx        -- browse/search deck, per-card detail
  (app)/settings.tsx
lib/
  supabase.ts           -- client (SecureStore adapter on native, localStorage on web)
  transliterate.ts      -- pure Cyrillic<->Latin functions (zero deps)
  fsrs.ts               -- ts-fsrs wrapper: grade->next schedule
  audio.ts              -- fetch/cache/play TTS audio
  stores/               -- zustand (auth/settings); React Query for server state
data/
  seed-deck.json        -- ~600 seed cards
supabase/
  migrations/           -- schema + RLS + grants + seed
  functions/
    tutor/              -- streaming chat (AI SDK streamText -> toTextStreamResponse)
    generate/           -- Haiku/structured generation (example sentences, new cards)
    tts/                -- TTS + Storage cache
    _shared/            -- provider.ts, prompts.ts, auth.ts
docs/specs/, docs/plans/
```

**Data access rule:** the client talks to Supabase directly via supabase-js under RLS for ALL CRUD (cards, review state, chat history, settings, drill stats). Edge Functions exist ONLY where a server-side secret is required: `tutor`, `generate`, `tts`. Auth enforced inside each function via `getUser(token)` (haven's `getAuthenticatedUser` pattern; deploy with `--no-verify-jwt`).

### 3.1 Database schema (Postgres via Supabase)

- `cards` — id (uuid), sr_cyr (text, unique), en (text), pos (text), gender (text null), aspect (text null), example_cyr (text), example_en (text), domain (text), audio_path (text null), created_by (uuid null; null = seed), created_at. Readable by all authenticated; insert allowed to authenticated (tutor-added words).
- `user_cards` — user_id, card_id (PK pair), FSRS state: due (timestamptz), stability, difficulty, reps, lapses, state (new/learning/review/relearning), last_review. RLS: owner-only.
- `review_logs` — append-only: user_id, card_id, grade, reviewed_at, elapsed_days, state before/after. Owner-only. Powers streak + stats.
- `chat_messages` — id, user_id, role, content, created_at. Owner-only. Client loads last N for context.
- `drill_stats` — user_id, letter (text), attempts, correct. Owner-only.
- `settings` — user_id PK, show_latin (bool default true), new_per_day (int default 10), tts_enabled (bool default true).
- `ai_usage` — id, user_id, surface (tutor/generate/tts), model, input_tokens, output_tokens, cost_cents, created_at. Owner-only read; written by Edge Functions (service role).

Every table migration includes explicit `GRANT ... TO authenticated` + `GRANT ALL TO service_role` (Supabase no longer auto-grants — haven gotcha #1).

Seeding: `cards` seeded from `data/seed-deck.json` via a seed script (`npm run db:seed` using service role locally); `user_cards` rows are created lazily when a card first enters the user's queue.

### 3.2 AI layer

- **Vercel AI SDK** with a `customProvider` alias pattern (haven's `provider.ts`): `vuk('chat')` and `vuk('fast')`.
- **Provider switchable by env** (`AI_PROVIDER=anthropic|openai`):
  - anthropic: chat=`claude-sonnet-5`, fast=`claude-haiku-4-5` (needs `ANTHROPIC_API_KEY`)
  - openai: sensible current defaults, overridable via `AI_CHAT_MODEL` / `AI_FAST_MODEL` env (works today with Mark's existing `OPENAI_API_KEY`)
- **`tutor` function:** plain-text streaming (`toTextStreamResponse()`, haven pattern — client reads chunks, no SSE parsing). System prompt: Serbian tutor persona (see 3.3). Context: last 20 messages + a compact learner-state block (recent weak cards, deck size, settings). Marks vocabulary suggestions with a lightweight inline convention the client can parse (e.g. a final line `DODAJ: реч = word` list) rather than tool calls — keep v1 simple.
- **`generate` function:** `generateObject` with zod schema. Two modes: `example` (fresh example sentence for a card) and `new_card` (full card JSON from a Cyrillic or English word — used by chat's add-to-deck and deck screen's add-word).
- **`tts` function:** POST `{text}` → checks Storage bucket `audio` for hash(text).mp3 → generates via OpenAI TTS if missing → returns public URL. Voice/config via env.
- Every AI call logs to a simple `ai_usage` table (tokens, cost cents, surface) — observability only, no caps.

### 3.3 Prompt discipline (haven lesson)

Prompts live in ONE file (`supabase/functions/_shared/prompts.ts`), with constraint tests. Tutor persona invariants:

- Always reply Serbian-first in Cyrillic; word-for-word Latin + English help lines while learner level is beginner.
- Ekavian, standard Serbian. No mixing ijekavian.
- Corrections: gentle, inline, max one grammar note per message, one line each.
- Never dump grammar tables unasked; keep replies short (2–4 sentences of Serbian).
- Family/home conversational topics preferred when the user has no topic.
- Anti-boilerplate: no "Great question", no emoji spam, no English-only replies unless the user asks in English for help.

### 3.4 Transliteration (`lib/transliterate.ts`)

Pure functions `cyrToLat` and `latToCyr` implementing the exact 1:1 Serbian mapping, including digraphs (њ→nj, љ→lj, џ→dž, ђ→đ, ћ→ć, ж→ž, ш→š, ч→č) with correct casing (Њ→Nj, and ALL-CAPS context → NJ) and latToCyr digraph disambiguation (nj/lj/dž parsed greedily; edge cases like "nadživeti" are out of scope for v1 — dictionary words in the deck must round-trip, enforced by a seed validation test). Fully unit-tested; this module is load-bearing for the whole Cyrillic-first design.

### 3.5 FSRS (`lib/fsrs.ts`)

Use `ts-fsrs` (npm). Thin wrapper mapping our `user_cards` row ⇄ ts-fsrs Card, one function `gradeCard(row, grade, now) -> nextRow + logRow`. Review queue query: due first (oldest due), then new cards up to remaining daily allowance. All client-side; state persisted straight to Supabase.

## 4. Auth & deployment

- Supabase Auth, email+password (single user; signup disabled after Mark registers — env-flagged).
- Web deploy: `expo export --platform web` → Vercel (haven's `deploy:web` pattern incl. patch-web-html if needed). PWA installed to home screen.
- Supabase: local Docker for dev; hosted project for prod. Deploy functions with `--no-verify-jwt`, import map via `config.toml` per-function `import_map` (haven gotchas).
- Env: `supabase/.env.local` → `OPENAI_API_KEY` (copy from haven), optional `ANTHROPIC_API_KEY`, `AI_PROVIDER`.

## 5. Error handling & quality

- Edge Functions: auth check → 401; provider errors → 502 with terse message; client shows retry affordance. TTS failure degrades to silent (no audio button).
- Review flow works offline-tolerantly within a session (optimistic updates via React Query, retry on reconnect); full offline mode is out of scope.
- Tests (vitest): transliteration round-trip + digraph cases; FSRS wrapper scheduling; seed-deck validation (schema, unique Cyrillic forms, round-trip transliteration, domain coverage); prompt constraint tests (invariants in 3.3); review-queue selection logic.
- Seed deck content generated by Opus during build, validated by script; Mark's wife is the human QA path — deck screen makes it easy to edit/delete a bad card.

## 6. Success criteria (MVP done =)

1. `npm run dev` boots local Supabase + Expo; sign-in works.
2. Seeded deck of ~600 cards; daily review session with FSRS scheduling persists across sessions.
3. Cyrillic trainer drills work with per-letter stats.
4. Tutor chat streams, follows persona invariants, and can add a suggested word to the deck.
5. TTS plays on cards when a key is present; hidden when not.
6. All tests green; deployable to Vercel + hosted Supabase with documented steps in README.
