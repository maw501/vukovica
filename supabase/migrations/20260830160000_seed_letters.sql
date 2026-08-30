-- Seed the letters deck: 30 `cards` rows with `kind = 'letter'`, one per azbuka
-- letter, transcribed from `data/phase3/letters.json` (see
-- `data/phase3/README.md` for the file's shape and its seeding notes).
--
-- Why a migration rather than `scripts/seed.mjs`: the letters are not a deck the
-- user curates, they are the alphabet. They ship with the schema that gave
-- `cards` its `kind` column (20260830150000_phase3_schema.sql), so a fresh
-- `supabase db reset` produces a database the letters deck already works in,
-- with no second command to remember. The word deck stays with the seed script,
-- which is where 681 rows and a `--env-file` service key belong.
--
-- Column mapping (`data/phase3/README.md`, "Seeding notes"):
--   sr_cyr      <- cyr_pair, the pair as printed ("Б б"). `cards.sr_cyr` is
--                  unique; a pair contains a space, so it can never collide with
--                  a headword in the word deck.
--   en          <- en, the mnemonic: sound description + example word + gloss.
--   example_cyr <- example_cyr, the example word on its own.
--   kind        <- 'letter'.
--
-- The README documents no mapping for the three remaining `not null` columns,
-- because a letter is not a word and has nothing natural to put in them. What
-- they get, and why:
--   pos         'letter'   -- the part of speech a letter card *is*. The review
--                             screen's letter layout never renders it, but the
--                             column is `not null` and a lie ('noun') would show
--                             up the moment anything queried by `pos`.
--   example_en  the English gloss of the example word, i.e. the parenthetical
--               already inside `en` ("беба (baby)" -> "baby"). Nothing else in
--               the row carries it, and the audio batch script (spec §5) speaks
--               the example word after the letter.
--   domain      'alphabet' -- distinct from every domain in the word deck
--               (family, baby, home, food, greetings-courtesy, verbs-core,
--               adjectives-core, numbers-time, everyday-objects, phrases), so
--               "the letters" stays expressible as a domain as well as a kind.
--
-- `sr_lat` is NOT a column and is not stored: `cards` has never had one, and the
-- README is explicit that the Latin pair is derived at render time with
-- `cyrToLat` (`lat_pair` in the JSON is a cross-check, not data). The review
-- screen derives it, and the digraphs come out right -- "Љ љ" -> "Lj lj".
--
-- `created_at` is stamped one second apart in azbuka order, which is load-bearing
-- rather than decorative: `api.fetchNewCards` introduces new cards in
-- `created_by`, then `created_at`, then `id` order, and every row here shares the
-- first (null). Without distinct timestamps the tie would break on a random uuid
-- and the alphabet would arrive shuffled -- А, Б, В is the whole point of a deck
-- whose cards are letters.
--
-- Idempotent: `on conflict (sr_cyr) do nothing`, the same contract as
-- `scripts/seed.mjs`, so re-running adds nothing and overwrites nothing.

insert into public.cards
  (sr_cyr, en, pos, gender, aspect, example_cyr, example_en, domain, kind, created_at)
select
  v.sr_cyr,
  v.en,
  'letter',
  null,
  null,
  v.example_cyr,
  v.example_en,
  'alphabet',
  'letter',
  timestamptz '2026-08-30 00:00:00+00' + make_interval(secs => v.sort)
from (values
  ('А а', 'a as in father, short and open — мама (mum)', 'мама', 'mum', 1),
  ('Б б', 'b as in book — беба (baby)', 'беба', 'baby', 2),
  ('В в', 'v as in van — вода (water)', 'вода', 'water', 3),
  ('Г г', 'g as in go, always hard — година (year)', 'година', 'year', 4),
  ('Д д', 'd as in dog — дете (child)', 'дете', 'child', 5),
  ('Ђ ђ', 'soft j, like the ''d y'' in would you; the voiced partner of Ћ — ђубре (rubbish)', 'ђубре', 'rubbish', 6),
  ('Е е', 'e as in bed, never a diphthong — вече (evening)', 'вече', 'evening', 7),
  ('Ж ж', 'zh, like the s in measure — жена (wife, woman)', 'жена', 'wife, woman', 8),
  ('З з', 'z as in zoo — зима (winter)', 'зима', 'winter', 9),
  ('И и', 'ee as in see, short — име (name)', 'име', 'name', 10),
  ('Ј ј', 'y as in yes, never the English j — јаје (egg)', 'јаје', 'egg', 11),
  ('К к', 'k as in key, no puff of air — кућа (house)', 'кућа', 'house', 12),
  ('Л л', 'l as in leaf, light and clear — лето (summer)', 'лето', 'summer', 13),
  ('Љ љ', 'ly, like the lli in million — љут (angry)', 'љут', 'angry', 14),
  ('М м', 'm as in mum — млеко (milk)', 'млеко', 'milk', 15),
  ('Н н', 'n as in nose — нож (knife)', 'нож', 'knife', 16),
  ('Њ њ', 'ny, like the ni in onion — књига (book)', 'књига', 'book', 17),
  ('О о', 'o as in more, short and pure — отац (father)', 'отац', 'father', 18),
  ('П п', 'p as in pen, no puff of air — пелена (nappy)', 'пелена', 'nappy', 19),
  ('Р р', 'rolled r, tapped like the Spanish r; between consonants it becomes the vowel of the syllable, as in прст (finger) — риба (fish)', 'риба', 'fish', 20),
  ('С с', 's as in sun, never a z sound — син (son)', 'син', 'son', 21),
  ('Т т', 't as in top, no puff of air — тата (dad)', 'тата', 'dad', 22),
  ('Ћ ћ', 'soft ch, like the ''t y'' in not yet, lighter than Ч — ћерка (daughter)', 'ћерка', 'daughter', 23),
  ('У у', 'oo as in boot, short — ујак (uncle)', 'ујак', 'uncle', 24),
  ('Ф ф', 'f as in fish — флашица (baby bottle)', 'флашица', 'baby bottle', 25),
  ('Х х', 'h scraped at the back of the throat, like the ch in Scottish loch but much lighter — хлеб (bread)', 'хлеб', 'bread', 26),
  ('Ц ц', 'ts as in cats, never a k sound — црвен (red)', 'црвен', 'red', 27),
  ('Ч ч', 'hard ch as in church, tongue drawn back, heavier than Ћ — чај (tea)', 'чај', 'tea', 28),
  ('Џ џ', 'hard j as in judge, the voiced pair of Ч — џем (jam)', 'џем', 'jam', 29),
  ('Ш ш', 'sh as in shop — шећер (sugar)', 'шећер', 'sugar', 30)
) as v (sr_cyr, en, example_cyr, example_en, sort)
on conflict (sr_cyr) do nothing;

-- The azbuka has exactly thirty letters, and a deck missing one is a gap the UI
-- cannot show. A transcription slip -- a duplicated pair silently swallowed by
-- the `on conflict`, or a row lost to a stray comma -- would otherwise only turn
-- up weeks later as a letter that never came round. Fail the migration instead.
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.cards where kind = 'letter';
  if v_count <> 30 then
    raise exception 'seed_letters: expected 30 letter cards, found %', v_count;
  end if;
end;
$$;
