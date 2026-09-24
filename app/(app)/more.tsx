/**
 * More — every screen that is not one of home's three.
 *
 * Home is Letters, Practise and My words, because eleven equal tiles were a
 * screen Mark avoided. Nothing that used to be a tile was removed: it lives
 * here, one line each, with a sentence saying what it is for so a row does not
 * have to be opened to find out.
 */

import { useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';

interface MoreRow {
  key: string;
  label: string;
  /** One plain line under the label. */
  blurb: string;
  href: Href;
}

/**
 * In rough order of how often they are likely to be wanted: the reading
 * screens first, the reference and the records after.
 */
const ROWS: readonly MoreRow[] = [
  {
    key: 'grammar',
    label: 'Grammar',
    blurb: 'Practise the endings of everyday phrases',
    href: '/grammar',
  },
  { key: 'reader', label: 'Reader', blurb: 'Short stories to read in Cyrillic', href: '/reader' },
  { key: 'books', label: 'Books', blurb: 'Read the real books on your shelf', href: '/books' },
  {
    key: 'deck',
    label: 'Deck',
    blurb: 'Every word in the app — edit one, or add one with full detail',
    href: '/deck',
  },
  {
    // The old daily flashcards. Off the everyday path since Practise stopped
    // waiting on a schedule, but not gone: here for when he wants them back.
    key: 'review',
    label: 'Flashcards on a schedule',
    blurb: 'Each word comes back just before you would forget it',
    href: '/review',
  },
  {
    key: 'alphabet',
    label: 'The alphabet',
    blurb: 'All thirty letters, with a word for each',
    href: '/alphabet',
  },
  {
    key: 'letters',
    label: 'Letters',
    blurb: 'Drill the letters with real recordings',
    href: '/letters',
  },
  {
    key: 'requests',
    label: 'Requests',
    blurb: 'The words and phrases you have asked for',
    href: '/requests',
  },
  {
    key: 'progress',
    label: 'Progress',
    blurb: 'Your streak, XP and how far you have come',
    href: '/progress',
  },
];

export default function MoreScreen() {
  const router = useRouter();

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        {ROWS.map((row) => (
          <Pressable
            key={row.key}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}. ${row.blurb}`}
            testID={`more-${row.key}`}
            onPress={() => router.push(row.href)}
          >
            <View style={styles.rowText}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.blurb}>{row.blurb}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: spacing.md },
  content: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    gap: spacing.sm,
  },
  row: {
    minHeight: touchTarget + 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowText: { flexShrink: 1, gap: 2 },
  label: { fontSize: 18, fontWeight: '600', color: colors.text },
  blurb: { fontSize: 13, color: colors.textMuted },
  chevron: { fontSize: 28, color: colors.primary },
  pressed: { opacity: 0.8 },
});
