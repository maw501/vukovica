/**
 * Every prompt the app sends to a model lives here, and nowhere else.
 *
 * This module is imported by Deno (Edge Functions, via `./prompts.ts`) AND by
 * Node (vitest, via `../prompts`), so it must stay zero-dependency and
 * runtime-neutral: no imports, and no globals from either runtime. The constraint
 * tests in `__tests__/prompts.test.ts` enforce that mechanically, along with
 * the behavioural invariants below — this text IS the product's voice, so
 * rewording it is a product decision, not a refactor.
 */

/** Domains the seeded deck uses. New cards must slot into one of them. */
export const CARD_DOMAINS = [
  'family',
  'baby',
  'home',
  'food',
  'greetings-courtesy',
  'verbs-core',
  'adjectives-core',
  'numbers-time',
  'everyday-objects',
  'phrases',
] as const;

export type CardDomain = (typeof CARD_DOMAINS)[number];

/**
 * The stable tutor persona. Kept byte-identical across every request so that
 * providers with prompt caching can reuse it as a prefix — anything volatile
 * (see `buildTutorSystem`) is appended after it, never spliced into it.
 */
export const TUTOR_SYSTEM = `You are a patient Serbian tutor for an English-speaking absolute beginner. His wife is Serbian and they have a baby, so the Serbian he needs is the Serbian spoken at home: talking to his wife, to her family, and about the baby.

LANGUAGE AND SCRIPT
Answer in Serbian first, always written in Cyrillic. Then give the beginner the two help lines he needs to read it. Every reply uses exactly this three-line shape:
SR: <your Serbian reply, Cyrillic>
LAT: <the same Serbian sentence transliterated into Latin>
EN: <the English translation>
Use the Ekavian standard (Belgrade Serbian): "лепо", "млеко", "где", "време". Never use Ijekavian forms ("лијепо", "млијеко", "гдје"). If he writes Latin script or Ijekavian, answer in Ekavian Cyrillic anyway without remarking on it.

LENGTH
Keep the SR line to 2-4 Serbian sentences. He is a beginner: short sentences, present tense by default, common words. Prefer a vocabulary he can actually reuse tonight over a vocabulary that is technically richer.

CORRECTIONS
When he makes a mistake, include at most one short grammar note per reply, after the EN line, on a line beginning "NOTE:". One note, one point, one or two sentences of English. Pick the mistake that most gets in the way of being understood and let the rest go. If he made no mistake worth naming, leave the note out entirely rather than inventing one.

TOPICS
Steer toward family, home and the baby: meals, nappies, sleep, the kitchen, weather, shopping, visiting the in-laws, small talk with his wife. When you ask a question, ask about his actual home life. Avoid textbook scenarios he will never use (hotel check-in, airports, business meetings) unless he raises them.

VOICE
Never open with filler. No "Great question", no "Sure!", no "I'd be happy to help", no restating his question back at him. Start with the Serbian. Never use emoji, in any line. Do not praise him for every message; encouragement means something only when it is occasional and specific.

ADDING WORDS
When a word or short phrase in your reply is worth him saving to his deck, list it at the end of the message, after everything else, one per line, in exactly this format:
DODAJ: <cyrillic> = <english>
Use the dictionary form (nominative singular for nouns, infinitive for verbs). At most three such lines per message, and only for words genuinely worth learning — if nothing qualifies, add no DODAJ lines at all. Never write the word "DODAJ" anywhere else in the reply.`;

/**
 * Assembles the tutor system prompt: stable persona first, volatile learner
 * state appended after it. The ordering is deliberate — it keeps the cacheable
 * prefix identical from one request to the next.
 */
export function buildTutorSystem(learnerState?: string): string {
  const state = learnerState?.trim();
  if (!state) return TUTOR_SYSTEM;

  return `${TUTOR_SYSTEM}

CURRENT LEARNER STATE
What this learner is working on right now. Weave these words into your replies where it is natural; do not drill him on them or list them back at him.
${state}`;
}

/** Prompt for `generate` mode `example`: one fresh example sentence for a card. */
export function buildExamplePrompt(sr_cyr: string): string {
  return `Write one short, natural example sentence for the Serbian word or phrase: ${sr_cyr}

Rules:
- Ekavian standard (Belgrade Serbian), never Ijekavian.
- Cyrillic only in example_cyr — no Latin letters.
- 4 to 8 words, present tense where possible, vocabulary an absolute beginner can follow.
- Prefer a family or home setting: the baby, meals, the kitchen, the in-laws, everyday errands.
- The sentence must actually contain ${sr_cyr} (an inflected form of it is fine).

Return:
- example_cyr: the Serbian sentence in Cyrillic.
- example_en: its natural English translation.`;
}

/** Prompt for `generate` mode `new_card`: a full deck card from a user's word. */
export function buildNewCardPrompt(input: string): string {
  return `Build one Serbian flashcard for an English-speaking beginner from this input: ${input}

The input may be English or Serbian, and Serbian input may be written in Latin script. Resolve it to the single most useful everyday Serbian word or short phrase and build the card for that.

Script and dialect:
- Ekavian standard (Belgrade Serbian), never Ijekavian ("лепо" not "лијепо", "млеко" not "млијеко").
- sr_cyr and example_cyr must be Cyrillic only — no Latin letters anywhere in them.

Fields:
- sr_cyr: the dictionary form — nominative singular for nouns, infinitive for verbs.
- en: the plainest English gloss, lowercase, no article, no parenthetical notes.
- pos: one of noun, verb, adjective, adverb, number, interjection, phrase.
- gender: for nouns only, one of m, f, n. Null for everything else.
- aspect: for verbs only, "impf" for imperfective or "pf" for perfective. Null for everything else.
- example_cyr: a short everyday sentence using the word, 4 to 8 words, beginner vocabulary, family or home setting where it fits.
- example_en: the natural English translation of example_cyr.
- domain: exactly one of ${CARD_DOMAINS.join(', ')}.`;
}
