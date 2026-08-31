/**
 * The books shelf: the real Cyrillic picture books at home, and the way to get
 * one into the app.
 *
 * The capture half is deliberately dumb. Mark photographs the pages, they go
 * straight into private storage, and the book is saved `pending` — nothing here
 * reads a photograph or guesses at the Serbian on it (phase 3 removed the
 * runtime AI, and OCR of a child's handwritten-looking picture book is not a
 * thing to guess at). Claude transcribes the photographs between sessions and
 * flips the book to `ready`, at which point it opens in the reading view.
 *
 * So a pending book is not a failure state and does not read as one: it is a
 * book that has been saved and is waiting its turn.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MixedText, ScriptText } from '@/components/ScriptText';
import { api, type NewBookPhoto } from '@/lib/api';
import {
  bookTitleError,
  cyrillicTitleError,
  MAX_PAGES,
  pageCountError,
  PENDING_NOTE,
  PHOTO_QUALITY,
  uploadProgressLabel,
} from '@/lib/books';
import { errorMessage } from '@/lib/errors';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import type { BookRow } from '@/lib/types';

export default function BooksScreen() {
  const queryClient = useQueryClient();

  const [titleEn, setTitleEn] = useState('');
  const [titleCyr, setTitleCyr] = useState('');
  const [photos, setPhotos] = useState<readonly NewBookPhoto[]>([]);
  /** The live "Uploading page 3 of 8…" line, or null when nothing is going up. */
  const [progress, setProgress] = useState<string | null>(null);
  /** A failure from the picker itself — permissions, or an unreadable file. */
  const [pickError, setPickError] = useState<string | null>(null);

  const books = useQuery({ queryKey: ['books'], queryFn: () => api.listBooks() });

  const save = useMutation({
    mutationFn: () =>
      api.createBookWithPhotos({
        title_en: titleEn,
        title_cyr: titleCyr,
        photos,
        onProgress: (uploaded, total) => setProgress(uploadProgressLabel(uploaded, total)),
      }),
    onSuccess: async () => {
      // Cleared here rather than optimistically: the form emptying is the
      // confirmation that the book was saved, so it must not empty for one that
      // failed and would have to be photographed all over again.
      setTitleEn('');
      setTitleCyr('');
      setPhotos([]);
      // A picking failure from before the book was saved has nothing to say
      // about the empty form that replaces it.
      setPickError(null);
      await queryClient.invalidateQueries({ queryKey: ['books'] });
    },
    onSettled: () => setProgress(null),
  });

  const pickPages = async () => {
    setPickError(null);
    try {
      // Granted without asking on web, and on iOS 14+ the system picker needs no
      // permission at all — but Android does, and a silent no-op would look like
      // a broken button.
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPickError('Vukovica needs access to your photos to add a book’s pages.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        // Page order is the order they are picked in, so it has to be the order
        // they come back in. (iOS only; elsewhere the picker is already ordered.)
        orderedSelection: true,
        selectionLimit: MAX_PAGES,
        // The upload needs the bytes, and this is the one way to get them that
        // works the same on a phone and in a browser.
        base64: true,
        // Native re-encodes at this quality; web hands the file over untouched.
        quality: PHOTO_QUALITY,
        exif: false,
      });
      if (result.canceled) return;

      const chosen = result.assets ?? [];
      const picked = chosen
        .filter((asset) => typeof asset.base64 === 'string' && asset.base64.length > 0)
        .map((asset) => ({ base64: asset.base64 as string, mimeType: asset.mimeType }));

      if (picked.length === 0) {
        setPickError('Those photos could not be read. Try choosing them again.');
        return;
      }

      // Say so when only some of them survived. Page numbers come from position
      // in this list, so a silent drop does not leave a gap — it renumbers
      // everything after it, and the book reads as complete while missing a
      // page in the middle. That is the one photo mistake you cannot spot later
      // from the list, so it has to be said now, while the picker is still the
      // thing on screen.
      const dropped = chosen.length - picked.length;
      if (dropped > 0) {
        setPickError(
          `${dropped} of ${chosen.length} photos could not be read and ${
            dropped === 1 ? 'was' : 'were'
          } left out — check the page count above, then add the missing ${
            dropped === 1 ? 'one' : 'ones'
          }.`,
        );
      }

      // Appended, not replaced: a long book is often photographed in two goes,
      // and picking again should add pages 9-16 rather than throw 1-8 away.
      setPhotos((previous) => [...previous, ...picked]);
    } catch (error) {
      setPickError(errorMessage(error, 'Those photos could not be opened.'));
    }
  };

  const titleProblem = bookTitleError(titleEn) ?? cyrillicTitleError(titleCyr);
  const pagesProblem = pageCountError(photos.length);
  const canSave = titleProblem === null && pagesProblem === null && !save.isPending;

  const all = books.data ?? [];
  const ready = all.filter((book) => book.status === 'ready');
  const pending = all.filter((book) => book.status !== 'ready');

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={books.isRefetching}
          onRefresh={() => void books.refetch()}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.prompt}>Add a book</Text>
          <Text style={styles.note}>
            Photograph every page in order. The pages are transcribed between sessions, and the
            book opens for reading once they are.
          </Text>

          <TextInput
            style={styles.input}
            value={titleEn}
            onChangeText={setTitleEn}
            editable={!save.isPending}
            autoCapitalize="words"
            placeholder="Title in English"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Title in English"
            testID="book-title-en"
          />
          <TextInput
            style={styles.input}
            value={titleCyr}
            onChangeText={setTitleCyr}
            editable={!save.isPending}
            autoCapitalize="sentences"
            placeholder="Title in Cyrillic (optional)"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Title in Cyrillic, optional"
            testID="book-title-cyr"
          />

          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              save.isPending && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={save.isPending}
            onPress={() => void pickPages()}
            accessibilityRole="button"
            accessibilityLabel="Choose page photos"
            testID="book-pick"
          >
            <Text style={styles.secondaryButtonLabel}>
              {photos.length === 0 ? 'Choose page photos' : 'Add more pages'}
            </Text>
          </Pressable>

          {photos.length > 0 ? (
            <View style={styles.pagesRow}>
              <Text style={styles.pagesCount} testID="book-page-count">
                {photos.length} page{photos.length === 1 ? '' : 's'} chosen
              </Text>
              <Pressable
                style={styles.textButton}
                disabled={save.isPending}
                onPress={() => setPhotos([])}
                accessibilityRole="button"
                accessibilityLabel="Clear the chosen pages"
                testID="book-clear-pages"
              >
                <Text style={styles.textButtonLabel}>Clear</Text>
              </Pressable>
            </View>
          ) : null}

          {pickError ? (
            <Text style={styles.error} testID="book-pick-error">
              {pickError}
            </Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              !canSave && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={!canSave}
            onPress={() => save.mutate()}
            accessibilityRole="button"
            accessibilityLabel="Save the book"
            testID="book-save"
          >
            <Text style={styles.primaryButtonLabel}>
              {save.isPending ? 'Saving…' : 'Save book'}
            </Text>
          </Pressable>

          {save.isPending && progress ? (
            <Text style={styles.progress} testID="book-progress">
              {progress}
            </Text>
          ) : null}
          {save.isError ? (
            <Text style={styles.error} testID="book-save-error">
              {errorMessage(save.error, 'That book could not be saved. Try again.')}
            </Text>
          ) : null}
          {/* Only once the form is otherwise ready: telling someone who has not
              typed a title yet that they have no pages is nagging, not helping. */}
          {!save.isPending && titleProblem === null && pagesProblem !== null ? (
            <Text style={styles.note} testID="book-pages-hint">
              {pagesProblem}
            </Text>
          ) : null}
        </View>

        {books.isPending ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : books.isError ? (
          <View style={styles.card} testID="books-error">
            <Text style={styles.error}>
              {errorMessage(books.error, 'Could not load your books.')}
            </Text>
            <Pressable
              style={styles.textButton}
              onPress={() => void books.refetch()}
              accessibilityRole="button"
            >
              <Text style={styles.textButtonLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : all.length === 0 ? (
          <Text style={styles.muted} testID="books-empty">
            No books yet. Photograph one you read together and it will appear here.
          </Text>
        ) : (
          <>
            <Section title="Ready to read" count={ready.length} testID="books-ready">
              {ready.map((book) => (
                <ReadyBook key={book.id} book={book} />
              ))}
            </Section>
            <Section title="Waiting" count={pending.length} testID="books-pending">
              {pending.map((book) => (
                <PendingBook key={book.id} book={book} />
              ))}
            </Section>
          </>
        )}
      </View>
    </ScrollView>
  );
}

/**
 * The name a book goes by on the shelf: its Cyrillic title, set as Serbian, or
 * its English one, which is a title like any other and keeps the row's colour.
 */
function BookTitle({ book }: { book: BookRow }) {
  return (
    <ScriptText role={book.title_cyr ? 'cyr' : 'en'} style={styles.rowTitle}>
      {book.title_cyr ?? book.title_en}
    </ScriptText>
  );
}

/** A heading with a count, and whatever rows belong under it. */
function Section({
  title,
  count,
  testID,
  children,
}: {
  title: string;
  count: number;
  testID: string;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSubtitle}>{count}</Text>
      </View>
      {children}
    </View>
  );
}

/**
 * A transcribed book, which opens for reading.
 *
 * A Claude-authored rendering (`source: 'claude'`) is listed and read exactly
 * like a photographed one — it is the same tappable Cyrillic — and says whose
 * words they are, because the real book on the shelf says something slightly
 * different and the difference matters when it is read aloud to a child.
 */
function ReadyBook({ book }: { book: BookRow }) {
  const router = useRouter();

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={() => router.push(`/book/${book.id}`)}
      accessibilityRole="button"
      accessibilityLabel={book.title_cyr ?? book.title_en}
      testID={`book-row-${book.id}`}
    >
      <View style={styles.rowText}>
        <BookTitle book={book} />
        {book.title_cyr ? (
          <ScriptText role="en" style={styles.rowMeta}>
            {book.title_en}
          </ScriptText>
        ) : null}
        {book.source === 'claude' ? (
          <MixedText style={styles.rowMeta} testID={`book-rendering-${book.id}`}>
            Claude’s rendering — photograph your copy for the real text
          </MixedText>
        ) : null}
        {book.finished_at ? (
          <Text style={styles.rowDone} testID={`book-finished-${book.id}`}>
            Finished
          </Text>
        ) : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

/**
 * A book whose photographs are saved and whose text is not written yet.
 *
 * Not pressable, because there is nothing to open: the reading view is for
 * ready books. The line under it says who is doing what and when, rather than
 * "pending", so it reads as a promise rather than a status code.
 */
function PendingBook({ book }: { book: BookRow }) {
  return (
    <View style={styles.row} testID={`book-row-${book.id}`}>
      <View style={styles.rowText}>
        <BookTitle book={book} />
        {book.title_cyr ? (
          <ScriptText role="en" style={styles.rowMeta}>
            {book.title_en}
          </ScriptText>
        ) : null}
        <Text style={styles.rowMeta} testID={`book-pending-${book.id}`}>
          {PENDING_NOTE}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: spacing.md },
  content: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    gap: spacing.md,
  },
  loading: { marginVertical: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  prompt: { fontSize: 18, fontWeight: '600', color: colors.text },
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
  },
  primaryButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryButtonLabel: { color: colors.primaryOn, fontSize: 17, fontWeight: '700' },
  secondaryButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  buttonDisabled: { backgroundColor: colors.disabled },
  pagesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  pagesCount: { fontSize: 15, color: colors.text, fontWeight: '600' },
  progress: { fontSize: 14, color: colors.primary },
  section: { gap: spacing.sm },
  sectionHeader: { gap: 2 },
  sectionTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
  sectionSubtitle: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase' },
  row: {
    minHeight: touchTarget + 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowText: { flexShrink: 1, gap: 2 },
  // The colour is kept here rather than taken from `script`, because a book
  // known only by its English title is still a title and must not go muted; the
  // role supplies the serif for the Cyrillic ones and nothing else.
  rowTitle: { fontSize: 20, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 13, color: colors.textMuted },
  rowDone: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  chevron: { fontSize: 28, color: colors.primary },
  note: { fontSize: 12, color: colors.textMuted },
  muted: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14 },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
