/**
 * My words — the vocabulary Mark has actually built up, as opposed to the
 * catalogue the Deck screen browses.
 *
 * He asked for it in as many words: "ideally there's also a library / vocab list
 * of common words I know which I can build up over time". The Deck lists all 724
 * cards in the app; every row on this screen exists because he studied the word,
 * or said outright that he already knew it.
 *
 * Two sections and one rule (`lib/library.ts`): Known is a word that graduated
 * to `review`, which is the very count the dashboard's Words ladder uses, so the
 * number at the top of this screen and the number in "learn 42 more words" can
 * never disagree. Still learning is everything else with a row.
 *
 * Read-only, deliberately. Editing and deleting a card live on the Deck screen
 * and stay there — this is the shelf, not the workshop.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ScriptText } from '@/components/ScriptText';
import { SpeakButton } from '@/components/SpeakButton';
import { api, type LibraryEntry } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import {
  learnedLabel,
  libraryHeadline,
  sortLibrary,
  splitLibrary,
  type LibrarySort,
} from '@/lib/library';
import { filterCards } from '@/lib/search';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { cyrToLat } from '@/lib/transliterate';

/** Which section is on screen. */
type Section = 'known' | 'learning';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'known', label: 'Known' },
  { key: 'learning', label: 'Still learning' },
];

const SORTS: { key: LibrarySort; label: string }[] = [
  { key: 'recent', label: 'Newest' },
  { key: 'alpha', label: 'A–Z' },
];

/**
 * An entry flattened into the shape `filterCards` searches.
 *
 * Search is the deck's own — Cyrillic, its transliteration, or the English
 * gloss, folded so an English keyboard can find "ћао" by typing "cao" — and
 * reusing it means one definition of what counts as a match rather than two.
 */
type SearchableEntry = LibraryEntry & { sr_cyr: string; en: string };

export default function LibraryScreen() {
  const router = useRouter();

  const library = useQuery({ queryKey: ['library'], queryFn: () => api.getLibrary() });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() });
  const showLatin = settings.data?.show_latin ?? true;
  const ttsEnabled = settings.data?.tts_enabled ?? true;

  const [section, setSection] = useState<Section>('known');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [query, setQuery] = useState('');
  /** The one row expanded to show its example sentence, if any. */
  const [openId, setOpenId] = useState<string | null>(null);

  const entries = useMemo(() => library.data ?? [], [library.data]);
  // Partitioned once: the two counts are the two lengths, so there is no reason
  // to walk the list a second time to find out what it has just been split by.
  const sections = useMemo(() => splitLibrary(entries), [entries]);
  const counts = { known: sections.known.length, learning: sections.learning.length };

  const rows = useMemo(() => {
    const chosen = section === 'known' ? sections.known : sections.learning;
    const searchable: SearchableEntry[] = sortLibrary(chosen, sort).map((entry) => ({
      ...entry,
      sr_cyr: entry.card.sr_cyr,
      en: entry.card.en,
    }));
    return filterCards(searchable, query);
  }, [query, section, sections, sort]);

  if (library.isPending) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (library.isError) {
    return (
      <View style={styles.centred}>
        <Text style={styles.error} testID="library-error">
          {errorMessage(library.error, 'Could not load your words.')}
        </Text>
        <Pressable style={styles.textButton} onPress={() => void library.refetch()}>
          <Text style={styles.textButtonLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  // Nothing studied at all: one sentence and the way to change that, rather
  // than an empty list with a search box over it.
  if (entries.length === 0) {
    return (
      <View style={styles.centred} testID="library-empty">
        <Text style={styles.emptyTitle}>No words yet</Text>
        <Text style={styles.muted}>Words you review land here as you learn them.</Text>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={() => router.push('/review')}
          accessibilityRole="button"
          testID="library-review-link"
        >
          <Text style={styles.primaryButtonText}>Start reviewing</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headline} testID="library-headline">
          {libraryHeadline(counts.known, counts.learning)}
        </Text>

        <View style={styles.tabs}>
          {SECTIONS.map(({ key, label }) => (
            <Pressable
              key={key}
              style={[styles.tab, section === key && styles.tabActive]}
              onPress={() => {
                setSection(key);
                setOpenId(null);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: section === key }}
              testID={`library-tab-${key}`}
            >
              <Text style={[styles.tabLabel, section === key && styles.tabLabelActive]}>
                {label}
                {'  '}
                <Text style={styles.tabCount}>
                  {key === 'known' ? counts.known : counts.learning}
                </Text>
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search Cyrillic, Latin or English"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          testID="library-search"
        />

        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort</Text>
          {SORTS.map(({ key, label }) => (
            <Pressable
              key={key}
              style={[styles.chip, sort === key && styles.chipActive]}
              onPress={() => setSort(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: sort === key }}
              testID={`library-sort-${key}`}
            >
              <Text style={[styles.chipLabel, sort === key && styles.chipLabelActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(entry) => entry.card.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.muted} testID="library-no-match">
            {query
              ? `No words match “${query}”.`
              : section === 'known'
                ? 'Nothing here yet — words move here once you have got them right a few times.'
                : 'Nothing part-learnt right now. Everything you have studied is under Known.'}
          </Text>
        }
        renderItem={({ item }) => (
          <LibraryRow
            entry={item}
            showLatin={showLatin}
            ttsEnabled={ttsEnabled}
            open={openId === item.card.id}
            onToggle={() => setOpenId(openId === item.card.id ? null : item.card.id)}
          />
        )}
      />
    </View>
  );
}

/**
 * One word: the headword, its transliteration and gloss, when it was last
 * practised, and a tap to see the example sentence it was learnt in.
 *
 * The speaker button is a sibling of the tap area rather than a child of it: on
 * web a `Pressable` is a real <button>, and a button inside a button is invalid
 * HTML as well as an ambiguous tap (the same arrangement the review card uses).
 */
function LibraryRow({
  entry,
  showLatin,
  ttsEnabled,
  open,
  onToggle,
}: {
  entry: LibraryEntry;
  showLatin: boolean;
  ttsEnabled: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { card, userCard } = entry;
  const seen = learnedLabel(userCard.last_review);

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Pressable
          style={styles.rowTap}
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${card.sr_cyr}, ${card.en}`}
          testID={`library-row-${card.sr_cyr}`}
        >
          <ScriptText role="cyr" style={styles.rowCyr}>
            {card.sr_cyr}
          </ScriptText>
          {/* Two roles on one line, so two runs rather than one string: the
              transliteration is terracotta and the gloss is muted. */}
          <Text style={styles.rowSub}>
            {showLatin ? (
              <>
                <ScriptText role="lat">{cyrToLat(card.sr_cyr)}</ScriptText>
                {' · '}
              </>
            ) : null}
            <ScriptText role="en">{card.en}</ScriptText>
          </Text>
          {seen ? (
            <Text style={styles.rowMeta} testID={`library-seen-${card.sr_cyr}`}>
              last practised {seen}
            </Text>
          ) : null}
        </Pressable>

        <SpeakButton
          path={card.audio_path}
          enabled={ttsEnabled}
          testID={`library-speak-${card.sr_cyr}`}
        />
      </View>

      {open ? (
        <View style={styles.expanded} testID={`library-example-${card.sr_cyr}`}>
          <ScriptText role="cyr" style={styles.exampleCyr}>
            {card.example_cyr}
          </ScriptText>
          {showLatin ? (
            <ScriptText role="lat" style={styles.exampleLat}>
              {cyrToLat(card.example_cyr)}
            </ScriptText>
          ) : null}
          <ScriptText role="en" style={styles.exampleEn}>
            {card.example_en}
          </ScriptText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  header: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  headline: { fontSize: 15, color: colors.text, fontWeight: '600' },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: {
    flex: 1,
    minHeight: touchTarget - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  tabLabelActive: { color: colors.primaryOn },
  tabCount: { fontWeight: '700' },
  search: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sortLabel: { fontSize: 13, color: colors.textMuted },
  chip: {
    minHeight: touchTarget - 16,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipLabel: { fontSize: 14, color: colors.text },
  chipLabelActive: { color: colors.primaryOn, fontWeight: '600' },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
  },
  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTap: { flex: 1, minHeight: touchTarget - 8, justifyContent: 'center', gap: 2 },
  // Colour and face come from `script`; only size and weight live here.
  rowCyr: { fontSize: 22, fontWeight: '600' },
  rowSub: { fontSize: 13, color: colors.textMuted },
  rowMeta: { fontSize: 12, color: colors.textMuted },
  expanded: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    gap: 2,
  },
  exampleCyr: { fontSize: 17 },
  exampleLat: { fontSize: 13 },
  exampleEn: { fontSize: 13, fontStyle: 'italic' },
  emptyTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  muted: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  primaryButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  primaryButtonText: { color: colors.primaryOn, fontSize: 17, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
