# `data/phase3/` — Phase 3 seed content

Hand-authored Serbian learning content for the Phase 3 revamp
(`docs/specs/2026-08-30-phase3-revamp.md` §4, §6, §8, §9). Every file is strict
JSON, UTF-8, no trailing commas, no comments. Task 8 (seeding) codes against the
shapes below.

## Conventions that hold across every file

- **Serbian is Cyrillic only.** Fields named `*_cyr` (plus `example_cyr`,
  `answer_cyr`, `sr_cyr`, `body_cyr`, `title_cyr`, `text_cyr`) contain nothing
  but the 30 Serbian Cyrillic letters (upper/lower), spaces, and the
  punctuation `. , ! ? ' -`. No Latin letters, no digits, no Russian-only
  letters, no guillemets or curly quotes — the same character set the existing
  `lib/__tests__/seed-deck.test.ts` enforces on `data/seed-deck.json`.
- Every Serbian string round-trips: `latToCyr(cyrToLat(x)) === x`.
- **Ekavian throughout** (лепо, млеко, где, Месец — never лијепо, млијеко, гдје).
- English fields (`en`, `example_en`, `title_en`, `explain_md`, `note`,
  `prompt`) are prose and *may* contain Cyrillic where the content demands it
  (a mnemonic's example word, a grammar prompt's Serbian half, a topic title
  naming a Serbian verb). They are the only fields where the two scripts mix.
- Register: family/home, present tense, beginner, the voice a dad uses with a
  wife and a toddler.

Counts: `letters.json` 30, `ghmily-vocab.json` 43, `ghmily-book.json` 16 pages,
`stories.json` 4, `grammar.json` 12 topics / 203 items.

---

## `letters.json`

`Array<Letter>` — 30 entries, one per azbuka letter, in azbuka order. Index `i`
holds the letter at position `i + 1`; `sort` equals that position.

```jsonc
{
  "cyr_pair":    string, // "Б б" — capital, single space, lowercase
  "lat_pair":    string, // "B b" — exactly cyrToLat(cyr_pair); digraphs are "Lj lj", "Nj nj", "Dž dž"
  "en":          string, // sound description + example word + its English meaning
  "example_cyr": string, // the example word alone, Cyrillic (also appears inside `en`)
  "sort":        number  // 1..30, azbuka order
}
```

Example (entry 2):

```json
{
  "cyr_pair": "Б б",
  "lat_pair": "B b",
  "en": "b as in book — беба (baby)",
  "example_cyr": "беба",
  "sort": 2
}
```

Seeding notes: these become `cards` rows with `kind = 'letter'`, `sr_cyr =
cyr_pair`, `en = en`. `sr_lat` is derived at render time (`cyrToLat`), so
`lat_pair` is provided only as a cross-check. The example word is what the
audio batch should speak after the letter itself.

---

## `ghmily-vocab.json`

`Array<Card>` — 43 entries. **Shape is identical to `data/seed-deck.json`**, so
the existing card insert path works unchanged; every column that is `not null`
in `public.cards` is present.

```jsonc
{
  "sr_cyr":      string,          // headword, Cyrillic only, unique
  "en":          string,          // English gloss, no Cyrillic
  "pos":         string,          // noun | verb | adjective | adverb | pronoun | preposition | conjunction | number | phrase | interjection
  "gender":      "m"|"f"|"n"|null,// set for nouns, null otherwise
  "aspect":      "pf"|"impf"|null,// set for verbs, null otherwise
  "example_cyr": string,          // <= 10 words, ends in . ! or ?
  "example_en":  string,          // translation of example_cyr, no Cyrillic
  "domain":      "ghmily"         // constant for this file
}
```

Example:

```json
{
  "sr_cyr": "зец",
  "en": "hare; rabbit",
  "pos": "noun",
  "gender": "m",
  "aspect": null,
  "example_cyr": "Мали зец седи у трави.",
  "example_en": "The little hare is sitting in the grass.",
  "domain": "ghmily"
}
```

Seeding notes: `cards.sr_cyr` is `unique`, and none of these 43 headwords
collides with the 681 in `data/seed-deck.json` (checked). Note `Месец` (the
moon, capitalised — Serbian orthography for the celestial body) is deliberately
distinct from the deck's `месец` (month). Contains 6 `pos: "phrase"` full
sentences, including the book's two load-bearing lines.

---

## `ghmily-book.json`

A single object — Claude's own Serbian rendering of *Guess How Much I Love
You*, for private study. Not the published translation.

```jsonc
{
  "title_cyr": string,   // "Погоди колико те волим"
  "title_en":  string,   // "Guess How Much I Love You (Claude's rendering)"
  "pages": [
    {
      "page_no":  number, // 1-based, contiguous, matches array index + 1
      "text_cyr": string  // 1-3 short sentences, Cyrillic only
    }
  ]
}
```

Example:

```json
{
  "title_cyr": "Погоди колико те волим",
  "title_en": "Guess How Much I Love You (Claude's rendering)",
  "pages": [
    { "page_no": 1, "text_cyr": "Вече је. Мали зец се спрема за спавање. Држи великог зеца за дуге уши." }
  ]
}
```

Seeding notes: one `books` row (`source = 'claude'`, `status = 'ready'`,
`title_cyr`, `title_en`) plus 16 `book_pages` rows (`photo_path` null). Spec §6
asks the UI to label a `'claude'`-source book "Claude's rendering — photograph
your copy for the real text"; that label is UI copy, not stored here (the
`books` table has no column for it), and `title_en` already carries the
parenthetical.

---

## `stories.json`

`Array<Story>` — 4 warm-up stories built from the GHMILY vocabulary plus basic
family words.

```jsonc
{
  "title_cyr":  string, // Cyrillic only
  "body_cyr":   string, // one string, sentences separated by a single space
  "level":      1,      // all four are level 1 (stories.level check is 1..3)
  "word_count": number  // exactly body_cyr.split(/\s+/).filter(Boolean).length
}
```

Example:

```json
{
  "title_cyr": "Преко реке",
  "body_cyr": "Мали зец трчи низ стазу. Стаза иде до реке. ...",
  "level": 1,
  "word_count": 53
}
```

Guarantees: 40–80 words per story (actual: 53 / 50 / 53 / 49), every sentence
6 words or fewer, present tense throughout. `word_count` has been verified
against the body — seed it as given rather than recomputing, or recompute with
that exact split; both agree.

Seeding notes: `stories` rows need a `user_id` (owner-only RLS); these are
global content, so the seed assigns them to the target user like the existing
fixture stories.

---

## `grammar.json`

`Array<Topic>` — 12 topics in teaching order; `sort` equals array index + 1.

```jsonc
{
  "slug":       string, // lowercase, a-z 0-9 and hyphens, unique
  "title_en":   string, // English topic name; may name the Serbian verb in Cyrillic
  "explain_md": string, // Markdown, <= 150 words, English explanation with Serbian examples
  "sort":       number, // 1..12
  "items": [
    {
      "prompt":     string, // English cue + Serbian frame with a "___" blank
      "answer_cyr": string, // ONLY what fills the blank; Cyrillic only; 1-2 words
      "note":       string, // short English hint shown on a miss (never null in this file)
      "sort":       number  // 1..n within the topic
    }
  ]
}
```

Example:

```json
{
  "slug": "voleti-present",
  "title_en": "волети — to love, to like (present)",
  "explain_md": "волети follows the -им pattern: волим, волиш, воли...",
  "sort": 5,
  "items": [
    { "prompt": "I love you — ја те ___", "answer_cyr": "волим", "note": "1st person singular", "sort": 1 }
  ]
}
```

Topic order (`slug` — items):

| # | slug | items |
| --- | --- | --- |
| 1 | `to-be` | 18 |
| 2 | `personal-pronouns` | 18 |
| 3 | `imati-present` | 18 |
| 4 | `negation` | 18 |
| 5 | `voleti-present` | 18 |
| 6 | `hteti-present` | 18 |
| 7 | `moci-present` | 15 |
| 8 | `ici-present` | 15 |
| 9 | `videti-znati-present` | 17 |
| 10 | `jesti-spavati-present` | 16 |
| 11 | `simple-questions` | 16 |
| 12 | `possessives` | 16 |

Seeding + UI notes:

- `explain_md` uses only paragraphs, bullet lists, numbered lists (`1. `, in
  `simple-questions` alone) and `**bold**` — no tables, no headings, no links.
  `lib/grammar.ts`'s `explainBlocks` renders all four; a plain-text renderer
  degrades acceptably.
- Every `prompt` contains the literal three-underscore blank `___`; the UI can
  split on it to render an inline input.
- `answer_cyr` is the blank's content only, so exact-match checking works:
  `input === answer_cyr || latToCyr(input) === answer_cyr` (case-insensitive
  comparison recommended — every answer here is lowercase). Two-word answers
  occur only in `moci-present` (`не могу`, `не можеш`, `не можемо`) and
  `simple-questions` (`да ли`); a checker should collapse internal whitespace.
- `grammar_items.accepted_lat` (spec §9) is not populated here — the
  transliteration check above covers Latin input without extra data.
