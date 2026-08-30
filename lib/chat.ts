/**
 * The tutor conversation, minus the screen.
 *
 * Everything here is pure or takes its `fetch` as an argument, so the streaming
 * reader and the message parsing are unit tested rather than clicked through.
 * Like `lib/cardInput.ts`, this module deliberately imports no Supabase client
 * and no React Native: `lib/config.ts` (a string) and `lib/errors.ts` (no
 * imports at all) are the whole dependency list.
 */

import { functionsUrl } from '@/lib/config';
import { EdgeFunctionError, describeEdgeError } from '@/lib/errors';

/** One conversational turn, in the only two roles the `tutor` function accepts. */
export interface TutorTurn {
  role: 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// Streaming a reply
// ---------------------------------------------------------------------------

export interface StreamTutorArgs {
  /** The context to send, oldest first. The caller owns the truncation. */
  messages: readonly TutorTurn[];
  /** A compact description of what the learner is working on (see `formatLearnerState`). */
  learnerState?: string;
  /** The signed-in user's access token. */
  token: string;
  /** Called with each chunk as it arrives, for the live bubble. */
  onChunk: (text: string) => void;
  /** Defaults to this project's functions URL; a test seam. */
  baseUrl?: string;
  /** Defaults to the global `fetch`; a test seam. */
  fetchImpl?: typeof fetch;
}

/**
 * The message shown when the stream completes with nothing in it.
 *
 * That is not a hypothetical: `tutor` hands the response object back to the
 * runtime before the provider is actually called, so a provider failure *inside*
 * the stream ends the body silently and the client sees HTTP 200 with an empty
 * payload (Task 6, known limitation). Persisting that as an assistant message
 * would put a permanent blank bubble in the history and feed a blank turn back
 * as context, so it is an error here and the caller offers a retry.
 */
const EMPTY_REPLY =
  'The tutor sent an empty reply. The AI service probably failed mid-answer — try again.';

/**
 * POST the conversation to the `tutor` Edge Function and read the reply as it
 * streams, calling `onChunk` with each piece. Resolves with the whole text.
 *
 * Rejects with an `EdgeFunctionError` on a non-2xx (carrying the function's own
 * `{ error }` code) and with a plain `Error` when the stream completes empty.
 *
 * The body is plain text, not SSE: `tutor` uses `toTextStreamResponse()`, so
 * chunks are appended to the bubble as they arrive with no framing to parse.
 */
export async function streamTutor({
  messages,
  learnerState,
  token,
  onChunk,
  baseUrl = functionsUrl,
  fetchImpl = fetch,
}: StreamTutorArgs): Promise<string> {
  if (messages.length === 0) {
    throw new Error('There is nothing to send to the tutor.');
  }

  const state = learnerState?.trim();
  const response = await fetchImpl(`${baseUrl}/tutor`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // Only `role` and `content`: the function rejects a turn carrying anything
      // else, and rows read back from `chat_messages` carry ids and timestamps.
      messages: messages.map((turn) => ({ role: turn.role, content: turn.content })),
      ...(state ? { learnerState: state } : {}),
    }),
  });

  if (!response.ok) {
    // The function always answers with `{ error: '<code>' }`, but a crashed
    // container or a proxy in front of it may not.
    let code = `http_${response.status}`;
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload?.error === 'string') code = payload.error;
    } catch {
      // Body was not JSON; the status code alone will have to do.
    }
    throw new EdgeFunctionError(response.status, code);
  }

  const full = response.body
    ? await readStream(response.body, onChunk)
    : await readWhole(response, onChunk);

  if (full.trim() === '') throw new Error(EMPTY_REPLY);
  return full;
}

/** Drains a `ReadableStream` of UTF-8 bytes, emitting each decoded chunk. */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let full = '';

  const emit = (text: string) => {
    if (text === '') return;
    full += text;
    onChunk(text);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // `stream: true` is what makes a multi-byte character split across two
      // chunks come back whole — Cyrillic is two bytes per letter, so a naive
      // decode would put a replacement character in the middle of a word.
      emit(typeof value === 'string' ? value : decoder.decode(value, { stream: true }));
    }
    emit(decoder.decode());
  } finally {
    reader.releaseLock();
  }

  return full;
}

/**
 * The non-streaming fallback. React Native's `fetch` has no `response.body`, so
 * on a native build the reply arrives in one piece — slower to appear, but the
 * same text. (The MVP ships as a PWA, where streaming works.)
 */
async function readWhole(response: Response, onChunk: (text: string) => void): Promise<string> {
  const text = await response.text();
  if (text !== '') onChunk(text);
  return text;
}

/**
 * A sentence to show for a failed tutor turn. Delegates to `describeEdgeError`
 * except for the 502, whose shared wording ends in "fill the card in by hand" —
 * true of the deck's add-word flow, meaningless in a conversation.
 */
export function describeTutorError(error: unknown): string {
  if (error instanceof EdgeFunctionError && error.status === 502) {
    return 'The AI service could not be reached. Check the server’s API key, then try again.';
  }
  return describeEdgeError(error);
}

// ---------------------------------------------------------------------------
// The DODAJ add-word convention
// ---------------------------------------------------------------------------

/** A word the tutor offered to add to the deck. */
export interface DodajSuggestion {
  sr_cyr: string;
  en: string;
}

export interface ParsedDodaj {
  /** The message with the trailing DODAJ block removed, ready to render. */
  display: string;
  /** One per stripped line, in the order the tutor wrote them. */
  suggestions: DodajSuggestion[];
}

const CYRILLIC = /\p{Script=Cyrillic}/u;
/** `DODAJ: <cyrillic> = <english>` — the whole line, nothing else on it. */
const DODAJ_LINE = /^dodaj:\s*(.+)$/i;

/**
 * One line of the trailing block, or null if it is not a well-formed suggestion.
 *
 * A Latin headword counts as malformed: the prompt mandates Cyrillic, every
 * other screen assumes `sr_cyr` is Cyrillic, and `cardInputErrors` would refuse
 * to save it — better to leave the line visible in the message than to offer a
 * chip that cannot go anywhere.
 */
function parseDodajLine(line: string): DodajSuggestion | null {
  const marker = DODAJ_LINE.exec(line.trim());
  if (!marker) return null;

  // First `=` only: an English gloss is allowed to contain one.
  const body = marker[1];
  const split = body.indexOf('=');
  if (split === -1) return null;

  const sr_cyr = body.slice(0, split).trim();
  const en = body.slice(split + 1).trim();
  if (sr_cyr === '' || en === '') return null;
  if (!CYRILLIC.test(sr_cyr)) return null;

  return { sr_cyr, en };
}

/**
 * Splits a tutor message into what to show and what to offer as chips.
 *
 * The block is only recognised at the **end** of the message, which is where the
 * prompt puts it. Scanning stops at the first line that is neither blank nor a
 * well-formed suggestion, so a malformed line is left in the display untouched
 * rather than silently swallowed — and a mid-message "DODAJ:" (which the prompt
 * forbids, but a model may still write) stays as text.
 */
export function parseDodaj(text: string): ParsedDodaj {
  const lines = text.split(/\r?\n/);
  const found: DodajSuggestion[] = [];
  let end = lines.length;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line === '') {
      end = i;
      continue;
    }
    const suggestion = parseDodajLine(line);
    if (!suggestion) break;
    found.unshift(suggestion);
    end = i;
  }

  // Same word twice in one message: keep the first gloss the tutor gave.
  const seen = new Set<string>();
  const suggestions = found.filter((suggestion) => {
    if (seen.has(suggestion.sr_cyr)) return false;
    seen.add(suggestion.sr_cyr);
    return true;
  });

  return { display: lines.slice(0, end).join('\n').trim(), suggestions };
}

// ---------------------------------------------------------------------------
// The shape of a tutor reply
// ---------------------------------------------------------------------------

/**
 * `sr` is Serbian to be shown big, `en` its translation, `note` the optional
 * grammar point, `text` anything unprefixed.
 */
export type TutorLineKind = 'sr' | 'en' | 'note' | 'text';

export interface TutorLine {
  kind: TutorLineKind;
  text: string;
}

const PREFIXES: { pattern: RegExp; kind: TutorLineKind | null }[] = [
  { pattern: /^sr:\s*/i, kind: 'sr' },
  // Dropped, not rendered: the client transliterates the SR line itself, so
  // `settings.show_latin` decides whether any Latin appears. Keeping the
  // model's own line would show Latin to someone who has switched it off.
  { pattern: /^lat:\s*/i, kind: null },
  { pattern: /^en:\s*/i, kind: 'en' },
  { pattern: /^note:\s*/i, kind: 'note' },
];

/**
 * The tutor's `SR:` / `LAT:` / `EN:` / `NOTE:` shape as renderable lines.
 *
 * Tolerant on purpose: an unprefixed line is kept as `text` (the screen still
 * shows it, and adds a Latin subtitle if it is Cyrillic), so a reply that
 * ignores the format is degraded rather than lost.
 */
export function parseTutorMessage(text: string): TutorLine[] {
  const lines: TutorLine[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;

    const match = PREFIXES.find((prefix) => prefix.pattern.test(line));
    if (!match) {
      lines.push({ kind: 'text', text: line });
      continue;
    }
    if (match.kind === null) continue;

    const body = line.replace(match.pattern, '').trim();
    if (body !== '') lines.push({ kind: match.kind, text: body });
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Learner state
// ---------------------------------------------------------------------------

/** A card the learner keeps forgetting, as `getLearnerState` reads it. */
export interface LapsedCard {
  sr_cyr: string;
  en: string;
  lapses: number;
}

/** The dashboard figures the tutor is told about (a `DashboardStats`). */
export interface LearnerStats {
  dueCount: number;
  newAvailable: number;
  newDoneToday: number;
  streakDays: number;
}

/** How many weak words the block is allowed to name. */
export const LEARNER_STATE_WORDS = 5;

/**
 * The volatile block appended to the tutor's system prompt (`buildTutorSystem`).
 *
 * Prose rather than JSON: it is read by a language model, and the prompt already
 * tells it to weave these words in naturally rather than drill them.
 */
export function formatLearnerState({
  stats,
  lapsed,
}: {
  stats: LearnerStats;
  lapsed: readonly LapsedCard[];
}): string {
  const lines = [
    `Due for review right now: ${stats.dueCount}. ` +
      `New cards learned today: ${stats.newDoneToday}. ` +
      `Cards in the deck he has not studied yet: ${stats.newAvailable}. ` +
      `Study streak: ${stats.streakDays} ${stats.streakDays === 1 ? 'day' : 'days'}.`,
  ];

  const weak = lapsed.slice(0, LEARNER_STATE_WORDS);
  if (weak.length > 0) {
    const words = weak.map((card) => `${card.sr_cyr} (${card.en})`).join(', ');
    lines.push(`Words he keeps forgetting, hardest first: ${words}.`);
  }

  return lines.join('\n');
}
