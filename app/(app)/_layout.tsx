/**
 * Signed-in navigation. A plain stack, not tabs: the dashboard is the hub and
 * every activity is a push off it, which keeps the thumb-reach area free for
 * the grade buttons in a review session.
 */

import { Link, Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StyleSheet, Text } from 'react-native';

import { colors, spacing } from '@/lib/theme';

export default function AppLayout() {
  return (
    <>
      {/*
        The browser tab / installed-app name. It has to come from `Head` rather
        than from `app/+html.tsx`: the static renderer injects react-helmet's
        (empty) title as the first child of <head>, and the first <title> in the
        document is the one the browser uses.
      */}
      <Head>
        <title>Vukovica</title>
      </Head>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text, fontWeight: '600' },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'Vukovica',
            headerRight: () => (
              <Link href="/settings" style={styles.headerLink} testID="header-settings">
                <Text style={styles.headerLinkText}>Settings</Text>
              </Link>
            ),
          }}
        />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="progress" options={{ title: 'Progress' }} />
        <Stack.Screen name="review" options={{ title: 'Review' }} />
        <Stack.Screen name="letters" options={{ title: 'Letters' }} />
        <Stack.Screen name="alphabet" options={{ title: 'The alphabet' }} />
        <Stack.Screen name="deck" options={{ title: 'Deck' }} />
        <Stack.Screen name="library" options={{ title: 'My words' }} />
        <Stack.Screen name="trainer" options={{ title: 'Cyrillic trainer' }} />
        <Stack.Screen name="reader" options={{ title: 'Reader' }} />
        <Stack.Screen name="books" options={{ title: 'Books' }} />
        <Stack.Screen name="requests" options={{ title: 'Requests' }} />
        <Stack.Screen name="grammar" options={{ title: 'Grammar' }} />
        {/* Title is set by the screen itself, to the topic's own name -- which
            names the Serbian verb being conjugated, so it is content too. */}
        <Stack.Screen name="grammar/[slug]" options={{ title: 'Grammar' }} />
        {/* Title is set by the screen itself, to the story's own Cyrillic one --
            that title is the content, not chrome. */}
        <Stack.Screen name="story/[id]" options={{ title: 'Story' }} />
        {/* Title is set by the screen itself, to the book's own Cyrillic one --
            that title is on the cover, so it is content too. */}
        <Stack.Screen name="book/[id]" options={{ title: 'Book' }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  headerLink: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  headerLinkText: { color: colors.primary, fontSize: 16 },
});
