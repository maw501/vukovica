import { describe, expect, it, vi } from 'vitest';

import {
  describeTutorError,
  formatLearnerState,
  parseDodaj,
  parseTutorMessage,
  streamTutor,
} from '@/lib/chat';
import { EdgeFunctionError, describeEdgeError } from '@/lib/errors';

// ---------------------------------------------------------------------------
// parseDodaj
// ---------------------------------------------------------------------------

describe('parseDodaj', () => {
  it('leaves a message with no DODAJ lines alone', () => {
    const text = 'SR: Добро јутро!\nLAT: Dobro jutro!\nEN: Good morning!';
    expect(parseDodaj(text)).toEqual({ display: text, suggestions: [] });
  });

  it('strips a single trailing DODAJ line into a suggestion', () => {
    const { display, suggestions } = parseDodaj(
      'SR: Хоћеш ли млеко?\nEN: Do you want milk?\nDODAJ: млеко = milk',
    );
    expect(display).toBe('SR: Хоћеш ли млеко?\nEN: Do you want milk?');
    expect(suggestions).toEqual([{ sr_cyr: 'млеко', en: 'milk' }]);
  });

  it('strips several DODAJ lines, keeping them in the order written', () => {
    const { display, suggestions } = parseDodaj(
      ['SR: Данас кувам ручак.', 'DODAJ: кувати = to cook', 'DODAJ: ручак = lunch'].join('\n'),
    );
    expect(display).toBe('SR: Данас кувам ручак.');
    expect(suggestions).toEqual([
      { sr_cyr: 'кувати', en: 'to cook' },
      { sr_cyr: 'ручак', en: 'lunch' },
    ]);
  });

  it('trims whitespace around both halves of the line', () => {
    expect(parseDodaj('SR: Ево.\nDODAJ:   беба   =   baby  ').suggestions).toEqual([
      { sr_cyr: 'беба', en: 'baby' },
    ]);
  });

  it('accepts the marker in any case — models drift, the block is still theirs', () => {
    expect(parseDodaj('SR: Ево.\ndodaj: беба = baby').suggestions).toEqual([
      { sr_cyr: 'беба', en: 'baby' },
    ]);
  });

  it('splits on the first = only, so an English gloss may contain one', () => {
    expect(parseDodaj('SR: Ево.\nDODAJ: два = two = 2').suggestions).toEqual([
      { sr_cyr: 'два', en: 'two = 2' },
    ]);
  });

  it('ignores blank lines inside and after the trailing block', () => {
    const { display, suggestions } = parseDodaj(
      'SR: Ево.\n\nDODAJ: беба = baby\n\nDODAJ: мама = mum\n\n',
    );
    expect(display).toBe('SR: Ево.');
    expect(suggestions).toHaveLength(2);
  });

  it('leaves a DODAJ line that is not at the end of the message in the display', () => {
    const text = 'DODAJ: беба = baby\nSR: Ево бебе.';
    expect(parseDodaj(text)).toEqual({ display: text, suggestions: [] });
  });

  it('leaves a malformed line (no = sign) untouched in the display', () => {
    const text = 'SR: Ево.\nDODAJ: беба baby';
    expect(parseDodaj(text)).toEqual({ display: text, suggestions: [] });
  });

  it('leaves a line with an empty half untouched in the display', () => {
    expect(parseDodaj('SR: Ево.\nDODAJ: беба =').suggestions).toEqual([]);
    expect(parseDodaj('SR: Ево.\nDODAJ:  = baby').suggestions).toEqual([]);
  });

  it('treats a Latin headword as malformed — the deck only takes Cyrillic', () => {
    const text = 'SR: Ево.\nDODAJ: beba = baby';
    expect(parseDodaj(text)).toEqual({ display: text, suggestions: [] });
  });

  it('stops at a malformed line rather than reaching past it', () => {
    const text = 'SR: Ево.\nDODAJ: беба = baby\nDODAJ: broken';
    expect(parseDodaj(text)).toEqual({ display: text, suggestions: [] });
  });

  it('handles CRLF line endings', () => {
    const { display, suggestions } = parseDodaj('SR: Ево.\r\nDODAJ: беба = baby\r\n');
    expect(display).toBe('SR: Ево.');
    expect(suggestions).toEqual([{ sr_cyr: 'беба', en: 'baby' }]);
  });

  it('is empty-safe', () => {
    expect(parseDodaj('')).toEqual({ display: '', suggestions: [] });
    expect(parseDodaj('   \n  ')).toEqual({ display: '', suggestions: [] });
  });

  it('never returns a display that still contains a stripped suggestion', () => {
    const { display } = parseDodaj('SR: Ево.\nDODAJ: беба = baby');
    expect(display).not.toMatch(/DODAJ/i);
  });

  it('drops duplicate suggestions for the same headword', () => {
    const { suggestions } = parseDodaj('SR: Ево.\nDODAJ: беба = baby\nDODAJ: беба = infant');
    expect(suggestions).toEqual([{ sr_cyr: 'беба', en: 'baby' }]);
  });
});

// ---------------------------------------------------------------------------
// parseTutorMessage
// ---------------------------------------------------------------------------

describe('parseTutorMessage', () => {
  it('labels the SR / EN / NOTE lines and drops the model’s own LAT line', () => {
    expect(
      parseTutorMessage(
        'SR: Добро јутро!\nLAT: Dobro jutro!\nEN: Good morning!\nNOTE: “јутро” is neuter.',
      ),
    ).toEqual([
      { kind: 'sr', text: 'Добро јутро!' },
      { kind: 'en', text: 'Good morning!' },
      { kind: 'note', text: '“јутро” is neuter.' },
    ]);
  });

  it('drops the LAT line so `show_latin` actually controls the Latin', () => {
    const kinds = parseTutorMessage('SR: Ево.\nLAT: Evo.\nEN: Here.').map((line) => line.kind);
    expect(kinds).not.toContain('lat');
    expect(kinds).toEqual(['sr', 'en']);
  });

  it('keeps an unprefixed line as plain text', () => {
    expect(parseTutorMessage('Здраво!')).toEqual([{ kind: 'text', text: 'Здраво!' }]);
  });

  it('is case-insensitive about the prefixes and tolerates missing spaces', () => {
    expect(parseTutorMessage('sr:Ево.\nen:Here.')).toEqual([
      { kind: 'sr', text: 'Ево.' },
      { kind: 'en', text: 'Here.' },
    ]);
  });

  it('drops blank lines', () => {
    expect(parseTutorMessage('SR: Ево.\n\n\nEN: Here.')).toHaveLength(2);
  });

  it('keeps a prefixed line whose body is empty out of the list', () => {
    expect(parseTutorMessage('SR: Ево.\nEN:')).toEqual([{ kind: 'sr', text: 'Ево.' }]);
  });

  it('is empty-safe', () => {
    expect(parseTutorMessage('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatLearnerState
// ---------------------------------------------------------------------------

const stats = { dueCount: 8, newAvailable: 12, newDoneToday: 3, streakDays: 5 };

describe('formatLearnerState', () => {
  it('states the numbers the tutor can use', () => {
    const text = formatLearnerState({ stats, lapsed: [] });
    expect(text).toContain('8');
    expect(text).toContain('12');
    expect(text).toContain('3');
    expect(text).toContain('5 days');
  });

  it('lists the most-lapsed words with their glosses', () => {
    const text = formatLearnerState({
      stats,
      lapsed: [
        { sr_cyr: 'млеко', en: 'milk', lapses: 4 },
        { sr_cyr: 'кашика', en: 'spoon', lapses: 2 },
      ],
    });
    expect(text).toContain('млеко (milk)');
    expect(text).toContain('кашика (spoon)');
  });

  it('leaves the weak-words line out entirely when there are none', () => {
    expect(formatLearnerState({ stats, lapsed: [] }).toLowerCase()).not.toContain('forget');
  });

  it('says "1 day", not "1 days"', () => {
    expect(formatLearnerState({ stats: { ...stats, streakDays: 1 }, lapsed: [] })).toContain(
      '1 day.',
    );
  });

  it('never runs away with a long list', () => {
    const lapsed = Array.from({ length: 20 }, (_, i) => ({
      sr_cyr: `реч${i}`,
      en: `word ${i}`,
      lapses: 20 - i,
    }));
    const text = formatLearnerState({ stats, lapsed });
    expect(text).toContain('реч0');
    expect(text).not.toContain('реч5');
  });

  it('is a single trimmed block, not a trailing newline', () => {
    expect(formatLearnerState({ stats, lapsed: [] })).toBe(
      formatLearnerState({ stats, lapsed: [] }).trim(),
    );
  });
});

// ---------------------------------------------------------------------------
// streamTutor
// ---------------------------------------------------------------------------

const BASE = 'https://example.test/functions/v1';

function bodyOf(chunks: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

function streaming(chunks: readonly (string | Uint8Array)[]): Response {
  return { ok: true, status: 200, body: bodyOf(chunks) } as unknown as Response;
}

function failing(status: number, payload: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => payload,
  } as unknown as Response;
}

/** A fetch that always answers with `response`, and records what it was sent. */
function fetchStub(response: Response) {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

const turns = [{ role: 'user' as const, content: 'Здраво' }];

describe('streamTutor', () => {
  it('accumulates the chunks and resolves with the whole reply', async () => {
    const onChunk = vi.fn();
    const text = await streamTutor({
      messages: turns,
      token: 'tok',
      onChunk,
      baseUrl: BASE,
      fetchImpl: fetchStub(streaming(['Добро ', 'јутро!'])),
    });

    expect(text).toBe('Добро јутро!');
    expect(onChunk.mock.calls.map((call) => call[0])).toEqual(['Добро ', 'јутро!']);
  });

  it('posts to /tutor as the signed-in user with the messages and learner state', async () => {
    const fetchImpl = fetchStub(streaming(['ok']));
    await streamTutor({
      messages: turns,
      learnerState: 'Due now: 8.',
      token: 'tok',
      onChunk: () => {},
      baseUrl: BASE,
      fetchImpl,
    });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${BASE}/tutor`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ role: 'user', content: 'Здраво' }],
      learnerState: 'Due now: 8.',
    });
  });

  it('sends only role and content — the function rejects anything else', async () => {
    const fetchImpl = fetchStub(streaming(['ok']));
    await streamTutor({
      messages: [
        { role: 'user', content: 'Здраво', id: 7, created_at: 'now' } as never,
      ],
      token: 'tok',
      onChunk: () => {},
      baseUrl: BASE,
      fetchImpl,
    });

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body)).messages).toEqual([
      { role: 'user', content: 'Здраво' },
    ]);
  });

  it('omits learnerState when there is none to send', async () => {
    const fetchImpl = fetchStub(streaming(['ok']));
    await streamTutor({
      messages: turns,
      token: 'tok',
      onChunk: () => {},
      baseUrl: BASE,
      fetchImpl,
    });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).not.toHaveProperty('learnerState');
  });

  it('defaults its base URL to the project’s functions URL', async () => {
    const fetchImpl = fetchStub(streaming(['ok']));
    await streamTutor({ messages: turns, token: 'tok', onChunk: () => {}, fetchImpl });
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/tutor`);
  });

  it('reassembles a multi-byte character split across two chunks', async () => {
    // "ћ" is two bytes in UTF-8; deliver them one per chunk.
    const bytes = new TextEncoder().encode('ћ');
    const onChunk = vi.fn();
    const text = await streamTutor({
      messages: turns,
      token: 'tok',
      onChunk,
      baseUrl: BASE,
      fetchImpl: fetchStub(streaming([bytes.slice(0, 1), bytes.slice(1)])),
    });
    expect(text).toBe('ћ');
    expect(onChunk).toHaveBeenCalledTimes(1);
  });

  it('treats a completed but empty stream as a failure, not as a reply', async () => {
    // Task 6's known limitation: a provider failure *inside* the stream ends the
    // body silently, so the function answers 200 with nothing in it.
    const onChunk = vi.fn();
    await expect(
      streamTutor({
        messages: turns,
        token: 'tok',
        onChunk,
        baseUrl: BASE,
        fetchImpl: fetchStub(streaming([])),
      }),
    ).rejects.toThrow(/empty|no reply|nothing/i);
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only stream as a failure too', async () => {
    await expect(
      streamTutor({
        messages: turns,
        token: 'tok',
        onChunk: () => {},
        baseUrl: BASE,
        fetchImpl: fetchStub(streaming(['  \n', ' '])),
      }),
    ).rejects.toThrow(/empty|no reply|nothing/i);
  });

  it('rejects with the function’s error code on a non-2xx', async () => {
    const error = await streamTutor({
      messages: turns,
      token: 'tok',
      onChunk: () => {},
      baseUrl: BASE,
      fetchImpl: fetchStub(failing(502, { error: 'provider_error' })),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EdgeFunctionError);
    expect(error).toMatchObject({ status: 502, code: 'provider_error' });
  });

  it('falls back to the status code when the error body is not JSON', async () => {
    const error = await streamTutor({
      messages: turns,
      token: 'tok',
      onChunk: () => {},
      baseUrl: BASE,
      fetchImpl: fetchStub({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response),
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 500, code: 'http_500' });
  });

  it('rejects a 400 from the role check without swallowing the code', async () => {
    const error = await streamTutor({
      messages: turns,
      token: 'tok',
      onChunk: () => {},
      baseUrl: BASE,
      fetchImpl: fetchStub(failing(400, { error: 'invalid_message' })),
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 400, code: 'invalid_message' });
  });

  it('reads the whole body at once where the platform cannot stream it', async () => {
    // React Native's fetch has no `response.body`. Non-streaming, but not broken.
    const onChunk = vi.fn();
    const text = await streamTutor({
      messages: turns,
      token: 'tok',
      onChunk,
      baseUrl: BASE,
      fetchImpl: fetchStub({
        ok: true,
        status: 200,
        body: null,
        text: async () => 'Добро јутро!',
      } as unknown as Response),
    });
    expect(text).toBe('Добро јутро!');
    expect(onChunk).toHaveBeenCalledWith('Добро јутро!');
  });

  it('treats an empty non-streaming body as a failure as well', async () => {
    await expect(
      streamTutor({
        messages: turns,
        token: 'tok',
        onChunk: () => {},
        baseUrl: BASE,
        fetchImpl: fetchStub({
          ok: true,
          status: 200,
          body: null,
          text: async () => '',
        } as unknown as Response),
      }),
    ).rejects.toThrow(/empty|no reply|nothing/i);
  });

  it('refuses to send with no messages rather than earning a 400', async () => {
    const fetchImpl = fetchStub(streaming(['ok']));
    await expect(
      streamTutor({ messages: [], token: 'tok', onChunk: () => {}, baseUrl: BASE, fetchImpl }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('describeTutorError', () => {
  it('does not tell someone in a conversation to fill a card in by hand', () => {
    const message = describeTutorError(new EdgeFunctionError(502, 'provider_error'));
    expect(message).toMatch(/API key/);
    expect(message).not.toMatch(/card/i);
  });

  it('keeps the shared wording for every other status', () => {
    expect(describeTutorError(new EdgeFunctionError(401, 'unauthorized'))).toBe(
      describeEdgeError(new EdgeFunctionError(401, 'unauthorized')),
    );
    expect(describeTutorError(new EdgeFunctionError(400, 'invalid_message'))).toBe(
      describeEdgeError(new EdgeFunctionError(400, 'invalid_message')),
    );
  });

  it('passes the empty-stream message through, since that is the one to read', async () => {
    const caught = await streamTutor({
      messages: turns,
      token: 'tok',
      onChunk: () => {},
      baseUrl: BASE,
      fetchImpl: fetchStub(streaming([])),
    }).catch((error: unknown) => error);

    expect(describeTutorError(caught)).toMatch(/empty reply/i);
  });
});
