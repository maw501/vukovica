# Vukovica

A personal Serbian language-learning app, built for one user (Mark) and his
Serbian family. Cyrillic-first, conversational, ten-minutes-on-the-phone
friendly.

Four surfaces, one Expo app shipped as an installable PWA:

- **Review** (`Учи`) — FSRS-scheduled flashcards over a 681-card seed deck. Front:
  the Cyrillic word plus an audio button; reveal adds Latin transliteration,
  English, grammar metadata and an example sentence. Four grade buttons.
- **Tutor** (`Разговор`) — a streaming AI chat with a Serbian-tutor persona.
  Replies in Cyrillic with Latin and English support lines, and can offer new
  vocabulary as one-tap "add to deck" chips.
- **Trainer** (`Ћирилица`) — deterministic transliteration drills in both
  directions, no AI. Per-letter accuracy is tracked and biases the next drills
  toward weak letters (ђ, ћ, џ, љ, њ…).
- **Deck** (`Шпил`) — browse and search the deck (Cyrillic, Latin or English),
  edit or delete a card, and add a word with AI help.

A dashboard ties them together with the due count, the daily new-card allowance
and the streak.

- Design spec: [`docs/specs/2026-08-29-vukovica-design.md`](docs/specs/2026-08-29-vukovica-design.md)
- Implementation plan: [`docs/plans/2026-08-29-vukovica-mvp.md`](docs/plans/2026-08-29-vukovica-mvp.md)
- Production deploy: [`docs/plans/ship-runbook.md`](docs/plans/ship-runbook.md)

## Architecture

Expo (SDK 54, expo-router) talking **directly** to Supabase. No tRPC, no API
package, no bundling step for the server — deliberately simpler than its
sibling project `haven`.

```
app/                 expo-router routes
  +html.tsx            the HTML shell for the web export (PWA metadata)
  _layout.tsx          providers + the auth gate
  (auth)/sign-in.tsx
  (app)/index.tsx      dashboard
  (app)/review.tsx     FSRS session
  (app)/chat.tsx       tutor
  (app)/trainer.tsx    Cyrillic drills
  (app)/deck.tsx       browse / search / edit / add
  (app)/settings.tsx
components/          shared UI (CardForm)
lib/                 all the logic worth testing, tests in lib/__tests__/
  supabase.ts          client (SecureStore on native, localStorage on web)
  transliterate.ts     pure Cyrillic <-> Latin, zero deps
  fsrs.ts              ts-fsrs wrapper: grade -> next schedule
  queue.ts, session.ts review queue selection and session state
  drills.ts            trainer word/letter selection
  chat.ts              tutor streaming + the DODAJ add-word convention
  audio.ts, edge.ts    TTS playback; Edge Function calls
  stores/auth.ts       zustand auth store (React Query owns server state)
data/seed-deck.json  the 681-card seed deck
scripts/             seed.mjs (deck seeder), make-icons.mjs (icon generator)
public/              copied verbatim into the web build (manifest.json, icons)
supabase/
  migrations/          schema, RLS, grants, RPCs, the audio storage bucket
  functions/tutor/     streaming chat        (AI SDK streamText)
  functions/generate/  structured generation (AI SDK generateObject)
  functions/tts/       text-to-speech + Storage cache
  functions/_shared/   provider.ts, prompts.ts, auth.ts, cors.ts, usage.ts
```

**Data access rule.** The client does *all* CRUD itself through supabase-js
under RLS — cards, review state, chat history, settings, drill stats. Edge
Functions exist only where a server-side secret is required (`tutor`,
`generate`, `tts`); each one authenticates the caller itself with `getUser`,
which is why they are deployed with `--no-verify-jwt`.

**Database.** Seven tables — `cards` (shared, readable by any authenticated
user), and six owner-only ones: `user_cards` (FSRS state), `review_logs`
(append-only), `chat_messages`, `drill_stats`, `settings`, `ai_usage`. Every
table carries explicit `GRANT`s; Supabase no longer adds them for you. Two
RPCs keep multi-row writes atomic: `submit_review` (card state + log in one
transaction) and `bump_drill_stats` (per-letter counters).

**AI.** One provider file (`_shared/provider.ts`) exposes `vuk('chat')` and
`vuk('fast')`; `AI_PROVIDER=anthropic|openai` decides which service backs them.
Every prompt lives in `_shared/prompts.ts` and has constraint tests. Usage is
logged to `ai_usage` for observability — there are no caps.

**Auth.** Supabase email + password, one user. Account creation only appears
when `EXPO_PUBLIC_ALLOW_SIGNUP=true`, which comes off after registering.

## Local setup, from scratch

Requirements: Node >= 20, Docker (for the local Supabase stack), and the
Supabase CLI (used throughout via `npx supabase`, so nothing to install).

```sh
git clone <this repo> && cd vukovica
npm install
```

### 1. Environment files

Three env files, all git-ignored, each with a different audience. `.env.example`
documents every key.

| File | Read by | Holds |
| --- | --- | --- |
| `.env.local` | Expo (client bundle) and `npm run db:seed` | `EXPO_PUBLIC_*` values, plus the service-role key for seeding |
| `supabase/.env.local` | `npm run functions` | AI provider keys and TTS settings |
| `.env` | Expo, for production builds only | the `EXPO_PUBLIC_*` values you want baked into `dist/` |

Start the stack first, because the local keys come from it:

```sh
npm run db:start          # Postgres, Auth, Storage, Edge runtime, Studio
npx supabase status       # copy the API URL, publishable key and service_role key
```

Then:

```sh
cp .env.example .env.local
```

and fill in:

```sh
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable key from `supabase status`>
EXPO_PUBLIC_ALLOW_SIGNUP=true          # so you can create the dev account below

SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase status`>
```

The service-role key bypasses RLS. Note that it has no `EXPO_PUBLIC_` prefix —
that is exactly what keeps it out of the app bundle. Never add one.

For the AI functions, create `supabase/.env.local`:

```sh
AI_PROVIDER=openai                     # or anthropic
OPENAI_API_KEY=sk-...                  # also required for TTS, whichever provider
# ANTHROPIC_API_KEY=sk-ant-...         # required when AI_PROVIDER=anthropic
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
```

`PUBLIC_SUPABASE_URL` matters locally: inside the Edge runtime `SUPABASE_URL`
points at the internal gateway (`http://kong:8000`), which your browser cannot
reach, and `tts` uses it to build the audio URLs it hands back.

### 2. Database

```sh
npm run db:migrate        # apply migrations (supabase db push --local)
npm run db:seed           # load data/seed-deck.json into public.cards (681 rows)
```

`db:seed` is idempotent — it upserts on the unique Cyrillic form — so it is safe
to re-run after adding cards to the JSON.

To start over at any point:

```sh
npx supabase db reset --local   # wipes the database, replays every migration
npm run db:seed                 # re-seed
```

That also deletes your account, so sign up again (below).

### 3. Run it

```sh
npm run dev               # starts the Supabase stack if needed, then Expo
# or
npm run web               # Expo, web only (assumes the stack is already up)
npm run functions         # Edge Functions, in a second terminal
```

Open http://localhost:8081. With `EXPO_PUBLIC_ALLOW_SIGNUP=true` the sign-in
screen offers **Create one** — register the local dev account (any email and
password, e.g. `mark@local.dev`). Signing up locally logs you straight in,
because email confirmations are off in `supabase/config.toml`.

The Edge Functions are optional for the review flow and the trainer, which talk
only to Postgres. The tutor, the AI add-word helper and audio need
`npm run functions` running *and* a valid API key.

When you are done, `npx supabase stop` shuts the containers down. Data survives
that, so the next `npm run dev` picks up where you left off; `npx supabase stop
--no-backup` throws the database away instead.

## Tests and checks

```sh
npm test                  # vitest, single run (275 tests)
npm run typecheck         # tsc --noEmit
npm run build:web         # static export into dist/, with the bundler cache cleared
```

`build:web` passes `--clear` deliberately. Metro's cache does not notice an
`EXPO_PUBLIC_*` change, so without it a rebuild after an env edit silently
reuses the old bundle — which matters most in exactly the situation where you
would least notice, building for production.

The test suite is deliberately pure: transliteration round-trips, the FSRS
wrapper, queue and session selection, drill selection, chat parsing, seed-deck
validation, and prompt-constraint tests over `_shared/prompts.ts`. Nothing
needs a running database.

To inspect a web export locally, serve `dist/` with any static server that maps
clean URLs onto `<route>.html` (that is what Vercel does), then sign in against
your local stack.

## Deploying

The short version: push migrations and functions to a hosted Supabase project,
build `dist/` with production `EXPO_PUBLIC_*` values, and drop `dist/` onto
Vercel as a static site.

The long version, with the ordering that matters and the two things that will
bite you, is in **[`docs/plans/ship-runbook.md`](docs/plans/ship-runbook.md)**.

## Known limitation

The AI key in local development is stale, so `tutor`, `generate` and `tts` fail
with a 502 against the real providers until a valid one is supplied. The app
degrades honestly when that happens — the audio button hides itself, the tutor
offers a retry, and the add-word flow offers to fill the card in by hand — and
those failure paths are verified. The success paths have been exercised against
a local mock provider, but **"the tutor follows its persona" is currently
verified only structurally**, by the prompt constraint tests. Confirming it
against a real model is the first post-deploy job in the runbook.
