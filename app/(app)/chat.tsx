/**
 * Разговор — the tutor conversation.
 *
 * The history lives in `chat_messages` and is the only state that matters: the
 * user's message is written **before** the request goes out, so a failed reply
 * leaves what he typed on screen and retryable rather than losing it. The
 * assistant's message is written only once the stream has completed with
 * something in it — an empty stream is a provider failure dressed as an HTTP 200
 * (Task 6's known limitation) and must never become a blank bubble, because a
 * blank bubble would then be fed back as context on every later turn.
 *
 * `DODAJ: <cyrillic> = <english>` lines are stored **raw** and stripped at
 * render (`parseDodaj`), so the convention can change without rewriting history.
 * The Latin line the model offers is dropped and re-derived with `cyrToLat`,
 * which is what makes `settings.show_latin` actually control it.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CardForm } from '@/components/CardForm';
import { api, CHAT_HISTORY_LIMIT } from '@/lib/api';
import { EMPTY_CARD_INPUT, type CardInput } from '@/lib/cardInput';
import {
  describeTutorError,
  parseDodaj,
  parseTutorMessage,
  streamTutor,
  type DodajSuggestion,
  type TutorTurn,
} from '@/lib/chat';
import { errorMessage } from '@/lib/errors';
import { colors, contentMaxWidth, radius, spacing, touchTarget } from '@/lib/theme';
import { cyrToLat } from '@/lib/transliterate';
import type { ChatMessageRow } from '@/lib/types';

/**
 * How many turns are sent back to the tutor as context. Fewer than the 50 shown:
 * the screen is a scrollback, the prompt is a conversation, and every turn sent
 * is paid for on every request.
 */
const CONTEXT_TURNS = 20;

const CYRILLIC = /\p{Script=Cyrillic}/u;

/** The rows the `tutor` function will accept, newest `CONTEXT_TURNS` of them. */
function toContext(messages: readonly ChatMessageRow[]): TutorTurn[] {
  return messages
    .filter((row): row is ChatMessageRow & { role: 'user' | 'assistant' } =>
      row.role === 'user' || row.role === 'assistant',
    )
    .slice(-CONTEXT_TURNS)
    .map((row) => ({ role: row.role, content: row.content }));
}

export default function ChatScreen() {
  const queryClient = useQueryClient();

  const history = useQuery({
    queryKey: ['chat-messages'],
    queryFn: () => api.listChatMessages(CHAT_HISTORY_LIMIT),
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() });
  const showLatin = settings.data?.show_latin ?? true;

  const [draft, setDraft] = useState('');
  /** The assistant's reply as it arrives; null when nothing is streaming. */
  const [streamed, setStreamed] = useState<string | null>(null);
  /** The word whose "＋ у шпил" chip was tapped, if the add sheet is open. */
  const [adding, setAdding] = useState<DodajSuggestion | null>(null);

  const scroller = useRef<ScrollView>(null);
  const messages = history.data ?? [];

  const append = useCallback(
    (row: ChatMessageRow) => {
      queryClient.setQueryData<ChatMessageRow[]>(['chat-messages'], (previous) => [
        ...(previous ?? []),
        row,
      ]);
    },
    [queryClient],
  );

  /**
   * One turn: send `context` and, if the stream produces anything, persist the
   * reply. `context` is passed in rather than read from the cache so that a
   * retry sends exactly what the failed attempt sent.
   */
  const turn = useMutation({
    mutationFn: async (context: TutorTurn[]) => {
      const [token, learnerState] = await Promise.all([
        api.getAccessToken(),
        api.getLearnerState(),
      ]);
      setStreamed('');
      const reply = await streamTutor({
        messages: context,
        learnerState,
        token,
        onChunk: (chunk) => setStreamed((current) => (current ?? '') + chunk),
      });
      return api.appendChatMessage('assistant', reply);
    },
    onSuccess: (row) => {
      setStreamed(null);
      append(row);
    },
    onError: () => {
      // The partial text goes: it was never saved, and leaving half a sentence
      // above an error message reads as though it were the answer.
      setStreamed(null);
    },
  });

  /** Persist what he typed, then take the turn. */
  const send = useMutation({
    mutationFn: async (text: string) => api.appendChatMessage('user', text),
    // Clears a previous turn's error, so the failure on screen is always the
    // one belonging to what is happening now.
    onMutate: () => turn.reset(),
    onSuccess: (row) => {
      setDraft('');
      append(row);
      turn.mutate(toContext([...messages, row]));
    },
  });

  const busy = send.isPending || turn.isPending;
  const canSend = draft.trim().length > 0 && !busy;

  /**
   * The two failures read the same on screen but retry different things. A
   * failed *turn* re-sends the same context (the user's message is already
   * saved, so retrying must not write it twice); a failed *save* never got the
   * message into the history at all, so its retry is the original send — with
   * what he typed still in the box, because `draft` is only cleared on success.
   */
  const failed = turn.isError
    ? {
        message: describeTutorError(turn.error),
        ready: messages.length > 0,
        retry: () => turn.mutate(toContext(messages)),
      }
    : send.isError
      ? {
          message: errorMessage(send.error, 'Your message could not be saved.'),
          ready: draft.trim() !== '',
          retry: () => send.mutate(draft.trim()),
        }
      : null;

  if (adding) {
    return (
      <AddSuggestion
        suggestion={adding}
        onDone={() => setAdding(null)}
        onSaved={() => {
          // Both dashboard counts move when the deck grows.
          void queryClient.invalidateQueries({ queryKey: ['cards'] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          void queryClient.invalidateQueries({ queryKey: ['queue'] });
          setAdding(null);
        }}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
      >
        {history.isPending ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : history.isError ? (
          <View style={styles.centred}>
            <Text style={styles.error} testID="chat-history-error">
              {errorMessage(history.error, 'Could not load the conversation.')}
            </Text>
            <Pressable style={styles.textButton} onPress={() => void history.refetch()}>
              <Text style={styles.textButtonLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : messages.length === 0 && streamed === null ? (
          <View style={styles.centred}>
            <Text style={styles.emptyCyr}>Разговор</Text>
            <Text style={styles.muted} testID="chat-empty">
              Write something in Serbian or English. The tutor answers in Cyrillic, with the
              Latin and the English underneath.
            </Text>
          </View>
        ) : null}

        {messages.map((row) =>
          row.role === 'user' ? (
            <UserBubble key={row.id} content={row.content} />
          ) : (
            <AssistantBubble
              key={row.id}
              content={row.content}
              showLatin={showLatin}
              onAdd={setAdding}
            />
          ),
        )}

        {streamed !== null ? (
          <AssistantBubble content={streamed} showLatin={showLatin} streaming />
        ) : null}

        {failed ? (
          <View style={styles.errorCard} testID="chat-error">
            <Text style={styles.error}>{failed.message}</Text>
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              disabled={busy || !failed.ready}
              onPress={failed.retry}
              accessibilityRole="button"
              testID="chat-retry"
            >
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Пиши овде…"
          placeholderTextColor={colors.textMuted}
          multiline
          autoCapitalize="sentences"
          onSubmitEditing={() => canSend && send.mutate(draft.trim())}
          testID="chat-input"
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            !canSend && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
          disabled={!canSend}
          onPress={() => send.mutate(draft.trim())}
          accessibilityRole="button"
          accessibilityLabel="Send"
          testID="chat-send"
        >
          <Text style={styles.sendButtonText}>{busy ? '…' : '➤'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Bubbles
// ---------------------------------------------------------------------------

function UserBubble({ content }: { content: string }) {
  return (
    <View style={[styles.bubble, styles.userBubble]} testID="chat-user">
      <Text style={styles.userText}>{content}</Text>
    </View>
  );
}

function AssistantBubble({
  content,
  showLatin,
  streaming,
  onAdd,
}: {
  content: string;
  showLatin: boolean;
  streaming?: boolean;
  onAdd?: (suggestion: DodajSuggestion) => void;
}) {
  const { display, suggestions } = parseDodaj(content);
  const lines = parseTutorMessage(display);

  return (
    <View style={[styles.bubble, styles.tutorBubble]} testID="chat-assistant">
      {lines.length === 0 && streaming ? (
        <Text style={styles.muted}>…</Text>
      ) : (
        lines.map((line, index) => {
          // An unprefixed line is treated as Serbian when it is written in
          // Cyrillic: a reply that ignores the SR:/EN: shape still gets its
          // Latin subtitle rather than being rendered as English.
          const serbian = line.kind === 'sr' || (line.kind === 'text' && CYRILLIC.test(line.text));
          return (
            <View key={index} style={styles.line}>
              <Text
                style={
                  serbian ? styles.srText : line.kind === 'note' ? styles.noteText : styles.enText
                }
              >
                {line.kind === 'note' ? `Note: ${line.text}` : line.text}
              </Text>
              {serbian && showLatin ? (
                <Text style={styles.latText} testID="chat-latin">
                  {cyrToLat(line.text)}
                </Text>
              ) : null}
            </View>
          );
        })
      )}

      {/* Only once the message is saved: tapping a chip leaves the thread for
          the card form, which would abandon a stream still in flight. */}
      {!streaming && suggestions.length > 0 && onAdd ? (
        <View style={styles.chipRow}>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.sr_cyr}
              style={({ pressed }) => [styles.addChip, pressed && styles.pressed]}
              onPress={() => onAdd(suggestion)}
              accessibilityRole="button"
              accessibilityLabel={`Add ${suggestion.sr_cyr} to the deck`}
              testID={`chat-add-${suggestion.sr_cyr}`}
            >
              <Text style={styles.addChipText}>
                ＋ {suggestion.sr_cyr} · у шпил
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// A suggestion, drafted into a card
// ---------------------------------------------------------------------------

/**
 * The chip's flow: ask `generate` for a full card, show it in the deck's own
 * editable preview, save with `api.addCard`. Identical to the deck's add-word
 * path, except that the tutor already told us both halves of the word — so when
 * `generate` is unreachable the manual fallback starts half filled in rather
 * than blank.
 */
function AddSuggestion({
  suggestion,
  onDone,
  onSaved,
}: {
  suggestion: DodajSuggestion;
  onDone: () => void;
  onSaved: () => void;
}) {
  const [card, setCard] = useState<CardInput | null>(null);

  const generate = useMutation({
    mutationFn: () => api.generateCard(suggestion.sr_cyr),
    onSuccess: (drafted) => setCard({ ...drafted, en: drafted.en || suggestion.en }),
  });

  const save = useMutation({
    mutationFn: (input: CardInput) => api.addCard(input),
    onSuccess: onSaved,
  });

  if (card) {
    return (
      <CardForm
        title="Check the card"
        value={card}
        onChange={setCard}
        onCancel={onDone}
        cancelLabel="Back to the conversation"
        onSubmit={(input) => save.mutate(input)}
        submitLabel="Add to the deck"
        busy={save.isPending}
        error={save.error}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.content}>
        <Text style={styles.formTitle}>{suggestion.sr_cyr}</Text>
        <Text style={styles.muted}>
          {cyrToLat(suggestion.sr_cyr)} · {suggestion.en}
        </Text>

        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            generate.isPending && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
          disabled={generate.isPending}
          onPress={() => generate.mutate()}
          accessibilityRole="button"
          testID="chat-add-generate"
        >
          <Text style={styles.primaryButtonText}>
            {generate.isPending ? 'Drafting…' : 'Draft the card'}
          </Text>
        </Pressable>

        {generate.isError ? (
          <View style={styles.errorCard} testID="chat-add-error">
            <Text style={styles.error}>{describeTutorError(generate.error)}</Text>
            <Pressable
              style={styles.textButton}
              onPress={() =>
                setCard({ ...EMPTY_CARD_INPUT, sr_cyr: suggestion.sr_cyr, en: suggestion.en })
              }
              accessibilityRole="button"
              testID="chat-add-manual"
            >
              <Text style={styles.textButtonLabel}>Fill the card in by hand</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable style={styles.textButton} onPress={onDone} accessibilityRole="button">
          <Text style={styles.textButtonLabel}>Back to the conversation</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  thread: {
    flexGrow: 1,
    padding: spacing.md,
    gap: spacing.sm,
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
  },
  scroll: { flexGrow: 1, padding: spacing.md },
  content: {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
    gap: spacing.sm,
  },
  centred: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  loading: { marginVertical: spacing.xl },
  emptyCyr: { fontSize: 28, fontWeight: '700', color: colors.primary },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '90%',
    gap: spacing.xs,
  },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  userText: { color: colors.primaryOn, fontSize: 16 },
  tutorBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  line: { gap: 1 },
  srText: { fontSize: 18, color: colors.text, lineHeight: 25 },
  latText: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  enText: { fontSize: 14, color: colors.textMuted },
  noteText: { fontSize: 13, color: colors.primary, marginTop: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  addChip: {
    minHeight: touchTarget - 12,
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.sm,
  },
  addChipText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
  },
  input: {
    flex: 1,
    minHeight: touchTarget,
    maxHeight: touchTarget * 3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
  },
  sendButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: { color: colors.primaryOn, fontSize: 20 },
  formTitle: { fontSize: 26, fontWeight: '700', color: colors.text },
  primaryButton: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
  },
  primaryButtonText: { color: colors.primaryOn, fontSize: 17, fontWeight: '600' },
  buttonDisabled: { backgroundColor: colors.disabled },
  errorCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  error: { color: colors.danger, fontSize: 14 },
  muted: { color: colors.textMuted, fontSize: 14 },
  retryButton: {
    minHeight: touchTarget - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  retryButtonText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  textButton: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
