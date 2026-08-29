# Vukovica

A personal Serbian language-learning app: FSRS flashcards, an AI tutor, a Cyrillic
trainer, and TTS audio. Expo (SDK 54, expo-router) talking directly to Supabase,
shipped as a PWA.

- Spec: `docs/specs/2026-08-29-vukovica-design.md`
- Plan: `docs/plans/2026-08-29-vukovica-mvp.md`

## Requirements

- Node >= 20
- [Supabase CLI](https://supabase.com/docs/guides/local-development) (used via `npx supabase`)
- Docker (for the local Supabase stack)

## Setup

```sh
npm install
cp .env.example .env.local          # fill in EXPO_PUBLIC_SUPABASE_* values
npm run db:start                    # starts local Postgres/Auth/Storage
```

Edge Function secrets (AI keys) go in `supabase/.env.local` — see `.env.example`
for the full list. Both env files are git-ignored.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Expo dev server |
| `npm run web` | Expo dev server, web only |
| `npm test` | vitest (single run) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:start` | Start the local Supabase stack |
| `npm run db:migrate` | Apply migrations to the local database |
| `npm run db:seed` | Seed the card deck (script added in a later task) |
| `npm run functions` | Serve Edge Functions locally |
| `npm run build:web` | Static web export into `dist/` |

## Layout

```
app/          expo-router routes
lib/          shared logic (tests colocated in lib/__tests__/)
supabase/     migrations, edge functions, local config
docs/         spec + implementation plan
```
