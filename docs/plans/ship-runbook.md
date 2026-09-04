# Vukovica — ship runbook

Taking the app from a clean checkout to a live, installable PWA: a hosted
Supabase project for the data, and a static Vercel deployment for the web build.

Written for a single-user deployment. Nothing here is automated on purpose —
this runs a handful of times a year, and every step is one command.

**Read `README.md` first** if you have not run the app locally. This document
assumes the local stack already works.

> **Since phase 3 there is no server code.** No Edge Functions, no AI provider,
> no secrets of any kind in the deployment. What used to be four functions is
> now three laptop scripts that write data before the deploy. If you are
> upgrading an existing deployment rather than starting fresh, jump to
> [Phase 3 deploy checklist](#phase-3-deploy-checklist) at the end — it is the
> exact sequence, including the teardown of what phase 3 removed.

---

## 0. Before you start

You will need:

- A [Supabase](https://supabase.com/dashboard) account, and a project created in
  a region near you (London for Mark). Note its **project ref** — the
  `abcdefghijklmnop` in the dashboard URL — and the database password you set.
- A [Vercel](https://vercel.com) account.

That is the whole list. There is no AI key to obtain, because nothing in the
deployment calls a model.

Everything below runs from the repo root, with the Supabase CLI invoked as
`npx supabase` (no global install needed).

---

## 1. Supabase: database

Link the repo to the hosted project. This writes `supabase/.temp/`, not tracked
by git, and asks for the database password.

```sh
npx supabase login
npx supabase link --project-ref <your-project-ref>
```

Push the migration chain. There is no separate schema dump — the migrations in
`supabase/migrations/` are the whole story, and they replay cleanly from empty
(verified).

```sh
npx supabase migration list     # what the project has, and what is pending
npx supabase db push
```

That creates the tables with their RLS policies and grants, the `submit_review`,
`bump_drill_stats` and `bump_grammar_stats` RPCs, the seeded alphabet and
grammar topics, **and both storage buckets** — the public `audio` one and the
private `book-photos` one. You do not need to create either by hand in the
dashboard; the migrations insert them into `storage.buckets`.

### The content scripts

Three scripts put content into the project. All of them use the service-role
key, so they bypass RLS. Point the seeding half of your env at the hosted
project with a separate file:

```sh
# .env.hosted  (git-ignored by the .env.* rule)
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key from Project Settings -> API Keys>
```

Deliberately not `.env.production.local`: Expo loads that name during a
production build, and this file has no business anywhere near the bundle.

**The word decks** — run this now:

```sh
node --env-file=.env.hosted scripts/seed.mjs
```

Expect `Done. public.cards now holds 724 word cards.` — the 43 words of the
first book, then the 681-card starter deck, in that order because that is the
order they reach the new-card queue. The seeder upserts on the unique Cyrillic
form, so re-running it is harmless.

The alphabet and the grammar topics need no seeding step: they ship in
migrations, so `db push` already put them there.

**The book and the stories** belong to an account, so they wait until step 6.1.

**The audio** can be done any time, and is step 2.

## 2. Audio

Every card's pronunciation is generated once, offline, and uploaded to the
`audio` bucket; the app only reads `cards.audio_path`. This needs Piper and
ffmpeg installed on the laptop — a one-time setup covered in
[`audio-batch.md`](audio-batch.md), which is also where the reruns, the flags
and the fallback engines live.

```sh
node scripts/generate-audio.mjs --hosted
```

`--hosted` reads `.env.hosted` itself, so there is no `--env-file` here. Expect
`Done. 754 cards now have a clip in audio/cards/.` — 30 letters and 724 words,
about 6.7 MB in total. It skips cards that already have a clip, so re-running
after adding words costs only the new ones.

This step is **optional**. Skip it and the app works exactly as it does with it,
minus the speaker buttons — a card with no clip shows no button rather than a
button that does nothing.

## 3. Build the web bundle

**This is the step that goes wrong.** `EXPO_PUBLIC_*` values are inlined into
the JavaScript at build time, so the bundle you upload is permanently stamped
with whatever the bundler saw. Two traps:

1. **Metro's cache does not notice an environment change.** Run a bare
   `expo export` twice with different `EXPO_PUBLIC_*` values and the second run
   happily reuses the first bundle — silently, with no warning. It looks exactly
   like Expo "ignoring" your new values. This one is disarmed for you:
   `npm run build:web` passes `--clear`, so use the script rather than calling
   `expo export` by hand.
2. **Every `.env*` file Expo can find contributes, and `.env.local` outranks
   `.env`.** `.env.local` is loaded in production builds too, so a leftover
   local `EXPO_PUBLIC_SUPABASE_URL` is baked in over the top of the one you
   carefully put in `.env`. A shell export does beat both — but combined with
   trap 1 that is a trap of its own, because an export that silently didn't
   rebuild looks exactly like an export that was ignored. Put the values in a
   file and delete the ambiguity.

So: write the production values into `.env`, and move `.env.local` aside while
building. The second half is not optional.

```sh
# .env  (git-ignored)
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable key from Project Settings -> API Keys>
EXPO_PUBLIC_ALLOW_SIGNUP=true
```

`EXPO_PUBLIC_ALLOW_SIGNUP=true` for the **first** build only — you need the
Create account button once, to register. See step 6.

```sh
mv .env.local .env.local.dev            # keep local values out of this build
rm -rf dist
npm run build:web                       # carries --clear
mv .env.local.dev .env.local
```

If the export dies part-way through, put `.env.local.dev` back first, before
debugging anything else — the last line never ran, and a missing `.env.local`
turns every later local command into a confusing failure of its own.

Now prove the bundle points where you think it does, before uploading it:

```sh
grep -ro '<project-ref>\.supabase\.co' dist/_expo | head -1     # expect a hit
grep -ro '127\.0\.0\.1:54321' dist/_expo | head -1              # expect nothing
```

If the second grep finds something, your `.env` and `.env.local` are not saying
what you think. Delete `dist`, check both files, and build again.

## 4. Vercel

`dist/` is a plain static site — pre-rendered HTML per route, a JS bundle, the
PWA manifest and the icons. There is no server side.

```sh
npx vercel login
cp -R .vercel dist/.vercel   # copy the project link into the build output
cd dist && npx vercel deploy --prod --yes && cd ..
```

Answer the setup prompts once (scope, project name `vukovica`); the link is
stored in `.vercel/` at the repo root. NEVER run `npx vercel deploy --prod dist`
from the repo root: passing a path makes the CLI treat `dist` as a *new project
root* and it silently creates (and deploys to) a separate project named `dist`.
Deploy from inside `dist/` with the link copied in, as above — the build wipes
`dist/` each time, so the `cp -R` is needed on every deploy.

Vercel resolves `/review` to `review.html` for static deployments, which is what
the export expects.

### The dynamic routes need rewrites

**The one thing a static host gets wrong by default.** The MVP was all fixed
routes, so every URL had a file next to it. Three routes now take a parameter —
`/story/[id]`, `/book/[id]` and `/grammar/[slug]` — and the export writes each
as a single literal file:

```
dist/story/[id].html
dist/book/[id].html
dist/grammar/[slug].html
```

Nothing serves `/story/<some-uuid>` from that. In-app navigation is fine — the
app is an SPA once it has loaded, so tapping a story never asks the server for
anything — but a **reload, a bookmark, or a shared link** on one of those pages
hits the host directly and 404s.

So ship rewrites — one per dynamic route:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    { "source": "/story/:id", "destination": "/story/%5Bid%5D" },
    { "source": "/book/:id", "destination": "/book/%5Bid%5D" },
    { "source": "/grammar/:slug", "destination": "/grammar/%5Bslug%5D" }
  ]
}
```

They live in `public/vercel.json`, not `dist/`, so they survive the next build —
`public/` is copied verbatim into `dist/` on export, which is how
`manifest.json` and `icons/` get there. The file is in place, and the three
destinations were checked against a real `npm run build:web` (`dist/story/[id].html`,
`dist/book/[id].html`, `dist/grammar/[slug].html`).

A destination is the URL-encoded literal filename with **no extension** — a
bracketed or `.html` destination silently fails to match on Vercel, verified
live for `/story/:id` in phase 2. `/book` and `/grammar` were added in phase 3
and follow the same pattern, but have only been checked against the export's
filenames, not against a live deployment — so on the phase 3 deploy, reloading a
book page and a grammar topic is a check that matters rather than a formality.

Check it on the live site before you call the deploy done: open a story, a book
page and a grammar topic, and **reload each one**.

## 5. Point Supabase Auth at the deployment

In the dashboard, **Authentication → URL Configuration**, set the Site URL to
your Vercel production domain. Password sign-in works without this, but it is
what any future email link would use.

## 6. Post-deploy checklist

Work through this in order — steps 2 and 3 are what make the deployment
single-user.

1. **Register.** Open the site, tap **No account yet? Create one**, and sign up
   with a real email and a password you will not forget. If the project has
   email confirmations on (the hosted default), confirm the link, then sign in.
   You should land on the dashboard reading **Alphabet**, `Alphabet — 0 of 30
   letters mastered, 30 to go`, with `724 cards not yet studied` underneath — a
   brand-new account is at the start of the path, so the first stage and an
   empty letter count are exactly right.

   Now that the account exists, give it the content that has an owner — the
   GHMILY book with its 16 pages, and the four warm-up stories:

   ```sh
   node --env-file=.env.hosted scripts/seed-user-content.mjs you@example.com
   ```

   It inserts only what is missing, so it is safe to run again after adding
   content to `data/phase3/`. Reload: **Books** should list *Погоди колико те
   волим* and **Reader** four stories.

2. **Close the door, server-side.** Dashboard → **Authentication → Sign In /
   Providers → Email**, turn **Allow new users to sign up** off. This is the
   real lock; the client flag is only cosmetic.

3. **Close the door, client-side.** Rebuild and redeploy with the sign-up path
   compiled out — otherwise the button is still sitting there in the bundle:

   ```sh
   # in .env
   EXPO_PUBLIC_ALLOW_SIGNUP=false
   ```

   then repeat step 3's build and step 4's deploy. Confirm on the live site that
   the **Create one** button is gone.

4. **Review works.** Start a session, reveal a card, grade it, reload the page.
   The queue should pick up where you left off and the dashboard streak should
   read 1 day.

5. **Letters work.** Open **Letters** from the dashboard. It is the same review
   machinery over a different deck, so a card should show a pair («А а») and
   grading should behave exactly as Review does — and the two due counts should
   stay independent.

6. **Trainer works.** A drill in each direction, one right and one wrong. The
   mastery bar should move the moment a letter clears 8 lifetime attempts at
   90%, and the dashboard's stage line should follow it.

7. **Grammar works.** Open **Grammar**: twelve topics. Open one, read the
   explanation, run its drill, and answer at least one item in Latin as well as
   Cyrillic — both are accepted, and that is the thing worth checking on a real
   keyboard. The accuracy beside the topic should move.

8. **A story reads, and the gloss sheet answers.** Open Reader, open a story,
   and tap a word that is in the deck: the sheet should show that card's English
   and example, marked as already in the deck, with its speaker button. Then tap
   one that is *not* in the deck: the sheet should offer to file it as a
   request — there is no model to ask any more, and that is the designed
   behaviour, not a failure.

9. **Finish a story, and reload one.** Tap **Finished**: the story should move
   from unread to read in the library, and the dashboard's Reading goal should
   advance. Then open a story and **reload the page**, which is the check for
   the `/story/[id]` rewrite from step 4. A 404 here means that rewrite is
   missing.

10. **Books work, including the photo path.** Open the GHMILY book, turn a few
    pages, tap a word. Then add a book from photographs: pick two or three
    images, save, and confirm it appears as pending. Reload and **open a book
    page directly** — the `/book/[id]` rewrite.

11. **Requests work.** File one from the Requests screen, and file one by
    tapping an unknown word while reading. Both should appear in the queue.

12. **Progress works.** Open **Progress** from the dashboard ring: streak
    record, XP total and level, and the ladders. Reload it directly — the
    `/progress` route is a fixed one, so it should just work.

13. **Audio plays.** Tap the speaker on a card — in Review, in Letters, and in
    a gloss sheet. It should play immediately; the clip is a static file in the
    `audio` bucket, so there is nothing to generate and nothing to wait for. If
    there is no speaker button at all, the batch (step 2) has not been run
    against this project.

14. **Install it.** iOS Safari → Share → Add to Home Screen. It should install
    as *Вуковица* with the blue Вук icon and open without browser chrome.

## Redeploying later

```sh
npx supabase db push                          # if migrations changed
node --env-file=.env.hosted scripts/seed.mjs  # if the card files changed
node scripts/generate-audio.mjs --hosted      # if cards were added
mv .env.local .env.local.dev && rm -rf dist && npm run build:web; mv .env.local.dev .env.local
cp -R .vercel dist/.vercel
cd dist && npx vercel deploy --prod --yes && cd ..
```

Always check the grep in step 3 before uploading. Env values baked into the
wrong bundle is the only failure in here that is silent.

---

## Phase 3 deploy checklist

The exact sequence for taking an **existing MVP/phase-2 deployment** to phase 3.
It is the sections above in order, plus the teardown of the AI surface phase 3
removed. Run it from the repo root on `mvp` at the phase 3 commit, with
`.env.hosted` present and the project linked (`npx supabase link` already done
from an earlier deploy).

### 1. Database

```sh
npx supabase migration list
npx supabase db push
```

`migration list` prints exactly what is pending — check it before pushing. Expect
the three phase 3 migrations, plus `20260830140000_stories` if phase 2 was never
pushed to this project (four in that case):

```
20260830140000_stories          the reader's library      (phase 2)
20260830150000_phase3_schema    kind, books, book_pages, requests,
                                grammar_topics/items/stats, xp_events,
                                the book-photos bucket
20260830160000_seed_letters     the 30 letter cards
20260830170000_seed_grammar     12 topics, 203 items
```

### 2. Content

```sh
node --env-file=.env.hosted scripts/seed.mjs
node --env-file=.env.hosted scripts/seed-user-content.mjs <mark's real email>
node scripts/generate-audio.mjs --hosted
```

In that order. The first adds the 43 GHMILY words to the existing deck (`724
word cards` at the end); the second needs the account to exist already, which on
an upgrade it does, so it does **not** wait for step 6.1 this time; the third
speaks whatever has no clip — on a first phase 3 run, all 754 cards.

**On an upgrade, backdate the 43 GHMILY rows after seeding** — the starter deck
already has older `created_at` values, so without this the book's words queue
behind all 681 (the SOURCES order in `seed.mjs` only fixes fresh installs).
With the service key (SQL editor or PostgREST PATCH):

```sql
update public.cards set created_at = (
  select min(created_at) - interval '1 hour' from public.cards where kind = 'word'
) where domain = 'ghmily' and kind = 'word';
```

Piper and ffmpeg must be installed first — [`audio-batch.md`](audio-batch.md),
"Installing the engine". If they are not and you would rather ship without
audio, skip this line: the speaker buttons simply do not appear.

### 3. Tear down the AI surface

Nothing in the phase 3 bundle calls these, so an undeleted function is dead
weight rather than a live risk — but it is dead weight holding a paid API key,
which is worth ten seconds to remove. `functions delete` takes one name at a
time:

```sh
npx supabase functions delete tutor
npx supabase functions delete generate
npx supabase functions delete story
npx supabase functions delete tts
```

Then the secrets they used:

```sh
npx supabase secrets list
npx supabase secrets unset AI_PROVIDER OPENAI_API_KEY ANTHROPIC_API_KEY
```

`secrets list` first, because the project may not have all three — it holds
whichever provider was configured. Unsetting a name that is not there is
harmless, but seeing the list is how you confirm nothing else is lurking.

Leave the `audio` bucket alone. It may hold mp3s the old `tts` function cached
under different keys; they are orphans now (nothing points at them), they cost
nothing, and deleting them is a job for a quiet afternoon, not a deploy.

### 4. Build and deploy

`EXPO_PUBLIC_ALLOW_SIGNUP=false` this time — the account already exists, and the
Create button should not be in the bundle at all:

```sh
# .env
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable key>
EXPO_PUBLIC_ALLOW_SIGNUP=false
```

```sh
mv .env.local .env.local.dev
rm -rf dist
npm run build:web
mv .env.local.dev .env.local

grep -ro '<project-ref>\.supabase\.co' dist/_expo | head -1     # expect a hit
grep -ro '127\.0\.0\.1:54321' dist/_expo | head -1              # expect nothing

cp -R .vercel dist/.vercel
cd dist && npx vercel deploy --prod --yes && cd ..
```

If the export dies part-way, restore `.env.local.dev` before debugging anything
else.

### 5. Live smoke

Against the production domain, in a browser:

| Check | Expect |
| --- | --- |
| `/` | dashboard; **Alphabet** stage; rows for Letters, Grammar, Reader, Books, Deck, Requests |
| `/review` | a word card, with a speaker button |
| `/letters` | the drill: a letter pair, a speaker button, "Show the answer", then "Not yet" / "Got it" |
| `/alphabet` | thirty rows in azbuka order; tap one to hear it |
| `/review?deck=letters` | redirects to `/letters` (the old link, kept working) |
| `/trainer` | a drill |
| `/grammar` | twelve topics |
| `/grammar/to-be` | the explanation, and a drill that starts — and **reload it**, for the rewrite (the least-proven of the three) |
| `/reader` | four stories |
| `/story/<id>` | the story — and **reload it**, for the rewrite |
| `/books` | *Погоди колико те волим* |
| `/book/<id>` | a page — and **reload it**, for the rewrite |
| `/requests` | the queue, and filing one works |
| `/progress` | streak, XP, level, ladders |
| `/deck` | search finds a card in all three scripts |
| `/.env.local` | **404** — nothing from the repo root is served |
| Sign-out screen | **no** Create account button |

Then press a speaker in Review and in Letters and confirm it plays, and check
the browser console is clean on at least the dashboard and a reading view.

Nothing here should ever produce a 502 or an "AI could not be reached" message.
If one appears, a stale bundle is deployed — rebuild with `--clear` (step 4) and
check the greps.
