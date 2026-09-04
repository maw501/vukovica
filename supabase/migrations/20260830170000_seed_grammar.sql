-- Seed the grammar section: 12 `grammar_topics` and their 203 `grammar_items`,
-- transcribed from `data/phase3/grammar.json` (see `data/phase3/README.md` for
-- the file's shape, its topic order and its item counts).
--
-- Why a migration rather than `scripts/seed.mjs`: these two tables are the only
-- global, ownerless content in the database -- no `user_id`, readable by every
-- authenticated user, writable only by the service role
-- (20260830150000_phase3_schema.sql). They are part of the app the way the
-- schema is, not part of anybody's deck, so a fresh `supabase db reset` should
-- produce a database whose grammar section works, with no second command to
-- remember. The same argument the letters deck's seed makes
-- (20260830160000_seed_letters.sql), and for the same reason.
--
-- Column mapping is one-to-one with the JSON: slug, title_en, explain_md, sort
-- on the topic; prompt, answer_cyr, note, sort on the item. Nothing is derived
-- and nothing is invented -- the one thing not in the JSON is `topic_id`, which
-- the items insert looks up by slug rather than hard-coding a uuid.
--
-- `accepted_lat` (spec §9) is deliberately absent, from the schema and from
-- here: the drill accepts a Latin-typed answer by transliterating the input
-- before comparing (`checkAnswer` in lib/grammar.ts), which covers every answer
-- in this file without a second column to keep in step.
--
-- Two copies of the same 203 items -- this file and the JSON -- is exactly the
-- arrangement that drifts, and the `do $$` block below only counts. What holds
-- them together value by value is `lib/__tests__/seed-grammar.test.ts`, which
-- parses this file and compares it to the JSON in the second it takes to run
-- the suite. Edit one side without the other and the suite says so.
--
-- Idempotent, like the letters seed: the topics insert takes `on conflict
-- (slug) do nothing`, and the items insert skips any (topic, sort) already
-- present -- `grammar_items` has no unique constraint to hang an `on conflict`
-- off, and adding one for a re-run that never happens in practice would be a
-- constraint written for this file rather than for the data.

insert into public.grammar_topics (slug, title_en, explain_md, sort)
select v.slug, v.title_en, v.explain_md, v.sort
from (values
  ('to-be', 'To be — сам / јесам (present)', 'Serbian has two present-tense forms of *to be*.

The short form does the everyday work: сам, си, је, смо, сте, су. It can never begin a sentence — it sits in second position.

- Ја сам уморан. — I am tired.
- Уморан сам. — I''m tired.
- Ми смо код куће. — We are at home.

The long **stressed** form is for emphasis, for questions and for one-word answers: јесам, јеси, јесте, јесмо, јесте, јесу.

- Јеси ли гладан? — Are you hungry? — Јесам. — I am.
- Је ли он код куће? — Is he at home?

The negative is a word of its own, not не + сам: нисам, ниси, није, нисмо, нисте, нису.

- Нисам гладан. — I''m not hungry.
- Није код куће. — He isn''t at home.', 1),
  ('personal-pronouns', 'Personal pronouns', 'Subject pronouns: ја, ти, он / она / оно, ми, ви, они / оне / она.

Serbian usually **drops** them, because the verb ending already shows the person. Волим те is complete on its own; ја is added only for emphasis or contrast.

- Волим те. — I love you.
- Ја идем, ти остајеш. — *I''m* going, *you''re* staying.

Ви is also the polite singular you, used with your mother-in-law until told otherwise.

Object pronouns have short forms you will hear constantly.

Accusative, the form for the person or thing acted on: ме, те, га, је, нас, вас, их.
- Она ме воли. — She loves me.
- Ми га видимо. — We see him.

Dative, the form for *to* or *for* someone: ми, ти, му, јој, нам, вам, им.
- Дај ми руку. — Give me your hand.
- Помози јој. — Help her.', 2),
  ('imati-present', 'имати — to have (present)', 'имати is regular: имам, имаш, има, имамо, имате, имају.

- Имам сина. — I have a son.
- Имамо кућу у Београду. — We have a house in Belgrade.

The negative fuses into one word: немам, немаш, нема, немамо, немате, немају.

- Немам времена. — I don''t have time.
- Нема телефон. — He doesn''t have a phone.

After a negative, the object often switches to the genitive, the *of* form: немам времена (not време), немамо хлеба.

Two everyday uses to memorise:
- Age: Колико имаш година? — How old are you? Син има годину дана. — Our son is one.
- Existence: Има млека у фрижидеру. — There is milk in the fridge. Нема хлеба. — There''s no bread.', 3),
  ('negation', 'Negation — не + verb', 'For almost every verb, negation is the separate word **не** in front of it.

- Не знам. — I don''t know.
- Не разумем. — I don''t understand.
- Она не долази. — She isn''t coming.

Three verbs break the rule and fuse with не into a single word:

- бити: нисам, ниси, није, нисмо, нисте, нису — Нисам уморан.
- имати: немам, немаш, нема... — Немам времена.
- хтети: нећу, нећеш, неће... — Нећу да идем.

Negative commands use **немој** (to one person) or **немојте** (plural or polite) plus да:

- Немој то да дираш. — Don''t touch that.
- Немојте да бринете. — Don''t worry.

Double negatives are correct here: Никад не спава. — He never sleeps.', 4),
  ('voleti-present', 'волети — to love, to like (present)', 'волети follows the -им pattern: волим, волиш, воли, волимо, волите, воле.

Note the 3rd person plural is **воле**, not волију.

- Волим те. — I love you.
- Волимо ову кућу. — We love this house.
- Деца воле башту. — The children love the garden.

With a following verb, Serbian prefers да + present rather than an infinitive:

- Волим да спавам. — I like to sleep.
- Он воли да чита. — He likes reading.

The short object pronoun (ме, те, га, је, нас, вас, их) comes before the verb in a full sentence: Она ме воли. But after the verb when nothing else precedes: Волим те.

Negation is regular: Не волим зиму. — I don''t like winter.', 5),
  ('hteti-present', 'хтети — to want, and the future (present)', 'хтети has a full form and a short form, and both matter.

Full form — *to want*: хоћу, хоћеш, хоће, хоћемо, хоћете, хоће.
- Хоћу воду. — I want water.
- Хоћеш ли још мало? — Do you want some more?

Short form — the **future tense**: ћу, ћеш, ће, ћемо, ћете, ће, plus the infinitive.
- Ја ћу доћи сутра. — I will come tomorrow.
- Он ће нам помоћи. — He will help us.

Like сам, the short form cannot start a sentence: Доћи ћу сутра, never Ћу доћи.

Negative fuses: нећу, нећеш, неће, нећемо, нећете, неће — and it serves both meanings.
- Нећу. — I don''t want to.
- Нећемо закаснити. — We won''t be late.', 6),
  ('moci-present', 'моћи — can, to be able (present)', 'моћи is irregular, and the 1st person singular and 3rd person plural are the same: могу, можеш, може, можемо, можете, могу.

- Могу да помогнем. — I can help.
- Можеш ли да ми помогнеш? — Can you help me?
- Они могу да чекају. — They can wait.

A second verb follows as да + present, not an infinitive: Не могу да спавам. — I can''t sleep.

Negation is regular and stays a separate word: не могу, не можеш, не може...

- Не могу сада. — I can''t right now.
- Не можеш то. — You can''t do that.

Може on its own is the everyday *okay, that works*: Може? — Може. — Alright? — Alright.', 7),
  ('ici-present', 'ићи — to go (present)', 'The infinitive ићи looks nothing like its present tense: идем, идеш, иде, идемо, идете, иду.

- Идем кући. — I''m going home.
- Куда идеш? — Where are you going?
- Деца иду у вртић. — The children go to nursery.

Direction uses у or на plus the accusative form of the place: у продавницу, у шетњу, на посао, на пијацу. *Home* is the special adverb кући.

Two close relatives to learn with it:
- доћи — to come (arrive): дођем, дођеш, дође... Imperative: Дођи овамо. — Come here.
- долазити — to be coming: Долазим за пет минута. — I''m coming in five minutes.

Let''s go is Хајде да идемо, or simply Идемо.', 8),
  ('videti-znati-present', 'видети and знати (present)', 'Two verbs you need every day, on two different patterns.

**видети** — to see: видим, видиш, види, видимо, видите, виде.
- Видим Месец. — I see the moon.
- Видиш ли реку? — Do you see the river?
- Видимо се сутра. — See you tomorrow (literally: we see each other).

**знати** — to know: знам, знаш, зна, знамо, знате, знају.
- Не знам. — I don''t know.
- Знаш ли где је? — Do you know where he is?
- Он зна српски. — He knows Serbian.

Watch the two plural endings: виде (no -ј-) against знају (with it). Both negate regularly with не.', 9),
  ('jesti-spavati-present', 'јести and спавати (present)', '**јести** — to eat, irregular: једем, једеш, једе, једемо, једете, једу. The infinitive keeps -ст-, the present has -д-.
- Једем доручак. — I''m eating breakfast.
- Шта једеш? — What are you eating?
- Једи, молим те. — Eat, please. (imperative)

**спавати** — to sleep, fully regular: спавам, спаваш, спава, спавамо, спавате, спавају.
- Беба спава. — The baby is asleep.
- Спавај лепо. — Sleep well. (imperative)
- Спава ми се. — I''m sleepy (literally: it sleeps itself to me).

Serbian has one present tense for both *I eat* and *I am eating* — једем covers both.', 10),
  ('simple-questions', 'Simple questions', 'There are two ways to ask a yes-or-no question.

1. **Да ли** at the front of a plain statement: Да ли си гладан? — Are you hungry?
2. **Verb + ли**: Јеси ли гладан? Имаш ли времена? Волиш ли ме?

Both are correct; да ли is easier while you''re starting out, verb + ли is what you''ll hear at home.

Question words come first, and no да ли is needed with them:

- шта — what: Шта радиш?
- ко — who: Ко је то?
- где — where (position): Где су кључеви?
- куда — where to (direction): Куда идеш?
- како — how: Како си?
- зашто — why: Зашто плачеш?
- кад — when: Кад се враћаш?
- колико — how much: Колико кошта?', 11),
  ('possessives', 'Possessives — мој, твој, његов, њен', 'Possessives agree with the **thing owned**, not with the owner. Each has a masculine, feminine and neuter form.

- my: мој, моја, моје
- your (one person): твој, твоја, твоје
- his: његов, његова, његово
- her: њен, њена, њено
- our: наш, наша, наше
- your (plural or polite): ваш, ваша, ваше
- their: њихов, њихова, њихово

So the noun decides the ending:

- мој син — my son, моја жена — my wife, моје дете — my child
- његова мајка — his mother (feminine, because мајка is feminine)
- њен муж — her husband (masculine, because муж is masculine)

English picks the form from the owner; Serbian picks it from the noun that follows.

Plurals end in -и, -е, -а: моји синови, моје ћерке, његове уши.', 12)
) as v (slug, title_en, explain_md, sort)
on conflict (slug) do nothing;

-- The items, grouped by topic and in the order they teach. `sort` is the order
-- the drill asks them in when the whole topic fits in a run, and the order a
-- sampled run is put back into (`pickRun`), so it is the content, not decoration.

insert into public.grammar_items (topic_id, prompt, answer_cyr, note, sort)
select t.id, v.prompt, v.answer_cyr, v.note, v.sort
from (values
  -- to-be
  ('to-be', 'I am at home — ја ___ код куће', 'сам', '1st person singular, short form', 1),
  ('to-be', 'you are tired (to one person) — ти ___ уморан', 'си', '2nd person singular', 2),
  ('to-be', 'he is my son — он ___ мој син', 'је', '3rd person singular', 3),
  ('to-be', 'we are at home — ми ___ код куће', 'смо', '1st person plural', 4),
  ('to-be', 'you are here (plural or polite) — ви ___ овде', 'сте', '2nd person plural, also the polite you', 5),
  ('to-be', 'they are in the garden — они ___ у башти', 'су', '3rd person plural', 6),
  ('to-be', 'I''m hungry (no pronoun) — Гладан ___.', 'сам', 'the short form takes second place in the sentence', 7),
  ('to-be', 'she is a mother — она ___ мајка', 'је', '3rd person singular', 8),
  ('to-be', 'it is cold outside — напољу ___ хладно', 'је', 'impersonal statements use је', 9),
  ('to-be', 'we are a family — ми ___ породица', 'смо', '1st person plural', 10),
  ('to-be', 'Are you hungry? — ___ ли гладна?', 'јеси', 'long form; questions use јесам, јеси, јесте...', 11),
  ('to-be', 'Is he at home? — ___ ли он код куће?', 'је', 'је ли is the everyday 3rd person question form', 12),
  ('to-be', 'yes, I am (the one-word answer) — ___', 'јесам', 'the long form stands alone; сам cannot', 13),
  ('to-be', 'I am not tired — ја ___ уморан', 'нисам', 'negative is one fused word, not не сам', 14),
  ('to-be', 'you are not alone — ти ___ сам', 'ниси', '2nd person singular negative; the сам at the end is the adjective alone, not the verb', 15),
  ('to-be', 'he is not at home — он ___ код куће', 'није', '3rd person singular negative', 16),
  ('to-be', 'we are not hungry — ми ___ гладни', 'нисмо', '1st person plural negative', 17),
  ('to-be', 'they are not here — они ___ овде', 'нису', '3rd person plural negative', 18),
  -- personal-pronouns
  ('personal-pronouns', 'I — ___', 'ја', 'subject pronoun', 1),
  ('personal-pronouns', 'you (one person) — ___', 'ти', 'informal singular', 2),
  ('personal-pronouns', 'he — ___', 'он', 'subject pronoun', 3),
  ('personal-pronouns', 'she — ___', 'она', 'subject pronoun', 4),
  ('personal-pronouns', 'it — ___', 'оно', 'neuter subject pronoun', 5),
  ('personal-pronouns', 'we — ___', 'ми', 'subject pronoun', 6),
  ('personal-pronouns', 'you (plural or polite) — ___', 'ви', 'also the polite singular you', 7),
  ('personal-pronouns', 'they (men, or a mixed group) — ___', 'они', 'masculine plural', 8),
  ('personal-pronouns', 'they (women) — ___', 'оне', 'feminine plural', 9),
  ('personal-pronouns', 'I love you — волим ___', 'те', 'short accusative form of ти', 10),
  ('personal-pronouns', 'she loves me — она ___ воли', 'ме', 'short accusative form of ја', 11),
  ('personal-pronouns', 'we see him — ми ___ видимо', 'га', 'short accusative form of он', 12),
  ('personal-pronouns', 'I see them — ја ___ видим', 'их', 'short accusative form of они', 13),
  ('personal-pronouns', 'he calls us — он ___ зове', 'нас', 'accusative of ми', 14),
  ('personal-pronouns', 'give me your hand — дај ___ руку', 'ми', 'short dative form of ја — same shape as we', 15),
  ('personal-pronouns', 'I''m telling you (one person) — кажем ___', 'ти', 'short dative form of ти', 16),
  ('personal-pronouns', 'help her — помози ___', 'јој', 'short dative form of она', 17),
  ('personal-pronouns', 'I''m bringing him a toy — доносим ___ играчку', 'му', 'short dative form of он', 18),
  -- imati-present
  ('imati-present', 'I have a son — ја ___ сина', 'имам', '1st person singular', 1),
  ('imati-present', 'you have time — ти ___ времена', 'имаш', '2nd person singular', 2),
  ('imati-present', 'he has a brother — он ___ брата', 'има', '3rd person singular', 3),
  ('imati-present', 'she has a daughter — она ___ ћерку', 'има', '3rd person singular', 4),
  ('imati-present', 'we have a house — ми ___ кућу', 'имамо', '1st person plural', 5),
  ('imati-present', 'you (plural) have a car — ви ___ кола', 'имате', '2nd person plural', 6),
  ('imati-present', 'they have children — они ___ децу', 'имају', '3rd person plural', 7),
  ('imati-present', 'the baby has a temperature — беба ___ температуру', 'има', '3rd person singular', 8),
  ('imati-present', 'we have guests today — данас ___ госте', 'имамо', 'the pronoun is dropped; the ending carries it', 9),
  ('imati-present', 'do you have a minute? — ___ ли минут?', 'имаш', 'verb + ли makes a question', 10),
  ('imati-present', 'how old are you? (how many years do you have) — колико година ___?', 'имаш', 'age is expressed with имати', 11),
  ('imati-present', 'I don''t have time — ја ___ времена', 'немам', 'не fuses with имати', 12),
  ('imati-present', 'you don''t have milk — ти ___ млека', 'немаш', 'negative, 2nd person singular', 13),
  ('imati-present', 'he doesn''t have a phone — он ___ телефон', 'нема', 'negative, 3rd person singular', 14),
  ('imati-present', 'she doesn''t have a sister — она ___ сестру', 'нема', 'negative, 3rd person singular', 15),
  ('imati-present', 'we don''t have bread — ми ___ хлеба', 'немамо', 'negative, 1st person plural, genitive object', 16),
  ('imati-present', 'they don''t have a garden — они ___ башту', 'немају', 'negative, 3rd person plural', 17),
  ('imati-present', 'there is no bread — ___ хлеба', 'нема', 'нема also means there is none', 18),
  -- negation
  ('negation', 'I don''t know — ја ___ знам', 'не', 'ordinary verbs keep не separate', 1),
  ('negation', 'I don''t understand — ___ разумем', 'не', 'не goes straight before the verb', 2),
  ('negation', 'she isn''t coming — она ___ долази', 'не', 'ordinary verb, separate не', 3),
  ('negation', 'I don''t sleep well — ___ спавам добро', 'не', 'ordinary verb, separate не', 4),
  ('negation', 'we can''t come — ми ___ можемо да дођемо', 'не', 'моћи keeps не separate', 5),
  ('negation', 'I am not tired — ја ___ уморан', 'нисам', 'бити fuses with не', 6),
  ('negation', 'you are not ready (to one person) — ти ___ спреман', 'ниси', 'бити fuses with не', 7),
  ('negation', 'they are not at home — они ___ код куће', 'нису', 'бити fuses with не', 8),
  ('negation', 'I don''t have money — ја ___ новца', 'немам', 'имати fuses with не, and the object goes genitive after it', 9),
  ('negation', 'he doesn''t have time — он ___ времена', 'нема', 'имати fuses with не', 10),
  ('negation', 'we don''t have children — ми ___ децу', 'немамо', 'имати fuses with не', 11),
  ('negation', 'I don''t want to — ја ___', 'нећу', 'хтети fuses with не', 12),
  ('negation', 'he doesn''t want to eat — он ___ да једе', 'неће', 'хтети fuses with не', 13),
  ('negation', 'she doesn''t want milk — она ___ млеко', 'неће', 'хтети fuses with не', 14),
  ('negation', 'don''t touch that (to one person) — ___ то да дираш', 'немој', 'negative command, singular', 15),
  ('negation', 'don''t worry (plural or polite) — ___ да бринете', 'немојте', 'negative command, plural or polite', 16),
  ('negation', 'there is no milk — ___ млека', 'нема', 'нема means there is none', 17),
  ('negation', 'he never sleeps — никад ___ спава', 'не', 'the double negative is required in Serbian', 18),
  -- voleti-present
  ('voleti-present', 'I love you — ја те ___', 'волим', '1st person singular', 1),
  ('voleti-present', 'you love me — ти ме ___', 'волиш', '2nd person singular', 2),
  ('voleti-present', 'he loves his son — он ___ свог сина', 'воли', '3rd person singular', 3),
  ('voleti-present', 'she loves you — она те ___', 'воли', '3rd person singular', 4),
  ('voleti-present', 'we love this house — ми ___ ову кућу', 'волимо', '1st person plural', 5),
  ('voleti-present', 'you (plural) love coffee — ви ___ кафу', 'волите', '2nd person plural', 6),
  ('voleti-present', 'they love children — они ___ децу', 'воле', '3rd person plural is воле', 7),
  ('voleti-present', 'the children love the garden — деца ___ башту', 'воле', 'деца takes a plural verb', 8),
  ('voleti-present', 'my wife likes tea — моја жена ___ чај', 'воли', '3rd person singular', 9),
  ('voleti-present', 'you love your mum — ти ___ своју маму', 'волиш', '2nd person singular', 10),
  ('voleti-present', 'we love you (one person) — ми те ___', 'волимо', '1st person plural', 11),
  ('voleti-present', 'I love you to the moon — ___ те до Месеца', 'волим', 'the pronoun ја can be dropped', 12),
  ('voleti-present', 'I love you most of all — ___ те највише', 'волим', '1st person singular', 13),
  ('voleti-present', 'I like to sleep — ___ да спавам', 'волим', 'волети plus да plus present, not an infinitive', 14),
  ('voleti-present', 'do you love me? — ___ ли ме?', 'волиш', 'verb plus ли makes a question', 15),
  ('voleti-present', 'I don''t like this — ја ово ___ волим', 'не', 'regular negation with не', 16),
  ('voleti-present', 'they don''t like winter — они ___ воле зиму', 'не', 'regular negation with не', 17),
  ('voleti-present', 'guess how much I love you — погоди колико те ___', 'волим', 'the sentence from the bedtime book', 18),
  -- hteti-present
  ('hteti-present', 'I want water — ја ___ воду', 'хоћу', 'full form, 1st person singular', 1),
  ('hteti-present', 'do you want some more? — ___ ли још мало?', 'хоћеш', 'full form, 2nd person singular', 2),
  ('hteti-present', 'he wants to sleep — он ___ да спава', 'хоће', 'full form, 3rd person singular', 3),
  ('hteti-present', 'we want to go home — ми ___ да идемо кући', 'хоћемо', 'full form, 1st person plural', 4),
  ('hteti-present', 'you (plural) want coffee — ви ___ кафу', 'хоћете', 'full form, 2nd person plural', 5),
  ('hteti-present', 'they want to eat — они ___ да једу', 'хоће', 'full form, 3rd person plural', 6),
  ('hteti-present', 'what do you want for dinner? — шта ___ за вечеру?', 'хоћеш', 'full form, 2nd person singular', 7),
  ('hteti-present', 'I will come tomorrow — ја ___ доћи сутра', 'ћу', 'future short form plus infinitive', 8),
  ('hteti-present', 'you will see — ти ___ видети', 'ћеш', 'future short form, 2nd person singular', 9),
  ('hteti-present', 'he will help us — он ___ нам помоћи', 'ће', 'future short form, 3rd person singular', 10),
  ('hteti-present', 'we will be at home — ми ___ бити код куће', 'ћемо', 'future short form, 1st person plural', 11),
  ('hteti-present', 'you (plural) will see the moon — ви ___ видети Месец', 'ћете', 'future short form, 2nd person plural', 12),
  ('hteti-present', 'they will come on Sunday — они ___ доћи у недељу', 'ће', 'future short form, 3rd person plural', 13),
  ('hteti-present', 'I don''t want to — ја ___', 'нећу', 'не fuses with хтети', 14),
  ('hteti-present', 'she doesn''t want milk — она ___ млеко', 'неће', 'negative, 3rd person singular', 15),
  ('hteti-present', 'the baby won''t sleep — беба ___ да спава', 'неће', 'negative, 3rd person singular', 16),
  ('hteti-present', 'we won''t be late — ми ___ закаснити', 'нећемо', 'negative future, 1st person plural', 17),
  ('hteti-present', 'you won''t forget (to one person) — ти ___ заборавити', 'нећеш', 'negative future, 2nd person singular', 18),
  -- moci-present
  ('moci-present', 'I can help — ја ___ да помогнем', 'могу', '1st person singular', 1),
  ('moci-present', 'can you help me? — ___ ли да ми помогнеш?', 'можеш', '2nd person singular', 2),
  ('moci-present', 'he can come — он ___ да дође', 'може', '3rd person singular', 3),
  ('moci-present', 'she can read — она ___ да чита', 'може', '3rd person singular', 4),
  ('moci-present', 'we can go — ми ___ да идемо', 'можемо', '1st person plural', 5),
  ('moci-present', 'you (plural) can sit down — ви ___ да седнете', 'можете', '2nd person plural', 6),
  ('moci-present', 'they can wait — они ___ да чекају', 'могу', '3rd person plural is also могу', 7),
  ('moci-present', 'I can jump high — ___ да скочим високо', 'могу', 'the pronoun is dropped', 8),
  ('moci-present', 'may I try? — ___ ли да пробам?', 'могу', 'могу ли is how you ask permission', 9),
  ('moci-present', 'can he hear us? — ___ ли да нас чује?', 'може', '3rd person singular question', 10),
  ('moci-present', 'I can''t right now — ја ___ сада', 'не могу', 'не stays a separate word with моћи', 11),
  ('moci-present', 'you can''t do that (to one person) — ти то ___', 'не можеш', 'negative, 2nd person singular', 12),
  ('moci-present', 'we can''t sleep — ми ___ да спавамо', 'не можемо', 'negative, 1st person plural', 13),
  ('moci-present', 'they can''t come today — они данас ___ да дођу', 'не могу', 'negative, 3rd person plural', 14),
  ('moci-present', 'I can''t guess — ___ да погодим', 'не могу', 'the big hare''s line in the bedtime book', 15),
  -- ici-present
  ('ici-present', 'I''m going home — ја ___ кући', 'идем', '1st person singular', 1),
  ('ici-present', 'where are you going? — куда ___?', 'идеш', '2nd person singular', 2),
  ('ici-present', 'he is going to work — он ___ на посао', 'иде', '3rd person singular', 3),
  ('ici-present', 'she is going to bed — она ___ на спавање', 'иде', '3rd person singular', 4),
  ('ici-present', 'we''re going for a walk — ми ___ у шетњу', 'идемо', '1st person plural', 5),
  ('ici-present', 'you (plural) are going to the market — ви ___ на пијацу', 'идете', '2nd person plural', 6),
  ('ici-present', 'they are going into the garden — они ___ у башту', 'иду', '3rd person plural', 7),
  ('ici-present', 'the children go to nursery — деца ___ у вртић', 'иду', 'деца takes a plural verb', 8),
  ('ici-present', 'I''m going to the shop — ___ у продавницу', 'идем', 'the pronoun is dropped', 9),
  ('ici-present', 'let''s go — хајде да ___', 'идемо', 'хајде да plus 1st person plural', 10),
  ('ici-present', 'we go to grandma''s on Sundays — недељом ___ код баке', 'идемо', '1st person plural', 11),
  ('ici-present', 'are you coming with us? — ___ ли са нама?', 'идеш', 'verb plus ли makes a question', 12),
  ('ici-present', 'I''m not going anywhere — ја ___ идем никуда', 'не', 'regular negation, and the double negative is required', 13),
  ('ici-present', 'I''m coming in five minutes — ___ за пет минута', 'долазим', 'долазити, the coming counterpart of ићи', 14),
  ('ici-present', 'come here (to one person) — ___ овамо', 'дођи', 'imperative of доћи', 15),
  -- videti-znati-present
  ('videti-znati-present', 'I see the moon — ја ___ Месец', 'видим', 'видети, 1st person singular', 1),
  ('videti-znati-present', 'do you see the river? — ___ ли реку?', 'видиш', 'видети, 2nd person singular', 2),
  ('videti-znati-present', 'he sees us — он нас ___', 'види', 'видети, 3rd person singular', 3),
  ('videti-znati-present', 'we see the hill — ми ___ брдо', 'видимо', 'видети, 1st person plural', 4),
  ('videti-znati-present', 'they see the tree — они ___ дрво', 'виде', 'видети, 3rd person plural, no -ј-', 5),
  ('videti-znati-present', 'see you tomorrow — ___ се сутра', 'видимо', 'literally we see each other', 6),
  ('videti-znati-present', 'what do you see? — шта ___?', 'видиш', 'видети, 2nd person singular', 7),
  ('videti-znati-present', 'you (plural) see everything — ви ___ све', 'видите', 'видети, 2nd person plural', 8),
  ('videti-znati-present', 'I know — ја ___', 'знам', 'знати, 1st person singular', 9),
  ('videti-znati-present', 'I don''t know — ја ___ знам', 'не', 'regular negation', 10),
  ('videti-znati-present', 'do you know where he is? — ___ ли где је он?', 'знаш', 'знати, 2nd person singular', 11),
  ('videti-znati-present', 'he knows Serbian — он ___ српски', 'зна', 'знати, 3rd person singular', 12),
  ('videti-znati-present', 'she doesn''t know — она ___ зна', 'не', 'regular negation', 13),
  ('videti-znati-present', 'we know that — ми то ___', 'знамо', 'знати, 1st person plural', 14),
  ('videti-znati-present', 'you (plural) know my wife — ви ___ моју жену', 'знате', 'знати, 2nd person plural', 15),
  ('videti-znati-present', 'they know my name — они ___ моје име', 'знају', 'знати, 3rd person plural, with -ј-', 16),
  ('videti-znati-present', 'I know how much you love me — ___ колико ме волиш', 'знам', 'знати, 1st person singular', 17),
  -- jesti-spavati-present
  ('jesti-spavati-present', 'I''m eating breakfast — ја ___ доручак', 'једем', 'јести, 1st person singular', 1),
  ('jesti-spavati-present', 'what are you eating? — шта ___?', 'једеш', 'јести, 2nd person singular', 2),
  ('jesti-spavati-present', 'the baby is eating — беба ___', 'једе', 'јести, 3rd person singular', 3),
  ('jesti-spavati-present', 'we eat at seven — ми ___ у седам', 'једемо', 'јести, 1st person plural', 4),
  ('jesti-spavati-present', 'you (plural) eat a lot — ви ___ много', 'једете', 'јести, 2nd person plural', 5),
  ('jesti-spavati-present', 'they are eating dinner — они ___ вечеру', 'једу', 'јести, 3rd person plural', 6),
  ('jesti-spavati-present', 'I don''t eat meat — ја ___ једем месо', 'не', 'regular negation', 7),
  ('jesti-spavati-present', 'eat, please (to one person) — ___, молим те', 'једи', 'imperative of јести', 8),
  ('jesti-spavati-present', 'I sleep badly — ја ___ лоше', 'спавам', 'спавати, 1st person singular', 9),
  ('jesti-spavati-present', 'are you sleeping? — ___ ли?', 'спаваш', 'спавати, 2nd person singular', 10),
  ('jesti-spavati-present', 'the baby is sleeping — беба ___', 'спава', 'спавати, 3rd person singular', 11),
  ('jesti-spavati-present', 'we sleep late on Sundays — недељом ___ дуго', 'спавамо', 'спавати, 1st person plural', 12),
  ('jesti-spavati-present', 'you (plural) sleep well — ви ___ добро', 'спавате', 'спавати, 2nd person plural', 13),
  ('jesti-spavati-present', 'the children are sleeping — деца ___', 'спавају', 'спавати, 3rd person plural', 14),
  ('jesti-spavati-present', 'sleep well (to one person) — ___ лепо', 'спавај', 'imperative of спавати', 15),
  ('jesti-spavati-present', 'he doesn''t sleep at night — он ноћу ___ спава', 'не', 'regular negation', 16),
  -- simple-questions
  ('simple-questions', 'are you hungry? (with да ли) — ___ си гладан?', 'да ли', 'да ли plus a plain statement', 1),
  ('simple-questions', 'do you love me? (with да ли) — ___ ме волиш?', 'да ли', 'да ли plus a plain statement', 2),
  ('simple-questions', 'is he at home? (verb plus ли) — ___ ли он код куће?', 'је', 'је ли is the everyday form', 3),
  ('simple-questions', 'do you have time? (verb plus ли) — ___ ли времена?', 'имаш', 'verb plus ли', 4),
  ('simple-questions', 'what are you doing? — ___ радиш?', 'шта', 'what', 5),
  ('simple-questions', 'what is this? — ___ је ово?', 'шта', 'what', 6),
  ('simple-questions', 'who is that? — ___ је то?', 'ко', 'who', 7),
  ('simple-questions', 'who is sleeping? — ___ спава?', 'ко', 'who', 8),
  ('simple-questions', 'where are the keys? — ___ су кључеви?', 'где', 'where something is', 9),
  ('simple-questions', 'where do you live? — ___ живиш?', 'где', 'where something is', 10),
  ('simple-questions', 'where are you going? (the direction word, not the position one) — ___ идеш?', 'куда', 'where to, for movement', 11),
  ('simple-questions', 'how are you? — ___ си?', 'како', 'how', 12),
  ('simple-questions', 'why are you crying? — ___ плачеш?', 'зашто', 'why', 13),
  ('simple-questions', 'when are you coming back? (short form) — ___ се враћаш?', 'кад', 'when; кад and када are both correct, the short one is typed here', 14),
  ('simple-questions', 'how much does it cost? — ___ кошта?', 'колико', 'how much', 15),
  ('simple-questions', 'what time is it? — ___ је сати?', 'колико', 'literally how many hours is it', 16),
  -- possessives
  ('possessives', 'my son — ___ син', 'мој', 'син is masculine', 1),
  ('possessives', 'my mother — ___ мајка', 'моја', 'мајка is feminine', 2),
  ('possessives', 'my child — ___ дете', 'моје', 'дете is neuter', 3),
  ('possessives', 'my wife is Serbian — ___ жена је Српкиња', 'моја', 'жена is feminine', 4),
  ('possessives', 'your son (to one person) — ___ син', 'твој', 'син is masculine', 5),
  ('possessives', 'your house (to one person) — ___ кућа', 'твоја', 'кућа is feminine', 6),
  ('possessives', 'his son — ___ син', 'његов', 'his, with a masculine noun', 7),
  ('possessives', 'his mother — ___ мајка', 'његова', 'feminine because мајка is feminine, not because of the owner', 8),
  ('possessives', 'his ears are long — ___ уши су дуге', 'његове', 'уши is feminine plural', 9),
  ('possessives', 'her husband — ___ муж', 'њен', 'her, with a masculine noun', 10),
  ('possessives', 'her daughter — ___ ћерка', 'њена', 'ћерка is feminine', 11),
  ('possessives', 'her name is Ana — ___ име је Ана', 'њено', 'име is neuter', 12),
  ('possessives', 'our son — ___ син', 'наш', 'син is masculine', 13),
  ('possessives', 'our family — ___ породица', 'наша', 'породица is feminine', 14),
  ('possessives', 'your house (to several people) — ___ кућа', 'ваша', 'ваш is the plural or polite your', 15),
  ('possessives', 'their garden — ___ башта', 'њихова', 'башта is feminine', 16)
) as v (slug, prompt, answer_cyr, note, sort)
join public.grammar_topics t on t.slug = v.slug
where not exists (
  select 1
  from public.grammar_items gi
  where gi.topic_id = t.id
    and gi.sort = v.sort
);

-- A partial seed is worse than none: the topic list would look complete and a
-- drill would quietly run short. Counted rather than trusted.
do $$
declare
  v_topics int;
  v_items  int;
begin
  select count(*) into v_topics from public.grammar_topics;
  select count(*) into v_items  from public.grammar_items;
  if v_topics <> 12 then
    raise exception 'seed_grammar: expected 12 topics, found %', v_topics;
  end if;
  if v_items <> 203 then
    raise exception 'seed_grammar: expected 203 items, found %', v_items;
  end if;
end;
$$;
