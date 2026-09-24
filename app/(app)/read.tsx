/**
 * The old "Read it" theme picker, kept as a redirect.
 *
 * Picking a set of words now happens once, on Practise, for all three ways of
 * going over them — Read aloud is one of those ways, and `/read/run?theme=` is
 * still where it runs. This route stays so that a bookmark, an installed-PWA
 * shortcut or a link from before the change still lands somewhere sensible.
 */

import { Redirect } from 'expo-router';

export default function ReadScreen() {
  return <Redirect href="/practise" />;
}
