# Vukovica — ship runbook

Taking the app from a clean checkout to a live, installable PWA: a hosted
Supabase project for the data and the AI functions, and a static Vercel
deployment for the web build.

Written for a single-user deployment. Nothing here is automated on purpose —
this runs a handful of times a year, and every step is one command.

**Read `README.md` first** if you have not run the app locally. This document
assumes the local stack already works.

---

## 0. Before you start

You will need:

- A [Supabase](https://supabase.com/dashboard) account, and a project created in
  a region near you (London for Mark). Note its **project ref** — the
  `abcdefghijklmnop` in the dashboard URL — and the database password you set.
- A [Vercel](https://vercel.com) account.
- A working AI API key. `OPENAI_API_KEY` is needed whichever provider you pick,
  because text-to-speech always calls OpenAI.

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

Push the migration chain. There is no separate schema dump — the three
migrations in `supabase/migrations/` are the whole story, and they replay
cleanly from empty (verified).

```sh
npx supabase db push
```

That creates the seven tables with their RLS policies and grants, the
`submit_review` and `bump_drill_stats` RPCs, **and the public `audio` storage
bucket**. You do not need to create the bucket by hand in the dashboard; the
migration inserts it into `storage.buckets`.

Seed the deck. This uses the service-role key, so it bypasses RLS. Point the
seeding half of your env at the hosted project — either edit `.env.local` or,
cleaner, keep a separate file:

```sh
# .env.hosted  (git-ignored by the .env.* rule)
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key from Project Settings -> API Keys>
```

Deliberately not `.env.production.local`: Expo loads that name during a
production build, and this file has no business anywhere near the bundle.

```sh
node --env-file=.env.hosted scripts/seed.mjs
```

Expect `Done. public.cards now holds 681 rows.` The seeder upserts on the unique
Cyrillic form, so re-running it is harmless.

## 2. Supabase: Edge Functions

Set the secrets first, so the functions have their keys the moment they go live:

```sh
npx supabase secrets set AI_PROVIDER=openai
npx supabase secrets set OPENAI_API_KEY=sk-...
# only when AI_PROVIDER=anthropic:
# npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Two things to know:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
  injected into the runtime automatically, and the CLI **refuses** to set any
  name starting with `SUPABASE_`. The functions rely on the injected ones.
- `PUBLIC_SUPABASE_URL` is a local-development-only shim. In production
  `SUPABASE_URL` is already the public URL, so leave it unset.

Then deploy:

```sh
npx supabase functions deploy --no-verify-jwt
```

With no function named, that deploys every directory under
`supabase/functions/` — `tutor`, `generate` and `tts`. `_shared` is skipped;
the CLI ignores directories starting with an underscore.

`--no-verify-jwt` is not optional. The platform's JWT gate would reject the
CORS preflight, which arrives without an `Authorization` header, and the browser
would never get as far as the real request. Each function authenticates the
caller itself with `getUser` (`supabase/functions/_shared/auth.ts`) — that check
is what protects the model spend. `supabase/config.toml` already sets
`verify_jwt = false` per function, so a newer CLI that reads the config will do
the right thing with or without the flag.

Sanity check one of them — an unauthenticated call must be refused:

```sh
curl -s -X POST https://<project-ref>.supabase.co/functions/v1/tts \
  -H 'Content-Type: application/json' -d '{"text":"здраво"}'
# {"error":"unauthorized"}
```

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
npx vercel deploy --prod dist
```

Answer the setup prompts once (scope, project name `vukovica`); Vercel remembers
the link afterwards, so later deploys are the same one-liner.

Vercel resolves `/review` to `review.html` for static deployments, which is what
the export expects. If a deep link ever 404s, write `dist/vercel.json` and
redeploy:

```json
{ "cleanUrls": true, "trailingSlash": false }
```

Note that `dist/` is regenerated by every build, so if you need that file
permanently, put it in `public/` — the contents of `public/` are copied verbatim
into `dist/` on export, which is how `manifest.json` and `icons/` get there.

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
   You should land on the dashboard with `681 cards not yet studied`.

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

5. **Trainer works.** A drill in each direction, one right and one wrong.

6. **Tutor works — and follows its persona.** *This is the one thing that has
   never been checked against a real model.* The prompt invariants in
   `supabase/functions/_shared/prompts.ts` are covered by constraint tests, and
   the streaming, the `DODAJ:` add-to-deck convention and the card insert have
   all been exercised end to end against a mock provider — but no real reply has
   ever been read. So read a few. Ask something in English and something in
   Serbian, and check the reply:

   - Serbian first, in Cyrillic, with Latin and English support lines;
   - short (2–4 sentences), no grammar tables, no "Great question";
   - Ekavian (`лепо`/`млеко`, never `лијепо`/`млијеко`);
   - corrections inline and gentle, at most one grammar note;
   - vocabulary offered as a trailing `DODAJ: реч = word` line, which the app
     turns into a chip.

   If it drifts, the fix belongs in `prompts.ts` with a test, not in the screen.

7. **Add a word from chat.** Tap a `DODAJ` chip, let the AI draft the card, save
   it, and find it in the deck.

8. **Audio plays.** Tap the speaker on a card. First tap generates and caches an
   mp3 in the `audio` bucket; later taps serve the cached file. If the button
   disappears instead, TTS failed — check `OPENAI_API_KEY` and the function
   logs. That degradation is deliberate, not a crash.

9. **Install it.** iOS Safari → Share → Add to Home Screen. It should install as
   *Вуковица* with the blue Вук icon and open without browser chrome.

## Redeploying later

```sh
npx supabase db push                          # if migrations changed
npx supabase functions deploy --no-verify-jwt # if functions changed
mv .env.local .env.local.dev && rm -rf dist && npm run build:web; mv .env.local.dev .env.local
npx vercel deploy --prod dist
```

Always check the grep in step 3 before uploading. Env values baked into the
wrong bundle is the only failure in here that is silent.
