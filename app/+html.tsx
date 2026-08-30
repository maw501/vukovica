/**
 * The HTML shell every statically-exported web page is rendered into.
 *
 * Expo's default shell has an empty `<title>` and no PWA metadata at all, which
 * is fine for a demo and not fine for something installed on a home screen. The
 * head below is what makes `dist/` installable: a manifest, an iOS home-screen
 * icon (Safari ignores the manifest's icons), and a theme colour matching
 * `lib/theme.ts` so the browser chrome does not clash with the app.
 *
 * This file runs in Node during `expo export`, never in the browser, so it must
 * not import anything from `lib/` that touches react-native or Supabase — the
 * two colours below are duplicated from `lib/theme.ts` deliberately.
 */

import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/** `colors.primary` — browser chrome, splash and manifest theme. */
const THEME_COLOR = '#17427A';
/** `colors.background` — the warm off-white behind everything. */
const BACKGROUND_COLOR = '#FAF8F5';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en-GB">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover so the safe-area insets the app already handles are real. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />

        {/*
          No <title> here on purpose. The static renderer injects react-helmet's
          title as the *first* child of <head>, and the first title in the
          document wins — so a title written here would be dead markup and an
          invalid duplicate. It is set with `Head` instead; see
          app/(app)/_layout.tsx.
        */}
        <meta
          name="description"
          content="Serbian for the family: Cyrillic-first flashcards, a script trainer and stories to read."
        />
        <meta name="theme-color" content={THEME_COLOR} />

        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
        {/* Safari does not read the manifest; without this iOS installs a screenshot. */}
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Vukovica" />

        {/* Expo: keeps the body from scrolling so the app's own scroll views own it. */}
        <ScrollViewStyleReset />

        {/* Painted before the bundle boots, so a cold start is not a white flash. */}
        <style dangerouslySetInnerHTML={{ __html: BODY_BACKGROUND }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const BODY_BACKGROUND = `body { background-color: ${BACKGROUND_COLOR}; }`;
