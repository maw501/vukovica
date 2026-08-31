/**
 * Reading a book: one page on the screen at a time, big Cyrillic, every word
 * tappable.
 *
 * A page at a time rather than a scroll, because that is how the paper book
 * works — a spread is read, talked about, and turned. The page number is the
 * only chrome, and "Finished" appears on the last page, where finishing a book
 * actually happens.
 *
 * **No Latin in the text itself** (spec §3.3), exactly as in the story view:
 * decoding Cyrillic is the whole exercise, so `settings.show_latin` deliberately
 * does not reach the page. A tap opens `GlossSheet`, the same component the
 * story view uses, so the two reading surfaces answer a word identically by
 * construction rather than by care.
 *
 * A Claude-authored book (`source: 'claude'`) renders through this same path.
 * The only difference is a line saying whose words they are — the rendering is
 * not the book on the shelf, and that matters when it is read aloud.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GlossSheet } from '@/components/GlossSheet';
import { MixedText, ScriptText } from '@/components/ScriptText';
import { api } from '@/lib/api';
import { describeBookFinishError, PENDING_NOTE } from '@/lib/books';
import { errorMessage } from '@/lib/errors';
import { sentenceAt, tokenize } from '@/lib/reader';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';

export default function BookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [pageIndex, setPageIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  /**
   * Words already filed from this book, so re-tapping one shows "Requested ✓"
   * rather than offering to file it a second time. Lowercased, because the deck
   * lookup is case-insensitive and so is the question being asked.
   */
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());

  // The same `['books']` list the shelf uses — so arriving from it costs no
  // round trip, and a book opened by URL simply loads the list.
  const books = useQuery({ queryKey: ['books'], queryFn: () => api.listBooks() });
  const book = (books.data ?? []).find((row) => row.id === id);

  const pages = useQuery({
    queryKey: ['book-pages', id],
    queryFn: () => api.getBookPages(id),
    enabled: Boolean(id),
  });

  const allPages = pages.data ?? [];
  // Clamped rather than stored back: the page rows can arrive after the first
  // render, and a book re-photographed with fewer pages must not leave the
  // reader on a page that is no longer there.
  const page = allPages.length > 0 ? allPages[Math.min(pageIndex, allPages.length - 1)] : null;
  const currentIndex = allPages.length > 0 ? Math.min(pageIndex, allPages.length - 1) : 0;

  const tokens = useMemo(() => tokenize(page?.text_cyr ?? ''), [page?.text_cyr]);
  const selected =
    selectedIndex !== null && tokens[selectedIndex]
      ? { word: tokens[selectedIndex].text, sentence: sentenceAt(tokens, selectedIndex) }
      : null;

  const finish = useMutation({
    mutationFn: async () => {
      const finished = await api.finishBook(id);
      // The book is saved by this point, so the XP is a garnish: a failed award
      // costs its fifty points and must not turn a finished book into an error
      // message. Awaited so the invalidation below cannot race it.
      await api.awardXp('book_finish').catch(() => undefined);
      return finished;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        // The Books rung counts finished books, so the dashboard's stage line
        // moves the moment this lands.
        queryClient.invalidateQueries({ queryKey: ['progress'] }),
        queryClient.invalidateQueries({ queryKey: ['xp'] }),
      ]);
      if (router.canGoBack()) router.back();
      else router.replace('/books');
    },
  });

  if (!book) {
    return (
      <View style={styles.centred}>
        {books.isPending || books.isFetching ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Text style={styles.muted} testID="book-missing">
              {books.isError
                ? errorMessage(books.error, 'Could not load your books.')
                : 'That book is not on your shelf.'}
            </Text>
            <Pressable style={styles.textButton} onPress={() => void books.refetch()}>
              <Text style={styles.textButtonLabel}>Try again</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const title = book.title_cyr ?? book.title_en;
  // A book with a Cyrillic title is Serbian content and is set as such; one
  // known only by its English title is not, and keeps the heading style.
  const titleRole = book.title_cyr ? 'cyr' : 'en';

  // A book still waiting on its transcription has nothing to read, and saying
  // so is the whole answer — there is no half-readable state to offer.
  if (book.status !== 'ready') {
    return (
      <View style={styles.centred}>
        <Stack.Screen options={{ title }} />
        <ScriptText role={titleRole} style={styles.title}>
          {title}
        </ScriptText>
        <Text style={styles.muted} testID="book-waiting">
          {PENDING_NOTE}
        </Text>
      </View>
    );
  }

  const finished = book.finished_at !== null;
  const isLastPage = allPages.length > 0 && currentIndex === allPages.length - 1;

  const turnTo = (index: number) => {
    // The sheet belongs to the word that was tapped, and that word is on the
    // page being left.
    setSelectedIndex(null);
    setPageIndex(index);
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title }} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <ScriptText role={titleRole} style={styles.title} testID="book-title">
            {title}
          </ScriptText>
          <Text style={styles.meta} testID="book-meta">
            {allPages.length > 0 ? `Page ${currentIndex + 1} of ${allPages.length}` : 'No pages'}
            {finished ? ' · Finished' : ''}
          </Text>
          {book.source === 'claude' ? (
            <MixedText style={styles.meta} testID="book-rendering">
              Claude’s rendering — photograph your copy for the real text
            </MixedText>
          ) : null}

          {pages.isPending ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          ) : pages.isError ? (
            <View style={styles.centredBlock}>
              <Text style={styles.error} testID="book-pages-error">
                {errorMessage(pages.error, 'Could not load this book’s pages.')}
              </Text>
              <Pressable style={styles.textButton} onPress={() => void pages.refetch()}>
                <Text style={styles.textButtonLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : !page ? (
            <Text style={styles.muted} testID="book-no-pages">
              This book has no pages yet.
            </Text>
          ) : page.text_cyr === null ? (
            // A ready book whose page has no text is a transcription that missed
            // a page. Saying so beats a blank screen that looks like a bug.
            <Text style={styles.muted} testID="book-page-untranscribed">
              This page has not been transcribed yet.
            </Text>
          ) : (
            // The whole page is one Cyrillic run, so the role goes on the
            // wrapper and every token inherits it; only a selected word overrides.
            <ScriptText role="cyr" style={styles.body} testID="book-page-text">
              {tokens.map((token, index) =>
                token.tappable ? (
                  <Text
                    key={index}
                    style={selectedIndex === index ? styles.wordSelected : null}
                    onPress={() => setSelectedIndex(index)}
                    accessibilityRole="button"
                    testID={`word-${index}`}
                  >
                    {token.text}
                  </Text>
                ) : (
                  <Text key={index}>{token.text}</Text>
                ),
              )}
            </ScriptText>
          )}

          <View style={styles.pager}>
            <Pressable
              style={({ pressed }) => [
                styles.pagerButton,
                currentIndex === 0 && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}
              disabled={currentIndex === 0}
              onPress={() => turnTo(currentIndex - 1)}
              accessibilityRole="button"
              accessibilityLabel="Previous page"
              testID="book-prev"
            >
              <Text style={styles.pagerLabel}>‹ Back</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.pagerButton,
                (isLastPage || allPages.length === 0) && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}
              disabled={isLastPage || allPages.length === 0}
              onPress={() => turnTo(currentIndex + 1)}
              accessibilityRole="button"
              accessibilityLabel="Next page"
              testID="book-next"
            >
              <Text style={styles.pagerLabel}>Next ›</Text>
            </Pressable>
          </View>

          {finished ? (
            <Text style={styles.muted} testID="book-read-only">
              You have finished this one. Read it as many times as you like.
            </Text>
          ) : isLastPage ? (
            // Only on the last page: finishing a book is what happens when it is
            // closed, and an always-present button invites finishing page one.
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                finish.isPending && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}
              disabled={finish.isPending}
              onPress={() => finish.mutate()}
              accessibilityRole="button"
              accessibilityLabel="I have finished this book"
              testID="book-finish"
            >
              <Text style={styles.primaryButtonLabel}>
                {finish.isPending ? 'Saving…' : 'I have finished this'}
              </Text>
            </Pressable>
          ) : null}

          {finish.isError ? (
            <Text style={styles.error} testID="book-finish-error">
              {describeBookFinishError(finish.error)}
            </Text>
          ) : null}

          {/* Room for the sheet, so the last line is never hidden behind it. */}
          {selected ? <View style={styles.sheetSpacer} /> : null}
        </View>
      </ScrollView>

      {selected ? (
        <GlossSheet
          // Remounting per word is what resets the sheet's own request state;
          // words already filed are remembered by `requested` above.
          key={`${currentIndex}-${selectedIndex}`}
          word={selected.word}
          sentence={selected.sentence}
          requested={requested.has(selected.word.toLowerCase())}
          onRequested={(word) =>
            setRequested((previous) => new Set(previous).add(word.toLowerCase()))
          }
          onClose={() => setSelectedIndex(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1, padding: spacing.md },
  content: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    gap: spacing.md,
  },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md },
  centredBlock: { alignItems: 'center', gap: spacing.sm },
  loading: { marginVertical: spacing.xl },
  // The colour is kept here rather than taken from `script`, because a book
  // known only by its English title is still a title and must not go muted; the
  // role supplies the serif for the Cyrillic ones and nothing else.
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: -spacing.sm },
  /**
   * The reading surface, matching the story view exactly: 24pt on a 42pt line,
   * which is what makes an unfamiliar script decodable rather than merely
   * legible — a point roomier than it was, for the serif it is now set in.
   */
  body: { fontSize: 24, lineHeight: 42 },
  wordSelected: { color: colors.primary, fontWeight: '700' },
  muted: { fontSize: 14, color: colors.textMuted },
  error: { color: colors.danger, fontSize: 14 },
  pager: { flexDirection: 'row', gap: spacing.sm },
  pagerButton: {
    flex: 1,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pagerLabel: { color: colors.primary, fontSize: 17, fontWeight: '600' },
  primaryButton: {
    minHeight: touchTarget + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
  },
  primaryButtonLabel: { color: colors.primaryOn, fontSize: 18, fontWeight: '700' },
  buttonDisabled: { backgroundColor: colors.disabled },
  /** Room under the text for the sheet, which floats over the bottom edge. */
  sheetSpacer: { height: 220 },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
