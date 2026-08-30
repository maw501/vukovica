/**
 * Signed-in navigation. A plain stack, not tabs: the dashboard is the hub and
 * every activity is a push off it, which keeps the thumb-reach area free for
 * the grade buttons in a review session.
 */

import { Link, Stack } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { colors, spacing } from '@/lib/theme';

export default function AppLayout() {
  return (
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
          title: 'Вуковица',
          headerRight: () => (
            <Link href="/settings" style={styles.headerLink} testID="header-settings">
              <Text style={styles.headerLinkText}>Settings</Text>
            </Link>
          ),
        }}
      />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="review" options={{ title: 'Учи' }} />
      <Stack.Screen name="deck" options={{ title: 'Шпил' }} />
      <Stack.Screen name="trainer" options={{ title: 'Ћирилица' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  headerLink: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  headerLinkText: { color: colors.primary, fontSize: 16 },
});
