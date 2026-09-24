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
 * Editing and deleting a card live on the Deck screen and stay there — this is
 * the shelf, not the workshop. What this screen does add to the shelf is the
 * two fast ways on: "Add a word" for one his wife just said, and "Tick words you
 * know" (`library/tick.tsx`) for the deck he already half knows by ear. It also
 * carries the words he has asked for and not yet been given (`requests`), so
 * the capture queue lives here in practice rather than as a screen of its own
 * on home.
 */

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { MixedText, ScriptText } from "@/components/ScriptText";
import { SpeakButton } from "@/components/SpeakButton";
import { api, type LibraryEntry, type RequestEntry } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import {
  learnedLabel,
  libraryHeadline,
  sortLibrary,
  splitLibrary,
  type LibrarySort,
} from "@/lib/library";
import { pendingRequests } from "@/lib/requests";
import { filterCards } from "@/lib/search";
import {
  colors,
  contentMaxWidth,
  radius,
  spacing,
  touchTarget,
} from "@/lib/theme";
import { cyrToLat } from "@/lib/transliterate";

/** Which section is on screen. */
type Section = "known" | "learning";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "known", label: "Known" },
  { key: "learning", label: "Still learning" },
];

const SORTS: { key: LibrarySort; label: string }[] = [
  { key: "recent", label: "Newest" },
  { key: "alpha", label: "A–Z" },
];

/** How many unanswered requests the "Asked for" list shows before "See all". */
const ASKED_FOR_LIMIT = 5;

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

  const library = useQuery({
    queryKey: ["library"],
    queryFn: () => api.getLibrary(),
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.getSettings(),
  });
  // The capture queue, for "Asked for". The same `['requests']` list the
  // Requests screen shows, so opening that from here costs no round trip.
  const requests = useQuery({
    queryKey: ["requests"],
    queryFn: () => api.listRequests(),
  });
  const showLatin = settings.data?.show_latin ?? true;
  const ttsEnabled = settings.data?.tts_enabled ?? true;

  const [section, setSection] = useState<Section>("known");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [query, setQuery] = useState("");
  /** The one row expanded to show its example sentence, if any. */
  const [openId, setOpenId] = useState<string | null>(null);
  /**
   * Set when he asks to see the words he is still learning from the
   * nothing-known-yet screen, which otherwise stands in for the list.
   */
  const [listAnyway, setListAnyway] = useState(false);

  const entries = useMemo(() => library.data ?? [], [library.data]);
  // Partitioned once: the two counts are the two lengths, so there is no reason
  // to walk the list a second time to find out what it has just been split by.
  const sections = useMemo(() => splitLibrary(entries), [entries]);
  const counts = {
    known: sections.known.length,
    learning: sections.learning.length,
  };

  const rows = useMemo(() => {
    const chosen = section === "known" ? sections.known : sections.learning;
    const searchable: SearchableEntry[] = sortLibrary(chosen, sort).map(
      (entry) => ({
        ...entry,
        sr_cyr: entry.card.sr_cyr,
        en: entry.card.en,
      }),
    );
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
          {errorMessage(library.error, "Could not load your words.")}
        </Text>
        <Pressable
          style={styles.textButton}
          onPress={() => void library.refetch()}
        >
          <Text style={styles.textButtonLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  // Nothing known — which is where Mark starts. The first job is ticking the
  // words he already knows, so that leads; adding one is second. Keyed on
  // known words rather than on rows: words part-way through the flashcards are not
  // what this screen is for, but they stay one tap away below.
  if (counts.known === 0 && !listAnyway) {
    return (
      <ScrollView
        contentContainerStyle={styles.emptyScroll}
        testID="library-empty"
      >
        <View style={styles.emptyContent}>
          <Text style={styles.emptyTitle}>Tick the words you already know</Text>
          <Text style={styles.muted}>
            Go through the deck a theme at a time and tap the ones you have.
            Words you add yourself land here too.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
            ]}
            onPress={() => router.push("/library/tick")}
            accessibilityRole="button"
            testID="library-tick-empty"
          >
            <Text style={styles.primaryButtonText}>Tick words you know</Text>
          </Pressable>
          <Pressable
            style={styles.textButton}
            onPress={() => router.push("/add")}
            accessibilityRole="button"
            testID="library-add-empty"
          >
            <Text style={styles.textButtonLabel}>+ Add a word</Text>
          </Pressable>
          {counts.learning > 0 ? (
            <Pressable
              style={styles.textButton}
              onPress={() => {
                setSection("learning");
                setListAnyway(true);
              }}
              accessibilityRole="button"
              testID="library-learning-empty"
            >
              <Text style={styles.textButtonLabel}>
                {`See the ${counts.learning} ${counts.learning === 1 ? "word" : "words"} you are still learning`}
              </Text>
            </Pressable>
          ) : null}
          <AskedFor
            rows={requests.data}
            failed={requests.isError}
            onSeeAll={() => router.push("/requests")}
          />
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headline} testID="library-headline">
            {libraryHeadline(counts.known, counts.learning)}
          </Text>
          <View style={styles.headerActions}>
            {/* The other thing to do with words you know: practise them.
                Practise asks which words, and "My words" is one of the
                choices. */}
            <Pressable
              style={styles.readLink}
              onPress={() => router.push("/practise")}
              accessibilityRole="button"
              testID="library-practise-link"
            >
              <Text style={styles.readLinkText}>Practise</Text>
            </Pressable>
            {/* The shelf is also where a word gets put on it. Mark learns most of
                his vocabulary from his wife rather than from the deck, so the way
                to record one belongs on the screen that lists them. */}
            <Pressable
              style={({ pressed }) => [
                styles.addButton,
                pressed && styles.pressed,
              ]}
              onPress={() => router.push("/add")}
              accessibilityRole="button"
              accessibilityLabel="Add a word"
              testID="library-add"
            >
              <Text style={styles.addButtonText}>+ Add a word</Text>
            </Pressable>
          </View>
        </View>

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
              <Text
                style={[
                  styles.tabLabel,
                  section === key && styles.tabLabelActive,
                ]}
              >
                {label}
                {"  "}
                <Text style={styles.tabCount}>
                  {key === "known" ? counts.known : counts.learning}
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
              <Text
                style={[
                  styles.chipLabel,
                  sort === key && styles.chipLabelActive,
                ]}
              >
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
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Pressable
              style={({ pressed }) => [
                styles.tickRow,
                pressed && styles.pressed,
              ]}
              onPress={() => router.push("/library/tick")}
              accessibilityRole="button"
              testID="library-tick"
            >
              <View style={styles.tickText}>
                <Text style={styles.tickLabel}>Tick words you know</Text>
                <Text style={styles.tickBlurb}>
                  Go through the deck by theme and tap the ones you have
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            <AskedFor
              rows={requests.data}
              failed={requests.isError}
              onSeeAll={() => router.push("/requests")}
            />
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.muted} testID="library-no-match">
            {query
              ? `No words match “${query}”.`
              : section === "known"
                ? "None known yet. Tick the words you already know, above."
                : "Nothing part-learnt right now. Everything you have studied is under Known."}
          </Text>
        }
        renderItem={({ item }) => (
          <LibraryRow
            entry={item}
            showLatin={showLatin}
            ttsEnabled={ttsEnabled}
            open={openId === item.card.id}
            onToggle={() =>
              setOpenId(openId === item.card.id ? null : item.card.id)
            }
          />
        )}
      />
    </View>
  );
}

/**
 * "Asked for": the words he has requested and not yet been given.
 *
 * Only the unanswered ones — an answered request is a card in the deck by now,
 * and the full Requests screen is where each sits beside its answer. Nothing at
 * all when nothing is waiting: an empty heading would be a fact about nothing.
 * A failed read says so in one quiet line rather than taking the screen down;
 * the words above it are the point of the screen.
 */
function AskedFor({
  rows,
  failed,
  onSeeAll,
}: {
  rows: readonly RequestEntry[] | undefined;
  failed: boolean;
  onSeeAll: () => void;
}) {
  if (failed) {
    return (
      <Text style={styles.askedMeta} testID="library-asked-error">
        Could not load the words you have asked for.
      </Text>
    );
  }
  const pending = pendingRequests(rows ?? []);
  if (pending.length === 0) return null;
  const shown = pending.slice(0, ASKED_FOR_LIMIT);
  const more = pending.length - shown.length;

  return (
    <View style={styles.asked} testID="library-asked">
      <Text style={styles.askedHeading}>Asked for</Text>
      {shown.map((row) => (
        // Mixed by construction: a request filed from the reader quotes the
        // tapped Cyrillic word inside English.
        <MixedText
          key={row.id}
          style={styles.askedText}
          testID={`library-asked-${row.id}`}
        >
          {row.text_en}
        </MixedText>
      ))}
      <Pressable
        style={styles.askedLink}
        onPress={onSeeAll}
        accessibilityRole="button"
        testID="library-asked-all"
      >
        <Text style={styles.readLinkText}>
          {more > 0 ? `See all (${more} more)` : "See all requests"}
        </Text>
      </Pressable>
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
  // A quick-added word has no example yet — the columns hold an empty string
  // until a backfill fills them in — so there is nothing to open, and the row
  // says so by not being tappable rather than by opening onto a blank panel.
  const exampleCyr = card.example_cyr.trim();
  const exampleEn = card.example_en.trim();
  const hasExample = exampleCyr !== "" || exampleEn !== "";

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Pressable
          style={styles.rowTap}
          onPress={onToggle}
          disabled={!hasExample}
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
                {" · "}
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

      {open && hasExample ? (
        <View style={styles.expanded} testID={`library-example-${card.sr_cyr}`}>
          {exampleCyr ? (
            <ScriptText role="cyr" style={styles.exampleCyr}>
              {exampleCyr}
            </ScriptText>
          ) : null}
          {showLatin && exampleCyr ? (
            <ScriptText role="lat" style={styles.exampleLat}>
              {cyrToLat(exampleCyr)}
            </ScriptText>
          ) : null}
          {exampleEn ? (
            <ScriptText role="en" style={styles.exampleEn}>
              {exampleEn}
            </ScriptText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centred: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  header: {
    width: "100%",
    maxWidth: contentMaxWidth,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  readLink: {
    minHeight: touchTarget - 12,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  readLinkText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  headline: {
    fontSize: 15,
    color: colors.text,
    fontWeight: "600",
    flexShrink: 1,
  },
  addButton: {
    minHeight: touchTarget - 16,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  addButtonText: { color: colors.primaryOn, fontSize: 14, fontWeight: "600" },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: {
    flex: 1,
    minHeight: touchTarget - 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  tabLabelActive: { color: colors.primaryOn },
  tabCount: { fontWeight: "700" },
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
  sortRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sortLabel: { fontSize: 13, color: colors.textMuted },
  chip: {
    minHeight: touchTarget - 16,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipLabel: { fontSize: 14, color: colors.text },
  chipLabelActive: { color: colors.primaryOn, fontWeight: "600" },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
    width: "100%",
    maxWidth: contentMaxWidth,
    alignSelf: "center",
  },
  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowTap: {
    flex: 1,
    minHeight: touchTarget - 8,
    justifyContent: "center",
    gap: 2,
  },
  // Colour and face come from `script`; only size and weight live here.
  rowCyr: { fontSize: 22, fontWeight: "600" },
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
  exampleEn: { fontSize: 13, fontStyle: "italic" },
  emptyScroll: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  emptyContent: {
    width: "100%",
    maxWidth: contentMaxWidth,
    alignSelf: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  listHeader: { gap: spacing.sm },
  tickRow: {
    minHeight: touchTarget + 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tickText: { flexShrink: 1, gap: 2 },
  tickLabel: { fontSize: 17, fontWeight: "600", color: colors.text },
  tickBlurb: { fontSize: 13, color: colors.textMuted },
  chevron: { fontSize: 28, color: colors.primary },
  asked: {
    alignSelf: "stretch",
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  askedHeading: {
    fontSize: 12,
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  askedText: { fontSize: 15 },
  askedMeta: { fontSize: 13, color: colors.textMuted },
  askedLink: { minHeight: touchTarget - 12, justifyContent: "center" },
  muted: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
  primaryButton: {
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  primaryButtonText: {
    color: colors.primaryOn,
    fontSize: 17,
    fontWeight: "600",
  },
  error: { color: colors.danger, fontSize: 14, textAlign: "center" },
  textButton: {
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  pressed: { opacity: 0.8 },
});
