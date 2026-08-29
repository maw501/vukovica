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
