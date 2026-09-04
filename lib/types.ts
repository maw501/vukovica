/**
 * Hand-written row types mirroring the migrations in `supabase/migrations/`.
 *
 * No codegen dependency in the MVP: if you change a migration, change this
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

/**
 * `cards.kind` — which deck a card belongs to. The two never mix in one review
 * session: the review screen filters on it and the dashboard counts each deck's
 * due cards separately.
 */
export type CardKind = 'word' | 'letter';

/** `books.status` — 'pending' until the pages have text. */
export type BookStatus = 'pending' | 'ready';

/**
 * `books.source` — 'claude' for a Claude-authored rendering seeded before the
 * real pages exist, 'photos' for one built from photographs of the book.
 */
export type BookSource = 'claude' | 'photos';

/** `requests.source` — the quick-add box, or a tap in a reading view. */
export type RequestSource = 'typed' | 'reader';

/** `requests.status` — 'done' once a card answers it. */
export type RequestStatus = 'pending' | 'done';

/** `xp_events.kind` — what earned the XP. */
export type XpKind =
  | 'review'
  | 'drill'
  | 'grammar'
  | 'story'
  | 'book_page'
  | 'book_finish'
  | 'request';

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
  /** A path in the public `audio` bucket, filled by the offline batch script. */
  audio_path: string | null;
  kind: CardKind;
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
 * A row of `public.letter_stats` — the letters drill's per-letter tally.
 *
 * Not to be confused with `DrillStatRow`: that one is the Cyrillic *trainer's*
 * typing accuracy, keyed by a single lowercase glyph. `letter` here is the
 * card's `sr_cyr`, the pair as printed ("Б б"), and the counts are flashcard
 * ratings. Nothing in this row can make a letter unavailable to practise — it
 * only orders a run and marks a letter solid.
 */
export interface LetterStatRow {
  user_id: string;
  letter: string;
  easy: number | null;
  hard: number | null;
  streak: number | null;
  last_seen: string | null;
}

/**
 * A row of `public.stories` — the graded reader's library.
 *
 * Mirrors `supabase/migrations/20260830140000_stories.sql`. Stories are seeded
 * rather than generated, so the app only ever reads these rows and stamps
 * `finished_at`.
 */
export interface StoryRow {
  id: string;
  user_id: string;
  title_cyr: string;
  body_cyr: string;
  /** 1-3; the difficulty band the story was written at. */
  level: number;
  word_count: number;
  created_at: string | null;
  /** null = unread. Set when the reader taps "I have finished this". */
  finished_at: string | null;
}

/**
 * A row of `public.books` — a book Mark is reading with his son.
 *
 * Mirrors `supabase/migrations/20260830150000_phase3_schema.sql`.
 */
export interface BookRow {
  id: string;
  user_id: string;
  title_en: string;
  title_cyr: string | null;
  /** Photographed books start pending, and are transcribed offline. */
  status: BookStatus;
  source: BookSource;
  /** null = unread. Set when the reader taps "Finished". */
  finished_at: string | null;
  created_at: string | null;
}

/** A row of `public.book_pages` — the pages of a book, ordered by `page_no`. */
export interface BookPageRow {
  id: string;
  book_id: string;
  /**
   * Always the owner of `book_id`: a composite foreign key onto
   * `books (id, user_id)` makes the two impossible to disagree.
   */
  user_id: string;
  page_no: number;
  /** null while the book is pending transcription. */
  text_cyr: string | null;
  /** A path in the private `book-photos` bucket; null for a Claude rendering. */
  photo_path: string | null;
  created_at: string | null;
}

/**
 * A row of `public.requests` — the capture queue.
 *
 * Filed from the quick-add box or from a reading view, and fulfilled offline:
 * the answer arrives as a card, with `card_id` pointing at it and `status`
 * flipped to 'done'.
 */
export interface RequestRow {
  id: string;
  user_id: string;
  /** What Mark typed, or the tapped word plus its sentence. */
  text_en: string;
  source: RequestSource;
  status: RequestStatus;
  /** The card that answered the request; null while pending. */
  card_id: string | null;
  note: string | null;
  created_at: string | null;
  done_at: string | null;
}

/**
 * A row of `public.grammar_topics` — global seeded content, no owner.
 * Readable by any authenticated user; written only with the service role.
 */
export interface GrammarTopicRow {
  id: string;
  slug: string;
  title_en: string;
  /** A short English explanation with Serbian examples. */
  explain_md: string;
  sort: number;
}

/** A row of `public.grammar_items` — one drill item. Global content, as above. */
export interface GrammarItemRow {
  id: string;
  topic_id: string;
  prompt: string;
  /**
   * The canonical answer. A Latin-typed answer is accepted by transliterating
   * the input before comparing, so no second accepted-forms column is stored.
   */
  answer_cyr: string;
  note: string | null;
  sort: number;
}

/** A row of `public.grammar_stats` — per-topic accuracy, one row per user. */
export interface GrammarStatRow {
  user_id: string;
  topic_id: string;
  attempts: number;
  correct: number;
  updated_at: string | null;
}

/**
 * A row of `public.xp_events` — the append-only XP ledger. Total, level and
 * today's ring are sums over this table, never stored counters.
 */
export interface XpEventRow {
  id: string;
  user_id: string;
  amount: number;
  kind: XpKind;
  created_at: string | null;
}

/** A row of `public.settings` — one per user. */
export interface SettingsRow {
  user_id: string;
  show_latin: boolean | null;
  new_per_day: number | null;
  tts_enabled: boolean | null;
}

