import { describe, expect, it } from 'vitest';

import { pendingRequests, readerRequestText, requestTextError } from '@/lib/requests';

describe('requestTextError', () => {
  it('accepts anything with a character in it', () => {
    expect(requestTextError('How do I say “pass me the salt”?')).toBeNull();
    // Untrimmed is fine: `createRequest` trims before it inserts.
    expect(requestTextError('  see you tomorrow  ')).toBeNull();
  });

  it('rejects an empty or whitespace-only box', () => {
    expect(requestTextError('')).not.toBeNull();
    expect(requestTextError('   \n\t ')).not.toBeNull();
  });

  it('has no length cap — a reader request quotes a whole sentence', () => {
    expect(requestTextError('a'.repeat(2000))).toBeNull();
  });
});

/**
 * The format is load-bearing: it is what Claude reads when answering the queue
 * offline, so it is asserted character for character rather than by shape.
 */
describe('readerRequestText', () => {
  it('quotes the word and appends the sentence it was read in', () => {
    expect(readerRequestText('мачка', 'Беба воли мачку.')).toBe(
      '"мачка" — in: Беба воли мачку.',
    );
  });

  it('trims both parts', () => {
    expect(readerRequestText('  мачка ', '  Беба воли мачку.  ')).toBe(
      '"мачка" — in: Беба воли мачку.',
    );
  });

  it('files the quoted word alone when there is no sentence', () => {
    expect(readerRequestText('мачка', '')).toBe('"мачка"');
    expect(readerRequestText('мачка', '   ')).toBe('"мачка"');
  });
});

describe('pendingRequests', () => {
  it('keeps only the unanswered ones, in the order given', () => {
    const rows = [
      { id: '1', status: 'pending' },
      { id: '2', status: 'done' },
      { id: '3', status: 'pending' },
    ];
    expect(pendingRequests(rows).map((row) => row.id)).toEqual(['1', '3']);
  });

  it('is empty when everything has been answered', () => {
    expect(pendingRequests([{ status: 'done' }])).toEqual([]);
    expect(pendingRequests([])).toEqual([]);
  });
});
