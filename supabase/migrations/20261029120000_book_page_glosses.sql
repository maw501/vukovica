-- Per-page word glosses for photographed books.
--
-- A tap on a word used to find a card only when the tapped form exactly equalled
-- a card's `sr_cyr`. The deck holds the plain dictionary forms (смеђ, волети,
-- зец) and a real book uses the forms a sentence needs (смеђег, волим, зеца), so
-- most of «Погоди колико те волим» came back "not in your deck". Worse, some
-- exact matches were wrong in context: "му" (to him) found "му — moo".
--
-- The answer is written offline by Claude, per page, with the sentence in view:
-- what each word means *here*, and which deck card it comes from. Stored on the
-- page because that is the unit that is transcribed, and a word's meaning
-- belongs to the text it sits in.
--
-- Nullable with no default: a page without glosses (the Claude rendering, any
-- page not yet glossed) reads exactly as before. No policy change: the existing
-- owner-only row policies on `book_pages` already cover a new column.

alter table public.book_pages add column glosses jsonb;

comment on column public.book_pages.glosses is
  'Per-page word meanings, written offline. An object keyed by the tapped word lowercased '
  '(hyphenated forms kept whole) -> {"en": string, "base"?: string}. "en" is what the word '
  'means in this sentence; "base" is the sr_cyr of the deck card it comes from, omitted when '
  'there is none. null = no glosses for this page.';
