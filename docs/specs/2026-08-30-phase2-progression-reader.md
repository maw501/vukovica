# Vukovica Phase 2 — Progression Layer + Graded Reader (Design Spec)

**Date:** 2026-08-30
**Status:** Approved by Mark ("just keep building"; direction agreed in chat 30 Aug)
**Builds on:** docs/specs/2026-08-29-vukovica-design.md (MVP, complete on branch `mvp`)

## 1. Purpose

Mark's goal, restated: talk to his wife and son in Serbian; early on, learn Cyrillic and read children's books. The MVP is a flat toolbox with no ordering. Phase 2 adds (a) a **progression layer** that turns the app into a staged path with measurable goals, and (b) the **graded reader** — the feature that directly serves "read children's books".

Chat stays but is demoted: no further investment, lowest position on the dashboard until its stage.

## 2. Progression layer

Four stages, Serbian-named, SOFT (nothing is hard-locked; stages set dashboard emphasis and goals, never block a screen):

1. **Азбука** (alphabet) — goal: master all 30 Cyrillic letters in the trainer. A letter is mastered when lifetime `drill_stats` for it has `attempts >= 8` and `correct/attempts >= 0.9`. Stage complete when all 30 letters mastered.
2. **Речи** (words) — goal ladder: 100 → 300 → 600 known words. A word is "known" = its `user_cards.state` is 'review' (graduated out of learning). Stage complete at 100 known (then Читање becomes primary), but the ladder keeps showing through later stages.
3. **Читање** (reading) — goal ladder: 1 → 5 → 20 stories finished in the reader. Becomes the primary stage once Азбука complete AND known ≥ 100.
4. **Разговор** (conversation) — becomes primary at known ≥ 300 AND stories ≥ 5. Chat is its activity.

Mechanics:
- `lib/stages.ts`: pure function `computeProgress(inputs) -> { stage, letterMastery: {mastered, total, weakest[]}, knownWords, knownMilestone, storiesRead, storyMilestone, nextGoal: string }` where inputs are plain numbers/rows (no I/O). Unit-tested exhaustively.
- `api.getProgress()`: one round trip batch (drill_stats, known-word count, stories-finished count) feeding `computeProgress`.
- Dashboard: leads with current stage name + its single `nextGoal` line + a prominent primary action button (trainer during Азбука, review during Речи, reader during Читање, chat during Разговор). Reviews remain always visible as the daily habit row (due count + streak persist). Other activities listed below in stage order; chat always last until Разговор.
- Trainer screen: shows letters-mastered progress (X/30) and marks mastered letters in the summary.

## 3. Graded reader

### 3.1 Data
- Table `stories`: `id uuid pk default gen_random_uuid()`, `user_id uuid references auth.users`, `title_cyr text not null`, `body_cyr text not null`, `level int not null check (level between 1 and 3)`, `word_count int not null`, `created_at timestamptz default now()`, `finished_at timestamptz` (null = unread). Owner-only RLS, standard grants (incl. explicit anon revoke pattern for any RPC; plain table needs the usual grants).
- No per-word tracking table in v1.

### 3.2 Story generation (Edge Function `story`)
- POST `{ level: 1|2|3, topic?: string }` → `{ title_cyr, body_cyr, word_count }` via `generateObject` + zod on `vuk('chat')` (stories need the better model; they are the product).
- Prompt (in `_shared/prompts.ts`, constraint-tested like the others): children's-story register, EKAVIAN, Cyrillic ONLY, level bands — level 1: 40–80 words, ≤6-word sentences, present tense; level 2: 80–150 words, ≤9-word sentences; level 3: 150–250 words, no constraint on tense. The request includes a sample (≤120 words) of the user's known words with instruction: build the story mostly from these; introduce at most ~10% new vocabulary. Family/home/animals topics by default; optional topic passed through.
- The function inserts the story row itself (service-role client with the caller's user_id from auth) and returns it — one round trip, no client-side insert.
- Auth + CORS + usage logging + error shape identical to existing functions. Invalid-key reality: returns 502; UI surfaces cleanly (same pattern as add-word).

### 3.3 Reading UI (`app/(app)/reader.tsx` + story view)
- Story list: unread and finished sections, level badges, "Нова прича" button (level picker defaulting to current suggestion: level 1 until 300 known, then 2, then 3; topic optional).
- Reading view: body rendered as tappable words (split on whitespace/punctuation, punctuation preserved as non-tappable). Tap a word → gloss sheet:
  1. Exact match against `cards.sr_cyr` (case-insensitive) → show that card (en, example) + "у шпил" if not already in the user's queue-universe (i.e. card exists but that's enough — no user_cards pre-insert, consistent with MVP ruling).
  2. No exact match → POST `generate` with new mode `gloss`: `{ mode:'gloss', word: string, sentence: string }` → `{ base_form_cyr, en, note }` (Haiku). Sheet shows gloss + "у шпил" which runs the existing new_card flow seeded with `base_form_cyr`.
  3. AI unavailable → sheet says gloss needs the AI key; card-match path still works.
- "Завршио сам" (finished) button sets `finished_at`; progress layer counts it. Latin subtitle: NOT shown in the reading view (reading Cyrillic is the point); `show_latin` still governs everywhere else.

## 4. Out of scope (unchanged from MVP spec)
Audio for stories, speaking practice, per-word reading analytics, native build, offline.

## 5. Testing
- `lib/stages.ts` TDD (stage boundaries, mastery edge cases, milestone ladders).
- Word-splitting/tappable-token function TDD (punctuation, hyphens, quotes).
- Prompt constraint tests for the story + gloss prompts (register, Ekavian, Cyrillic-only, level bands present, known-words instruction present).
- Live browser verification per task as in MVP; story/gloss happy paths blocked on the API key — error paths verified live, structure via fixtures (same accepted limitation, documented).

## 6. Success criteria
1. Dashboard leads with the correct stage + goal for the current data, and updates when data changes (verified by seeding states).
2. Trainer shows and updates letter mastery; mastering all letters flips the dashboard to Речи emphasis.
3. Reader: generate (or fixture-insert) a story, read it with tap-glosses (card-match path live), finish it, see it counted in progress.
4. Chat demoted to last position pre-Разговор; no other chat changes.
5. All tests green; migration replays from scratch; README/runbook updated (incl. the new function's deploy line).
