/**
 * The app's small shared design vocabulary.
 *
 * No UI library: plain `StyleSheet` everywhere, with the handful of values that
 * must agree across screens pulled out here. Colours lean on the Serbian
 * tricolour (deep blue, red, white) without being a flag.
 */

export const colors = {
  /** Page background -- warm off-white, easier on the eye than pure white. */
  background: '#FAF8F5',
  surface: '#FFFFFF',
  border: '#E6E0D7',
  text: '#1C1917',
  textMuted: '#78716C',
  /** Primary actions, headings, the Cyrillic wordmark. */
  primary: '#17427A',
  primaryOn: '#FFFFFF',
  /** Streaks, destructive actions, anything that should catch the eye. */
  accent: '#C6363C',
  danger: '#B91C1C',
  disabled: '#D6D3D1',
} as const;

/**
 * The serif stack the Serbian Cyrillic is set in.
 *
 * Georgia first: it has a real Cyrillic range on macOS, iOS, Windows and in
 * every browser that matters, and its large x-height and open counters are what
 * make an unfamiliar script decodable at a glance. The two fallbacks are for the
 * one machine that lacks it. On a native build an unmatched family falls back to
 * the system face, which costs the serif and nothing else — this app is a PWA
 * first, and the web is where the stack resolves.
 */
const SERIF = "Georgia, 'Times New Roman', serif";

/** The default UI face, named rather than implied so the three roles read alike. */
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * Latin transliteration — terracotta.
 *
 * Deliberately neither `primary` (which means "you can tap this") nor
 * `textMuted` (which means "this is the English"). 5.4:1 on `background` and
 * 5.8:1 on `surface`, so it clears AA at every size the app sets it in. It never
 * lands on a dark surface: nothing dark in this app carries content text.
 */
const LATIN = '#A14E2B';

/**
 * The three kinds of text the app shows, each with a colour and a face so it can
 * be told from the other two without reading a word of it.
 *
 * Cyrillic is the star: the main text colour, set in a serif — this is a
 * children's-book reading app, and it should look like one. Latin is the crutch;
 * English is the supporting matter.
 *
 * `lat` is the one role with an end date. The plan is an all-Cyrillic app once
 * the alphabet is solid, and when that day comes this is the token to delete:
 * every transliteration in the app is styled through it and nowhere else, so
 * `grep script.lat` is the complete list of what has to go.
 */
export const script = {
  cyr: { color: colors.text, fontFamily: SERIF },
  lat: { color: LATIN, fontFamily: SANS },
  en: { color: colors.textMuted, fontFamily: SANS },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
} as const;

/**
 * Minimum height for anything tappable. 52pt clears the ~44pt platform floor
 * with room to spare -- this is a one-hand, thumb-driven app.
 */
export const touchTarget = 52;

/** Widest the content column ever gets, so the PWA is not unreadable on a laptop. */
export const contentMaxWidth = 520;
