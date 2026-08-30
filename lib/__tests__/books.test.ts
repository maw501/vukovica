import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  bookTitleError,
  cyrillicTitleError,
  describeBookFinishError,
  MAX_PAGES,
  pageCountError,
  photoContentType,
  photoObjectPath,
  uploadProgressLabel,
} from '@/lib/books';

/**
 * The storage path is not a formatting choice: the `book-photos` bucket's RLS
 * policies compare `(storage.foldername(name))[1]` with `auth.uid()`, so a path
 * whose first segment is anything but the owner's id is refused by the database.
 */
describe('photoObjectPath', () => {
  const user = '4e67a901-55f7-427d-88c8-091b60236027';
  const book = '0f0c2e7a-1b3c-4a2e-9c1d-8a7b6c5d4e3f';

  it('puts the user id first, then the book, then the page', () => {
    expect(photoObjectPath(user, book, 1)).toBe(`${user}/${book}/1.jpg`);
    expect(photoObjectPath(user, book, 16)).toBe(`${user}/${book}/16.jpg`);
  });

  it('names every page .jpg, whatever was picked', () => {
    // The extension is part of the agreed shape; the real MIME type is stored
    // as object metadata by the upload.
    expect(photoObjectPath(user, book, 3).endsWith('.jpg')).toBe(true);
  });
});

describe('bookTitleError', () => {
  it('requires an English title', () => {
    expect(bookTitleError('')).toBe('A book needs an English title.');
    expect(bookTitleError('   ')).toBe('A book needs an English title.');
  });

  it('accepts a real title', () => {
    expect(bookTitleError('Guess How Much I Love You')).toBeNull();
  });

  it('rejects an absurdly long one', () => {
    expect(bookTitleError('a'.repeat(201))).toMatch(/under 200/);
  });
});

describe('cyrillicTitleError', () => {
  it('accepts blank — the Cyrillic title is optional', () => {
    expect(cyrillicTitleError('')).toBeNull();
    expect(cyrillicTitleError('   ')).toBeNull();
  });

  it('accepts the book’s own title', () => {
    expect(cyrillicTitleError('Погоди колико те волим')).toBeNull();
  });

  it('rejects an absurdly long one', () => {
    expect(cyrillicTitleError('а'.repeat(201))).toMatch(/under 200/);
  });
});

describe('pageCountError', () => {
  it('needs at least one page', () => {
    expect(pageCountError(0)).toBe('Choose at least one page to photograph.');
  });

  it('accepts a picture book', () => {
    expect(pageCountError(1)).toBeNull();
    expect(pageCountError(16)).toBeNull();
    expect(pageCountError(MAX_PAGES)).toBeNull();
  });

  it('refuses more pages than a picture book has', () => {
    expect(pageCountError(MAX_PAGES + 1)).toMatch(/Split it into two books/);
  });
});

describe('uploadProgressLabel', () => {
  it('counts the page that is going up, not the one that has landed', () => {
    expect(uploadProgressLabel(0, 8)).toBe('Uploading page 1 of 8…');
    expect(uploadProgressLabel(2, 8)).toBe('Uploading page 3 of 8…');
    expect(uploadProgressLabel(7, 8)).toBe('Uploading page 8 of 8…');
  });

  it('stops counting once every page is up', () => {
    // What follows is the page-row insert, which is not a page anybody is
    // waiting on -- "Uploading page 9 of 8" would be a lie about both.
    expect(uploadProgressLabel(8, 8)).toBe('Saving the book…');
  });
});

/**
 * The decoder is hand-rolled because `atob` is not something this app can
 * promise on every runtime it ships to, and a photograph decoded by an absent
 * global is a blank page in a child's book.
 */
describe('base64ToBytes', () => {
  /** The reference encoder, so the tests state the expectation independently. */
  const encode = (bytes: readonly number[]) =>
    Buffer.from(Uint8Array.from(bytes)).toString('base64');

  it('decodes the empty string to no bytes', () => {
    expect(Array.from(base64ToBytes(''))).toEqual([]);
  });

  it('round-trips every byte value', () => {
    const all = Array.from({ length: 256 }, (_value, index) => index);
    expect(Array.from(base64ToBytes(encode(all)))).toEqual(all);
  });

  it('handles all three padding cases', () => {
    // Lengths 3n, 3n+1, 3n+2 -- i.e. no padding, "==", and "=".
    for (const length of [3, 4, 5, 6]) {
      const bytes = Array.from({ length }, (_value, index) => (index * 37) % 256);
      expect(Array.from(base64ToBytes(encode(bytes)))).toEqual(bytes);
    }
  });

  it('decodes a real JPEG header', () => {
    // The first bytes of every JPEG: SOI marker plus JFIF APP0.
    const header = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
    expect(Array.from(base64ToBytes(encode(header)))).toEqual(header);
  });

  it('ignores the whitespace a wrapped data URL carries', () => {
    const bytes = [1, 2, 3, 4, 5, 6];
    const wrapped = encode(bytes).split('').join('\n');
    expect(Array.from(base64ToBytes(wrapped))).toEqual(bytes);
  });

  it('accepts the URL-safe alphabet', () => {
    const bytes = [0xfb, 0xff, 0xbf];
    const standard = encode(bytes);
    const urlSafe = standard.replaceAll('+', '-').replaceAll('/', '_');
    expect(standard).not.toBe(urlSafe); // The fixture must actually exercise it.
    expect(Array.from(base64ToBytes(urlSafe))).toEqual(bytes);
  });

  it('throws rather than silently producing wrong bytes', () => {
    expect(() => base64ToBytes('not base64!')).toThrow(/could not be read/);
    // A lone character encodes nothing at all.
    expect(() => base64ToBytes('A')).toThrow(/could not be read/);
  });
});

describe('photoContentType', () => {
  it('keeps the picked file’s own image type', () => {
    expect(photoContentType('image/png')).toBe('image/png');
    expect(photoContentType('image/heic')).toBe('image/heic');
  });

  it('falls back to JPEG for anything that is not an image', () => {
    expect(photoContentType(null)).toBe('image/jpeg');
    expect(photoContentType(undefined)).toBe('image/jpeg');
    expect(photoContentType('')).toBe('image/jpeg');
    // A type that is not an image is not a page of a book, and must not be
    // stored as the truth about the bytes.
    expect(photoContentType('text/html')).toBe('image/jpeg');
  });
});

describe('describeBookFinishError', () => {
  it('names the book when the row has gone', () => {
    expect(describeBookFinishError({ code: 'PGRST116' })).toMatch(/no longer in your library/);
    // Specifically a *book*: a reader told his story is gone would go looking
    // in the wrong place.
    expect(describeBookFinishError({ code: 'PGRST116' })).toMatch(/book/);
  });

  it('passes any other failure’s own message through', () => {
    expect(describeBookFinishError({ message: 'network unreachable' })).toBe(
      'network unreachable',
    );
  });

  it('falls back to something actionable', () => {
    expect(describeBookFinishError(null)).toBe('That could not be saved. Try again.');
  });
});
