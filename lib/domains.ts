/**
 * What a `cards.domain` is called on screen.
 *
 * The deck groups its words by subject — `family`, `greetings-courtesy`,
 * `verbs-core` — and those slugs are how the seed file is written and how the
 * rows are stored. They are not what anyone should read: "Read it" lets Mark
 * pick a theme, and a theme is called "Everyday verbs", not `verbs-core`.
 *
 * The map is deliberately *not* the list of themes on offer. New content is
 * written between sessions and lands as rows, so the picker asks the deck which
 * domains actually exist and only comes here to find out what to call them. A
 * domain nobody has named yet still shows up, under a tidied version of its own
 * slug, rather than vanishing from the screen until this file catches up.
 *
 * Pure and dependency-free, like `lib/letters.ts` and `lib/library.ts`.
 */

/**
 * The domains that have a name of their own.
 *
 * The first ten are the starter deck's (`data/seed-deck.json`) plus the book's
 * own vocabulary; the last five are being written now and may have no cards yet
 * — naming them here costs nothing and means they read properly on the day the
 * first one lands.
 */
export const DOMAIN_LABELS: Readonly<Record<string, string>> = {
  family: 'Family',
  baby: 'Baby',
  home: 'Home',
  food: 'Food',
  'greetings-courtesy': 'Greetings and manners',
  'verbs-core': 'Everyday verbs',
  'adjectives-core': 'Describing words',
  'numbers-time': 'Numbers and time',
  'everyday-objects': 'Everyday objects',
  phrases: 'Phrases',
  ghmily: 'Guess How Much I Love You',
  clothes: 'Clothes',
  body: 'Body',
  animals: 'Animals',
  'toddler-talk': 'Talking to a toddler',
  'my-words': 'My words',
};

/**
 * A domain's name, or the best that can be made of the slug itself.
 *
 * The fallback is hyphens to spaces and a capital at the front, which turns
 * `winter-clothes` into "Winter clothes" — imperfect, and never wrong enough to
 * be worth leaving a theme off the screen for.
 */
export function domainLabel(slug: string): string {
  const key = slug.trim();
  if (!key) return '';

  const known = DOMAIN_LABELS[key];
  if (known) return known;

  const words = key.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
