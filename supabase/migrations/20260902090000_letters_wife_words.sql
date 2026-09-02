-- The letters deck adopts the example words Mark's wife actually recorded.
--
-- `20260830160000_seed_letters.sql` seeded each letter with an example word
-- chosen from this family's own vocabulary (мама, беба, пелена). The audio for
-- those cards is now hers: a native speaker saying the letter's sound and then
-- her own example word, the traditional Serbian primer set every child here
-- learns (А је авион, Б је буба). The recordings are already uploaded and
-- `cards.audio_path` already points at them, so the printed word is the half
-- that is wrong -- a card that shows "беба" while the speaker says "буба"
-- teaches the wrong word twice over.
--
-- This migration brings the text to the audio, all thirty letters. It changes
-- only the three text columns that carry the example word:
--   en          the mnemonic, whose tail is "— <word> (<gloss>)". The phonetic
--               description before the em dash is untouched everywhere; it was
--               language-reviewed and describes the letter, not the word.
--   example_cyr the word alone.
--   example_en  its English gloss, the same parenthetical `en` ends with.
-- `audio_path` is deliberately absent from every `set` below: the clips are
-- hers and already in place, and this is a text correction.
--
-- Х х is a no-op by value: her word for it, хлеб, is the word the seed already
-- carried. It is written out anyway so the file states all thirty of her
-- letters rather than twenty-nine plus a footnote.
--
-- Why an update migration rather than an edit to the seed: the seed is already
-- applied, locally and hosted. Editing it would change nothing on any database
-- that has run it, and `supabase db reset` would then disagree with hosted.
--
-- Idempotent by construction: every statement assigns literals, matched on
-- `sr_cyr` (unique) and `kind = 'letter'`, so running it twice is running it
-- once. `lib/__tests__/seed-letters.test.ts` checks the composition -- seed,
-- then this file -- against `data/phase3/letters.json`, which is where a
-- mistyped pair or a drifted mnemonic gets caught.

update public.cards set
  en = 'a as in father, short and open — авион (aeroplane)',
  example_cyr = 'авион',
  example_en = 'aeroplane'
where sr_cyr = 'А а' and kind = 'letter';

update public.cards set
  en = 'b as in book — буба (bug)',
  example_cyr = 'буба',
  example_en = 'bug'
where sr_cyr = 'Б б' and kind = 'letter';

update public.cards set
  en = 'v as in van — воз (train)',
  example_cyr = 'воз',
  example_en = 'train'
where sr_cyr = 'В в' and kind = 'letter';

update public.cards set
  en = 'g as in go, always hard — грожђе (grapes)',
  example_cyr = 'грожђе',
  example_en = 'grapes'
where sr_cyr = 'Г г' and kind = 'letter';

update public.cards set
  en = 'd as in dog — дугме (button)',
  example_cyr = 'дугме',
  example_en = 'button'
where sr_cyr = 'Д д' and kind = 'letter';

update public.cards set
  en = 'soft j, like the ''d y'' in would you; the voiced partner of Ћ — ђон (sole of a shoe)',
  example_cyr = 'ђон',
  example_en = 'sole of a shoe'
where sr_cyr = 'Ђ ђ' and kind = 'letter';

update public.cards set
  en = 'e as in bed, never a diphthong — ексер (nail)',
  example_cyr = 'ексер',
  example_en = 'nail'
where sr_cyr = 'Е е' and kind = 'letter';

update public.cards set
  en = 'zh, like the s in measure — жаба (frog)',
  example_cyr = 'жаба',
  example_en = 'frog'
where sr_cyr = 'Ж ж' and kind = 'letter';

update public.cards set
  en = 'z as in zoo — змај (dragon, kite)',
  example_cyr = 'змај',
  example_en = 'dragon, kite'
where sr_cyr = 'З з' and kind = 'letter';

update public.cards set
  en = 'ee as in see, short — игла (needle)',
  example_cyr = 'игла',
  example_en = 'needle'
where sr_cyr = 'И и' and kind = 'letter';

update public.cards set
  en = 'y as in yes, never the English j — јеж (hedgehog)',
  example_cyr = 'јеж',
  example_en = 'hedgehog'
where sr_cyr = 'Ј ј' and kind = 'letter';

update public.cards set
  en = 'k as in key, no puff of air — крава (cow)',
  example_cyr = 'крава',
  example_en = 'cow'
where sr_cyr = 'К к' and kind = 'letter';

update public.cards set
  en = 'l as in leaf, light and clear — лабуд (swan)',
  example_cyr = 'лабуд',
  example_en = 'swan'
where sr_cyr = 'Л л' and kind = 'letter';

update public.cards set
  en = 'ly, like the lli in million — љубичица (violet)',
  example_cyr = 'љубичица',
  example_en = 'violet'
where sr_cyr = 'Љ љ' and kind = 'letter';

update public.cards set
  en = 'm as in mum — миш (mouse)',
  example_cyr = 'миш',
  example_en = 'mouse'
where sr_cyr = 'М м' and kind = 'letter';

update public.cards set
  en = 'n as in nose — наочаре (glasses)',
  example_cyr = 'наочаре',
  example_en = 'glasses'
where sr_cyr = 'Н н' and kind = 'letter';

update public.cards set
  en = 'ny, like the ni in onion — њушка (snout)',
  example_cyr = 'њушка',
  example_en = 'snout'
where sr_cyr = 'Њ њ' and kind = 'letter';

update public.cards set
  en = 'o as in more, short and pure — око (eye)',
  example_cyr = 'око',
  example_en = 'eye'
where sr_cyr = 'О о' and kind = 'letter';

update public.cards set
  en = 'p as in pen, no puff of air — потковица (horseshoe)',
  example_cyr = 'потковица',
  example_en = 'horseshoe'
where sr_cyr = 'П п' and kind = 'letter';

update public.cards set
  en = 'rolled r, tapped like the Spanish r; between consonants it becomes the vowel of the syllable, as in прст (finger) — рак (crab)',
  example_cyr = 'рак',
  example_en = 'crab'
where sr_cyr = 'Р р' and kind = 'letter';

update public.cards set
  en = 's as in sun, never a z sound — столица (chair)',
  example_cyr = 'столица',
  example_en = 'chair'
where sr_cyr = 'С с' and kind = 'letter';

update public.cards set
  en = 't as in top, no puff of air — топ (cannon)',
  example_cyr = 'топ',
  example_en = 'cannon'
where sr_cyr = 'Т т' and kind = 'letter';

update public.cards set
  en = 'soft ch, like the ''t y'' in not yet, lighter than Ч — ћурка (turkey)',
  example_cyr = 'ћурка',
  example_en = 'turkey'
where sr_cyr = 'Ћ ћ' and kind = 'letter';

update public.cards set
  en = 'oo as in boot, short — уво (ear)',
  example_cyr = 'уво',
  example_en = 'ear'
where sr_cyr = 'У у' and kind = 'letter';

update public.cards set
  en = 'f as in fish — фока (seal)',
  example_cyr = 'фока',
  example_en = 'seal'
where sr_cyr = 'Ф ф' and kind = 'letter';

update public.cards set
  en = 'h scraped at the back of the throat, like the ch in Scottish loch but much lighter — хлеб (bread)',
  example_cyr = 'хлеб',
  example_en = 'bread'
where sr_cyr = 'Х х' and kind = 'letter';

update public.cards set
  en = 'ts as in cats, never a k sound — црв (worm)',
  example_cyr = 'црв',
  example_en = 'worm'
where sr_cyr = 'Ц ц' and kind = 'letter';

update public.cards set
  en = 'hard ch as in church, tongue drawn back, heavier than Ћ — чекић (hammer)',
  example_cyr = 'чекић',
  example_en = 'hammer'
where sr_cyr = 'Ч ч' and kind = 'letter';

update public.cards set
  en = 'hard j as in judge, the voiced pair of Ч — џеп (pocket)',
  example_cyr = 'џеп',
  example_en = 'pocket'
where sr_cyr = 'Џ џ' and kind = 'letter';

update public.cards set
  en = 'sh as in shop — шапа (paw)',
  example_cyr = 'шапа',
  example_en = 'paw'
where sr_cyr = 'Ш ш' and kind = 'letter';

-- Two things that must still hold. The deck is still the whole azbuka (the seed
-- migration's own guard said thirty; nothing here adds or removes a row, so a
-- count that has drifted means something else did). And every mnemonic still
-- names its own example word -- the pairing this migration exists to restore,
-- so an `en` and an `example_cyr` that disagree is exactly the failure to
-- catch, and it catches it for the three columns together rather than one at a
-- time.
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.cards where kind = 'letter';
  if v_count <> 30 then
    raise exception 'letters_wife_words: expected 30 letter cards, found %', v_count;
  end if;

  select count(*) into v_count
  from public.cards
  where kind = 'letter'
    and en !~ ('— ' || example_cyr || ' \(' || example_en || '\)$');
  if v_count <> 0 then
    raise exception 'letters_wife_words: % letter card(s) whose mnemonic does not end in its own example word and gloss', v_count;
  end if;
end;
$$;
