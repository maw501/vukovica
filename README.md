# Vukovica

A personal Serbian language-learning app, built for one user (Mark) and his
Serbian family. Cyrillic-first, conversational, ten-minutes-on-the-phone
friendly.

It is a **staged path**, not a toolbox. Four stages decide what the dashboard
leads with:

| Stage | Goal | Its activity |
| --- | --- | --- |
| **Alphabet** | master all 30 Cyrillic letters | Letters + Trainer |
| **Words** | 100 → 300 → 600 known words | Review |
| **Reading** | 1 → 5 → 20 stories finished | Reader |
| **Books** | read a real book with his son | Books |

The stages are **soft**: nothing is ever locked. A stage only sets the
dashboard's emphasis — the stage name, one goal line and the primary button —
and every other activity keeps a row underneath, in stage order. Reviews stay on
screen at every stage, because they are the daily habit rather than a stage.

**No AI at runtime.** Phase 3 removed every Edge Function and every model call.
Everything the app shows is either seeded content, something Mark wrote, or
something generated once offline by a script in `scripts/`. There is no API key
anywhere in the deployment, nothing to rate-limit, nothing to fail at 502, and
no per-use cost. Where a model is genuinely useful it works **between** sessions
instead: the capture queue collects questions and Claude answers them into the
deck out of band.

**English chrome, Serbian content.** Every label, button and heading is in
English. The Serbian is the material — the words on the cards, the text of the
stories and books, the prompts in the grammar drills — which is the distinction
that keeps the app navigable while the language being learned stays hard.

## The surfaces

One Expo app shipped as an installable PWA.

- **Review** — FSRS-scheduled flashcards over the 724-card word deck. Front: the
  Cyrillic word plus a speaker button; reveal adds Latin transliteration,
  English, grammar metadata and an example sentence. Four grade buttons. A word
  is "known" once it graduates out of learning into `review`.
- **Letters** — the same FSRS machinery over the 30 letters of the azbuka, as a
  separate deck (`cards.kind`) with its own queue and its own due count. A
  letter card shows the pair («Б б») and plays the letter's sound followed by
  its example word.
- **Trainer** — deterministic transliteration drills in both directions. Every
  answer is marked letter by letter, and per-letter accuracy biases the next
  round towards the weak ones (ђ, ћ, џ, љ, њ…). A letter is mastered at 8
  lifetime attempts and 90% accuracy; the Alphabet stage counts exactly that.
- **Grammar** — twelve seeded topics in teaching order (to be, to have, the
  present tense, the cases he will actually meet, pronouns, negation). Each is a
  short explanation and then a ten-item fill-in-the-blank drill over a Serbian
  frame with one word missing, so what is tested is the ending rather than
  vocabulary. Answers can be typed in either script.
- **Reader** — the graded reader: four seeded warm-up stories in big Cyrillic,
  every word tappable. "Finished" marks a story read, which is what the Reading
  ladder counts.
- **Books** — the feature that serves "read children's books with my son". A
  book is either a Claude-authored Serbian rendering (the first one is *Погоди
  колико те волим*, 16 pages) or one built from **photographs** of the physical
  book on the shelf, saved immediately and transcribed offline. Reading is one
  page at a time, big Cyrillic, every word tappable.
- **Deck** — browse and search every card (Cyrillic, Latin or English), edit or
  delete one, and add a word by hand.
- **Requests** — the capture queue. "How do I say…?" is filed rather than
  answered on the spot, because the useful unit is not an instant gloss but a
  card that joins the rotation. Tapping an unknown word while reading files into
  the same queue from the other end. Claude answers the queue between sessions
  and the card appears beside the question that asked for it.
- **Progress** — the streak record, XP total and level, and every ladder the app
  counts. The dashboard shows only what the next five minutes need; this is the
  answer to "how am I doing?".

**No Latin in a reading view.** The transliteration a learner can lean on
everywhere else is exactly what would stop him reading, so `settings.show_latin`
deliberately does not reach a story or a book page. The gloss sheet a tap opens
is a different matter: that is the answer, not the exercise.

**Audio.** Every one of the 754 cards has a recorded clip, generated once
offline by `scripts/generate-audio.mjs` with a local neural TTS and stored in
the public `audio` bucket. A card with a clip gets a speaker button; a card
without one gets no button, rather than a button that does nothing.

- Design spec: [`docs/specs/2026-08-29-vukovica-design.md`](docs/specs/2026-08-29-vukovica-design.md),
  [`docs/specs/2026-08-30-phase2-progression-reader.md`](docs/specs/2026-08-30-phase2-progression-reader.md)
  and [`docs/specs/2026-08-30-phase3-revamp.md`](docs/specs/2026-08-30-phase3-revamp.md)
- Implementation plans: [`docs/plans/2026-08-29-vukovica-mvp.md`](docs/plans/2026-08-29-vukovica-mvp.md),
  [`docs/plans/2026-08-30-phase2.md`](docs/plans/2026-08-30-phase2.md)
  and [`docs/plans/2026-08-30-phase3.md`](docs/plans/2026-08-30-phase3.md)
- The audio batch: [`docs/plans/audio-batch.md`](docs/plans/audio-batch.md)
- Production deploy: [`docs/plans/ship-runbook.md`](docs/plans/ship-runbook.md)

## Architecture

Expo (SDK 54, expo-router) talking **directly** to Supabase. No tRPC, no API
package, no server code of any kind — deliberately simpler than its sibling
project `haven`, and simpler again since phase 3 deleted the Edge Functions.

```
app/                 expo-router routes
  +html.tsx            the HTML shell for the web export (PWA metadata)
  _layout.tsx          providers + the auth gate
  (auth)/sign-in.tsx
  (app)/index.tsx      dashboard (stage, goal, primary action)
  (app)/review.tsx     FSRS session; ?deck=letters is the letters queue
  (app)/trainer.tsx    Cyrillic drills + letter mastery
  (app)/grammar.tsx    the twelve topics
  (app)/grammar/[slug].tsx   one topic: explanation, then its drill
  (app)/reader.tsx     story library (unread / finished)
  (app)/story/[id].tsx reading view: tappable words, gloss sheet, "Finished"
  (app)/books.tsx      the shelf; add a book from photographs
  (app)/book/[id].tsx  reading view, a page at a time
  (app)/deck.tsx       browse / search / edit / add
  (app)/requests.tsx   the capture queue
  (app)/progress.tsx   streak record, XP, every ladder
  (app)/settings.tsx
components/          shared UI: CardForm, GlossSheet, SpeakButton, XpRing
lib/                 all the logic worth testing, tests in lib/__tests__/
  supabase.ts          client (SecureStore on native, localStorage on web)
  api.ts               every read and write, in one place
  transliterate.ts     pure Cyrillic <-> Latin, zero deps
  fsrs.ts              ts-fsrs wrapper: grade -> next schedule
  queue.ts, session.ts review queue selection and session state
  drills.ts            trainer word/letter selection
  grammar.ts           answer checking, run selection, explanation parsing
  books.ts             page numbering, photo validation, object paths
  requests.ts          what counts as a request, and how a tap becomes one
  stages.ts            the progression layer: stage, mastery, goal ladders
  xp.ts                XP awards, levels, the ring's geometry
  streak.ts            streak from review timestamps
  reader.ts            story tokenising, sentence lookup
  audio.ts             playback of a stored clip
  stores/auth.ts       zustand auth store (React Query owns server state)
data/seed-deck.json  the 681-card starter deck
data/phase3/         the hand-authored phase 3 content: the alphabet, the twelve
                     grammar topics, the GHMILY book and its vocabulary, and the
                     warm-up stories (README.md there gives every shape)
scripts/             seed.mjs (word decks), seed-user-content.mjs (the book and
                     the stories), generate-audio.mjs (the clips),
                     make-icons.mjs (icon generator)
public/              copied verbatim into the web build (manifest.json, icons,
                     vercel.json)
supabase/
  migrations/          schema, RLS, grants, RPCs, the two storage buckets, and
                       the seeded letters and grammar
```

**The progression layer.** `lib/stages.ts` is a single pure function,
`computeProgress`, taking plain numbers and `drill_stats` rows and returning the
stage, the letter mastery, the milestone ladders and the one `nextGoal` line the
dashboard renders verbatim. It does no I/O, so every stage boundary is
unit-tested without a database; `api.getProgress()` does the fetching, batching
the independent reads into one round trip.

**Data access rule.** The client does *all* CRUD itself through supabase-js
under RLS. There are no exceptions any more — no functions, no service role in
anything the app runs, no server-side code at all. The service-role key exists
only in the three scripts under `scripts/`, which run on a laptop.

Anything a model would have done at runtime is done offline instead, and the
result is data by the time the app sees it: the alphabet and the grammar arrive
in migrations, the book and stories through `seed-user-content.mjs`, the audio
through `generate-audio.mjs`, and the answers to the capture queue by Claude
writing cards between sessions.

**Database.** Fifteen tables. One is shared — `cards`, readable by any
authenticated user, holding both decks (`kind` is `word` or `letter`) — and two
more are global seeded content with no owner: `grammar_topics` and
`grammar_items`. The rest are owner-only, keyed on `auth.uid()`: `user_cards`
(FSRS state), `review_logs` (append-only), `drill_stats`, `grammar_stats`,
`settings`, `stories`, `books`, `book_pages`, `requests` and `xp_events`.

Two of the fifteen — `chat_messages` and `ai_usage` — are left over from the
tutor and are no longer read or written by anything. They are harmless, and
dropping them is a migration nobody has needed yet.

Every table carries explicit `GRANT`s; Supabase no longer adds them for you.
Three RPCs keep multi-row writes atomic: `submit_review` (card state and its log
in one transaction), `bump_drill_stats` and `bump_grammar_stats` (per-letter and
per-topic counters). XP is not one of them — `xp_events` is an append-only
ledger written by a plain client insert under its own policy, and a lost point
is not worth a transaction. Two storage buckets: `audio`, public-read, holding
the pronunciation
clips; and `book-photos`, private and owner-scoped, holding the photographed
pages.

**Auth.** Supabase email + password, one user. Account creation only appears
when `EXPO_PUBLIC_ALLOW_SIGNUP=true`, which comes off after registering.

## Local setup, from scratch

Requirements: Node >= 20, Docker (for the local Supabase stack), and the
Supabase CLI (used throughout via `npx supabase`, so nothing to install).
For the audio batch only: Piper and ffmpeg — see
[`docs/plans/audio-batch.md`](docs/plans/audio-batch.md).

```sh
git clone <this repo> && cd vukovica
npm install
```

### 1. Environment files

Two env files, both git-ignored. `.env.example` documents every key. There are
**no server-side secrets** — phase 3 deleted the Edge Functions and with them
`supabase/.env.local`.

| File | Read by | Holds |
| --- | --- | --- |
| `.env.local` | Expo (client bundle) and the `db:*` scripts | `EXPO_PUBLIC_*` values, plus the service-role key for seeding |
| `.env` | Expo, for production builds only | the `EXPO_PUBLIC_*` values you want baked into `dist/` |

Start the stack first, because the local keys come from it:

```sh
npm run db:start          # Postgres, Auth, Storage, Studio
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

### 2. Database

```sh
npm run db:migrate        # apply migrations (supabase db push --local)
npm run db:seed           # load the word decks into public.cards (724 rows)
```

`db:seed` loads both card files — `data/phase3/ghmily-vocab.json` (43, the first
book's words) and `data/seed-deck.json` (681) — in that order, which is the
order they reach the new-card queue. The book's vocabulary goes first
deliberately: reading *Погоди колико те волим* with his son is the stated first
goal, and 43 cards is about a fortnight. It is idempotent: it upserts on the
unique Cyrillic form, so it is safe to re-run after adding cards to either JSON.

The alphabet (30 letter cards) and the twelve grammar topics are *not* seeded
here. They ship in migrations, so `db:migrate` alone gives you a database the
letters deck and the grammar section already work in.

The book and the stories belong to an account, so they wait until you have one
(step 3):

```sh
npm run db:seed:user                    # the project's only account
npm run db:seed:user -- mark@local.dev  # or name it
```

That inserts *Погоди колико те волим* (Claude's rendering of *Guess How Much I
Love You*) with its 16 pages, and the four warm-up stories, all from
`data/phase3/`. It is idempotent per row — an existing book, page or story is
left exactly as it is, so finishing a story or editing a page survives a re-run.

Audio is optional and separate, because it needs a TTS engine installed:

```sh
npm run db:audio          # speak all 754 cards, upload, fill in cards.audio_path
```

Skip it and the app works exactly as it does now, minus the speaker buttons.
[`docs/plans/audio-batch.md`](docs/plans/audio-batch.md) has the one-time
install and the rerun rules.

To start over at any point:

```sh
npx supabase db reset --local   # wipes the database, replays every migration
npm run db:seed                 # re-seed the decks
```

That also deletes your account, so sign up again (below), then re-run
`npm run db:seed:user` and `npm run db:audio`.

> **The letter cards' audio is human, not TTS.** The 30 letter clips are
> Mark's wife's voice and cannot be regenerated by `db:audio` — a reset
> followed by the TTS batch replaces her recordings with a synthetic voice.
> The clips live in `recordings/letter-clips/` (git-ignored, this machine
> only) and in the hosted `audio` bucket at `cards/<id>-w1.mp3`; after a
> local reset, re-upload them from there rather than re-running TTS over
> the letter deck.

### 3. Run it

```sh
npm run dev               # starts the Supabase stack if needed, then Expo
# or
npm run web               # Expo, web only (assumes the stack is already up)
```

Open http://localhost:8081. With `EXPO_PUBLIC_ALLOW_SIGNUP=true` the sign-in
screen offers **Create one** — register the local dev account (any email and
password, e.g. `mark@local.dev`). Signing up locally logs you straight in,
because email confirmations are off in `supabase/config.toml`.

There is no second terminal to run. Every screen talks only to Postgres and
Storage, so if the stack is up, all of it works.

When you are done, `npx supabase stop` shuts the containers down. Data survives
that, so the next `npm run dev` picks up where you left off; `npx supabase stop
--no-backup` throws the database away instead.

## Tests and checks

```sh
npm test                  # vitest, single run (414 tests)
npm run typecheck         # tsc --noEmit
npm run build:web         # static export into dist/, with the bundler cache cleared
```

`build:web` passes `--clear` deliberately. Metro's cache does not notice an
`EXPO_PUBLIC_*` change, so without it a rebuild after an env edit silently
reuses the old bundle — which matters most in exactly the situation where you
would least notice, building for production.

The test suite is deliberately pure: transliteration round-trips, the FSRS
wrapper, queue and session selection, drill selection, the grammar drill's
answer checking and run selection, the stage boundaries and milestone ladders,
XP and streaks, the reader's word splitting and sentence lookup, book page
numbering and photo validation, the capture queue's rules, and validation of
every seed file (the deck, the book's vocabulary, the alphabet, the grammar, the
book, the stories) against the migrations and scripts that load them. Nothing
needs a running database.

To inspect a web export locally, serve `dist/` with any static server that maps
clean URLs onto `<route>.html` (that is what Vercel does), then sign in against
your local stack.

## Deploying

The short version: push migrations to a hosted Supabase project, run the three
content scripts against it, build `dist/` with production `EXPO_PUBLIC_*`
values, and drop `dist/` onto Vercel as a static site. There is nothing to
deploy that runs code — no functions, no secrets, no keys.

The long version, with the ordering that matters and the traps that will bite
you, is in **[`docs/plans/ship-runbook.md`](docs/plans/ship-runbook.md)**.
