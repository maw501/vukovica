/**
 * Hand-written row types mirroring `supabase/migrations/20260829120000_schema.sql`.
 *
 * No codegen dependency in the MVP: if you change the migration, change this
 * file in the same commit. Conventions:
 *   - `timestamptz` is surfaced as an ISO-8601 `string` (what PostgREST returns).
 *   - `bigint` identity columns are surfaced as `number` (JSON numbers; our row
 *     counts stay far below 2^53).
 *   - a column that is nullable in the database is `| null` here, even when it
 *     has a default, because a `select` can legitimately return null for it.
 */

/** `user_cards.state` — the FSRS lifecycle stages. */
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

/** `chat_messages.role`. */
export type ChatRole = 'user' | 'assistant';

/** A row of `public.cards` — the shared deck. */
export interface CardRow {
  id: string;
  sr_cyr: string;
  en: string;
  pos: string;
  gender: string | null;
  aspect: string | null;
  example_cyr: string;
  example_en: string;
  domain: string;
  audio_path: string | null;
  /** null for seed cards; otherwise the user who added the card. */
  created_by: string | null;
  created_at: string | null;
}

/** A row of `public.user_cards` — per-user FSRS scheduling state. */
export interface UserCardRow {
  user_id: string;
  card_id: string;
  due: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: CardState;
  last_review: string | null;
}

/**
 * An insert into `public.review_logs`. Omits the identity `id` and the
 * `reviewed_at` default.
 */
export interface ReviewLogInsert {
  user_id: string;
  card_id: string;
  /** 1 = again, 2 = hard, 3 = good, 4 = easy. */
  grade: number;
  state_before?: CardState | null;
  state_after?: CardState | null;
  elapsed_days?: number | null;
}

/** A row of `public.review_logs`. */
export interface ReviewLogRow {
  id: number;
  user_id: string | null;
  card_id: string | null;
  grade: number | null;
  state_before: string | null;
  state_after: string | null;
  elapsed_days: number | null;
  reviewed_at: string | null;
}

/** A row of `public.chat_messages` — tutor conversation history. */
export interface ChatMessageRow {
  id: number;
  user_id: string | null;
  role: ChatRole | null;
  content: string;
  created_at: string | null;
}

/** A row of `public.drill_stats` — per-letter Cyrillic trainer accuracy. */
export interface DrillStatRow {
  user_id: string;
  letter: string;
  attempts: number | null;
  correct: number | null;
}

/**
 * A row of `public.stories` — the graded reader's library.
 *
 * Mirrors `supabase/migrations/20260830140000_stories.sql`. The `story` Edge
 * Function returns everything here except `user_id` (it is always the caller),
 * i.e. `Omit<StoryRow, 'user_id'>`.
 */
export interface StoryRow {
  id: string;
  user_id: string;
  title_cyr: string;
  body_cyr: string;
  /** 1-3; the difficulty band the story was generated at. */
  level: number;
  word_count: number;
  created_at: string | null;
  /** null = unread. Set when the reader taps "Завршио сам". */
  finished_at: string | null;
}

/** A row of `public.settings` — one per user. */
export interface SettingsRow {
  user_id: string;
  show_latin: boolean | null;
  new_per_day: number | null;
  tts_enabled: boolean | null;
}

/**
 * A row of `public.ai_usage` — observability only. Written by Edge Functions
 * with the service role; authenticated users can read their own rows.
 */
export interface AiUsageRow {
  id: number;
  user_id: string | null;
  /** e.g. 'tutor' | 'generate' | 'tts' — not constrained in the database. */
  surface: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_cents: number | null;
  created_at: string | null;
}
