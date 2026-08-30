# Vukovica

A personal Serbian language-learning app, built for one user (Mark) and his
Serbian family. Cyrillic-first, conversational, ten-minutes-on-the-phone
friendly.

It is a **staged path**, not a toolbox. Four Serbian-named stages decide what
the dashboard leads with:

| Stage | Goal | Its activity |
| --- | --- | --- |
| **Азбука** | master all 30 Cyrillic letters in the trainer | Trainer |
| **Речи** | 100 → 300 → 600 known words | Review |
| **Читање** | 1 → 5 → 20 stories finished | Reader |
| **Разговор** | have a conversation today | Tutor |

The stages are **soft**: nothing is ever locked. A stage only sets the
dashboard's emphasis — the stage name, one goal line and the primary button —
and every other activity keeps a row underneath, in stage order. Reviews stay on
screen at every stage, because they are the daily habit rather than a stage.

Five surfaces, one Expo app shipped as an installable PWA:

- **Trainer** (`Ћирилица`) — deterministic transliteration drills in both
  directions, no AI. Per-letter accuracy is tracked and biases the next drills
  toward weak letters (ђ, ћ, џ, љ, њ…). A letter counts as mastered at 8
  lifetime attempts and 90% accuracy; the screen shows the running `X/30`.
- **Review** (`Учи`) — FSRS-scheduled flashcards over a 681-card seed deck. Front:
  the Cyrillic word plus an audio button; reveal adds Latin transliteration,
  English, grammar metadata and an example sentence. Four grade buttons. A word
  is "known" once it graduates out of learning into `review`.
- **Reader** (`Читање`) — the graded reader, and the feature that serves "read
  children's books". Asks the model for a short Cyrillic story at level 1–3,
  built mostly from words already known, then renders it as **tappable words**:
  tap one and a sheet glosses it, from the deck when the word is a card and from
  the model otherwise, with a one-tap "у шпил" to add it. "Завршио сам" marks the
  story finished, which is what the Читање ladder counts. No Latin in the reading
  view — reading Cyrillic is the point.
- **Deck** (`Шпил`) — browse and search the deck (Cyrillic, Latin or English),
  edit or delete a card, and add a word with AI help.
- **Tutor** (`Разговор`) — a streaming AI chat with a Serbian-tutor persona.
  Replies in Cyrillic with Latin and English support lines, and can offer new
  vocabulary as one-tap "add to deck" chips. Deliberately the **last** row on the
  dashboard until Разговор is the stage: conversation is the end of the path, not
  the start, and the feature takes no further investment until then.

The dashboard leads with the stage and its goal, and keeps the due count, the
daily new-card allowance and the streak on screen underneath.

- Design spec: [`docs/specs/2026-08-29-vukovica-design.md`](docs/specs/2026-08-29-vukovica-design.md)
  and [`docs/specs/2026-08-30-phase2-progression-reader.md`](docs/specs/2026-08-30-phase2-progression-reader.md)
- Implementation plans: [`docs/plans/2026-08-29-vukovica-mvp.md`](docs/plans/2026-08-29-vukovica-mvp.md)
  and [`docs/plans/2026-08-30-phase2.md`](docs/plans/2026-08-30-phase2.md)
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
  (app)/index.tsx      dashboard (stage, goal, primary action)
  (app)/review.tsx     FSRS session
  (app)/chat.tsx       tutor
  (app)/trainer.tsx    Cyrillic drills + letter mastery
  (app)/reader.tsx     story library (unread / finished, new-story picker)
  (app)/story/[id].tsx reading view: tappable words, gloss sheet, "Завршио сам"
  (app)/deck.tsx       browse / search / edit / add
  (app)/settings.tsx
components/          shared UI (CardForm)
lib/                 all the logic worth testing, tests in lib/__tests__/
  supabase.ts          client (SecureStore on native, localStorage on web)
  transliterate.ts     pure Cyrillic <-> Latin, zero deps
  fsrs.ts              ts-fsrs wrapper: grade -> next schedule
  queue.ts, session.ts review queue selection and session state
  drills.ts            trainer word/letter selection
  stages.ts            the progression layer: stage, mastery, goal ladders
  reader.ts            story tokenising, sentence lookup, level suggestion
  chat.ts              tutor streaming + the DODAJ add-word convention
  audio.ts, edge.ts    TTS playback; Edge Function calls
  stores/auth.ts       zustand auth store (React Query owns server state)
data/seed-deck.json  the 681-card seed deck
scripts/             seed.mjs (deck seeder), make-icons.mjs (icon generator)
public/              copied verbatim into the web build (manifest.json, icons)
supabase/
  migrations/          schema, RLS, grants, RPCs, the audio storage bucket,
                       and the stories table
  functions/tutor/     streaming chat        (AI SDK streamText)
  functions/generate/  structured generation (AI SDK generateObject)
  functions/story/     graded-reader story generation + its own insert
  functions/tts/       text-to-speech + Storage cache
  functions/_shared/   provider.ts, prompts.ts, auth.ts, cors.ts, usage.ts,
                       cyrillic.ts
```

**The progression layer.** `lib/stages.ts` is a single pure function,
`computeProgress`, taking plain numbers and `drill_stats` rows and returning the
stage, the letter mastery, both milestone ladders and the one `nextGoal` line the
dashboard renders verbatim. It does no I/O, so every stage boundary is unit-tested
without a database; `api.getProgress()` does the fetching, batching the three
independent reads (drill stats, known-word count, stories finished) into one
round trip.

**Data access rule.** The client does *all* CRUD itself through supabase-js
under RLS — cards, review state, chat history, settings, drill stats, and the
story library. Edge Functions exist only where a server-side secret is required
(`tutor`, `generate`, `story`, `tts`); each one authenticates the caller itself
with `getUser`, which is why they are deployed with `--no-verify-jwt`.

`story` is the one exception to the rule, and deliberately so: it holds the model
call, so it inserts its own row with the service role rather than handing
unvalidated model output back for the client to write. Everything afterwards —
listing the library, marking a story finished — is ordinary client-side CRUD
under RLS like the rest.

**Database.** Eight tables — `cards` (shared, readable by any authenticated
user), and seven owner-only ones: `user_cards` (FSRS state), `review_logs`
(append-only), `chat_messages`, `drill_stats`, `settings`, `ai_usage`, and
`stories` (the reader's library; `finished_at` null means unread, and the
non-null rows are what the Читање ladder counts). Every table carries explicit
`GRANT`s; Supabase no longer adds them for you. Two RPCs keep multi-row writes
atomic: `submit_review` (card state + log in one transaction) and
`bump_drill_stats` (per-letter counters).

**AI.** One provider file (`_shared/provider.ts`) exposes `vuk('chat')` and
`vuk('fast')`; `AI_PROVIDER=anthropic|openai` decides which service backs them.
Stories are the product, so they take the better model (`vuk('chat')`); the
one-word glosses take the fast one. Every prompt lives in `_shared/prompts.ts`
and has constraint tests. Usage is logged to `ai_usage` for observability —
there are no caps.

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
only to Postgres. The tutor, the AI add-word helper, story generation, the
reader's model-written glosses and audio all need `npm run functions` running
*and* a valid API key. Reading a story you already have — including the
deck-matched half of the gloss sheet, and marking it finished — does not.

When you are done, `npx supabase stop` shuts the containers down. Data survives
that, so the next `npm run dev` picks up where you left off; `npx supabase stop
--no-backup` throws the database away instead.

## Tests and checks

```sh
npm test                  # vitest, single run (380 tests)
npm run typecheck         # tsc --noEmit
npm run build:web         # static export into dist/, with the bundler cache cleared
```

`build:web` passes `--clear` deliberately. Metro's cache does not notice an
`EXPO_PUBLIC_*` change, so without it a rebuild after an env edit silently
reuses the old bundle — which matters most in exactly the situation where you
would least notice, building for production.

The test suite is deliberately pure: transliteration round-trips, the FSRS
wrapper, queue and session selection, drill selection, chat parsing, the stage
boundaries and milestone ladders in `lib/stages.ts`, the reader's word splitting
and sentence lookup, seed-deck validation, and prompt-constraint tests over
`_shared/prompts.ts`. Nothing needs a running database.

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

The AI key in local development is stale, so `tutor`, `generate`, `story` and
`tts` fail with a 502 against the real providers until a valid one is supplied.
The app degrades honestly when that happens — the audio button hides itself, the
tutor offers a retry, the add-word flow offers to fill the card in by hand, the
new-story sheet says the AI could not be reached and offers a retry, and the
gloss sheet says the same while the deck-matched glosses keep working — and those
failure paths are verified.

The success paths have been exercised against a local mock provider, but the
things only a real model can settle are **verified only structurally**, by the
prompt constraint tests: that the tutor follows its persona, and that a generated
story really lands inside its level band, stays in Cyrillic and Ekavian, and is
built from words already known. The graded reader has been walked end to end
against a hand-inserted story — tap-glosses from the deck, finishing, and the
Читање ladder counting it — so everything downstream of generation is verified
live. Confirming the model half is the first post-deploy job in the runbook.
