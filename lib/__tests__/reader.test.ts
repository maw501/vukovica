import { describe, expect, it } from 'vitest';

import { describeFinishError, sentenceAt, tokenize, type Token } from '@/lib/reader';

/**
 * The body of the story sitting in the local database, verbatim (including the
 * blank lines between paragraphs and the Serbian quotation marks). Every
 * interesting case the reader has to survive is already in it, so the tests use
 * the real thing rather than an invented string.
 */
const STORY = [
  'Мама и беба су код куће. Мачка спава у башти.',
  '',
  'Беба гледа мачку и смеје се. Мама доноси млеко.',
  '',
  '„Дођи, мацо”, каже беба. Мачка долази и пије млеко. Сви су срећни.',
].join('\n');

/** The tokens' text, for readable assertions. */
function texts(tokens: readonly Token[]): string[] {
  return tokens.map((token) => token.text);
}

/** Just the words a reader can tap. */
function tappable(tokens: readonly Token[]): string[] {
  return tokens.filter((token) => token.tappable).map((token) => token.text);
}

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('tiles the source exactly — joining the tokens gives the body back', () => {
    // The whole rendering strategy rests on this: the body is one <Text> whose
    // children are the tokens, so anything the tokenizer drops (a space, a
    // newline, a quote) disappears from the page.
    expect(texts(tokenize(STORY)).join('')).toBe(STORY);
  });

  it('splits on whitespace, and the whitespace is its own untappable token', () => {
    expect(tokenize('Мама и беба')).toEqual([
      { text: 'Мама', tappable: true },
      { text: ' ', tappable: false },
      { text: 'и', tappable: true },
      { text: ' ', tappable: false },
      { text: 'беба', tappable: true },
    ]);
  });

  it('splits punctuation glued to a word off as a separate untappable token', () => {
    expect(tokenize('куће.')).toEqual([
      { text: 'куће', tappable: true },
      { text: '.', tappable: false },
    ]);
    expect(tokenize('беба,')).toEqual([
      { text: 'беба', tappable: true },
      { text: ',', tappable: false },
    ]);
  });

  it('handles the Serbian quotation marks „ ” on both sides of a word', () => {
    // Straight from the story: the opening quote is glued to the front of a
    // word and the closing one to the back, with a comma after it.
    expect(tokenize('„Дођи, мацо”,')).toEqual([
      { text: '„', tappable: false },
      { text: 'Дођи', tappable: true },
      { text: ',', tappable: false },
      { text: ' ', tappable: false },
      { text: 'мацо', tappable: true },
      { text: '”,', tappable: false },
    ]);
  });

  it('keeps a hyphenated word as ONE tappable token', () => {
    expect(tokenize('црно-бела')).toEqual([{ text: 'црно-бела', tappable: true }]);
    expect(tappable(tokenize('дан-два и радо-радо-радо'))).toEqual([
      'дан-два',
      'и',
      'радо-радо-радо',
    ]);
  });

  it('does not swallow a hyphen that is not between letters', () => {
    // A trailing or leading dash is punctuation, not part of the word.
    expect(tokenize('како-')).toEqual([
      { text: 'како', tappable: true },
      { text: '-', tappable: false },
    ]);
    expect(tokenize('-како')).toEqual([
      { text: '-', tappable: false },
      { text: 'како', tappable: true },
    ]);
  });

  it('treats dashes, ellipses and runs of punctuation as untappable', () => {
    expect(tokenize('— Шта?!')).toEqual([
      { text: '—', tappable: false },
      { text: ' ', tappable: false },
      { text: 'Шта', tappable: true },
      // A maximal run of punctuation is one token; there is nothing to gain
      // from rendering "?" and "!" separately.
      { text: '?!', tappable: false },
    ]);
    expect(tokenize('чекај…')).toEqual([
      { text: 'чекај', tappable: true },
      { text: '…', tappable: false },
    ]);
  });

  it('keeps newlines, so paragraph breaks survive to the page', () => {
    const tokens = tokenize('Први.\n\nДруги.');
    expect(texts(tokens)).toEqual(['Први', '.', '\n\n', 'Други', '.']);
    expect(tokens.every((token) => (token.text.includes('\n') ? !token.tappable : true))).toBe(
      true,
    );
  });

  it('is not fooled by digits — a number is not a word to gloss', () => {
    // The story prompt spells numbers out, but a stray digit must not become a
    // tappable token that sends "1996" to the gloss endpoint.
    expect(tokenize('1996')).toEqual([{ text: '1996', tappable: false }]);
  });

  it('does not make a Latin word tappable — there is no Latin in this view', () => {
    // The `story` function refuses to save a body containing Latin, so this
    // cannot happen through the app. A body inserted by hand or restored from a
    // backup can still carry one, and a tappable "Hello" would both break the
    // premise of the screen and send a non-Serbian word to the gloss endpoint.
    expect(tokenize('Hello')).toEqual([{ text: 'Hello', tappable: false }]);
    expect(tappable(tokenize('Мама and беба'))).toEqual(['Мама', 'беба']);
  });

  it('does not make a MIXED-script word tappable either', () => {
    // "бebа" — Cyrillic with a Latin `b` and `e` hidden in it. Glossing that
    // would ask the model about a word that does not exist.
    expect(tokenize('бebа')).toEqual([{ text: 'бebа', tappable: false }]);
    // The same applies to a hyphenated compound with one Latin half.
    expect(tokenize('црно-white')).toEqual([{ text: 'црно-white', tappable: false }]);
  });

  it('returns nothing for an empty body and does not invent tokens for blanks', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([{ text: '   ', tappable: false }]);
  });

  it('makes every tappable token a Cyrillic word (optionally hyphenated)', () => {
    for (const token of tokenize(STORY)) {
      if (token.tappable) {
        expect(token.text).toMatch(/^\p{L}+(?:-\p{L}+)*$/u);
        expect(token.text).toMatch(/^[\p{Script=Cyrillic}-]+$/u);
      }
    }
    // And it really did find the words: the story's first sentence, in order.
    expect(tappable(tokenize(STORY)).slice(0, 6)).toEqual([
      'Мама',
      'и',
      'беба',
      'су',
      'код',
      'куће',
    ]);
  });
});

// ---------------------------------------------------------------------------
// sentenceAt — the context the gloss endpoint is given
// ---------------------------------------------------------------------------

describe('sentenceAt', () => {
  const tokens = tokenize(STORY);
  const indexOfWord = (word: string) =>
    tokens.findIndex((token) => token.tappable && token.text === word);

  it('returns the sentence around a tapped word, punctuation and all', () => {
    expect(sentenceAt(tokens, indexOfWord('мачку'))).toBe('Беба гледа мачку и смеје се.');
  });

  it('starts a sentence after the previous full stop, not at the paragraph start', () => {
    expect(sentenceAt(tokens, indexOfWord('спава'))).toBe('Мачка спава у башти.');
  });

  it('does not run across a paragraph break', () => {
    // "Мама" appears in two paragraphs; the second one's sentence must not
    // reach back into the first.
    const second = tokens.findIndex(
      (token, index) => token.tappable && token.text === 'Мама' && index > indexOfWord('спава'),
    );
    expect(sentenceAt(tokens, second)).toBe('Мама доноси млеко.');
  });

  it('keeps quoted speech together — a quote mark is not a sentence end', () => {
    expect(sentenceAt(tokens, indexOfWord('Дођи'))).toBe('„Дођи, мацо”, каже беба.');
  });

  it('falls back to everything it has when the text has no full stop', () => {
    const bare = tokenize('Мачка спава у башти');
    expect(sentenceAt(bare, 0)).toBe('Мачка спава у башти');
  });

  it('is safe on an index that is not there', () => {
    expect(sentenceAt(tokens, -1)).toBe('');
    expect(sentenceAt(tokens, tokens.length)).toBe('');
    expect(sentenceAt([], 0)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// describeFinishError
// ---------------------------------------------------------------------------

describe('describeFinishError', () => {
  it('turns PostgREST’s “no rows returned” into something about the story', () => {
    const message = describeFinishError({
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
      details: 'The result contains 0 rows',
    });
    expect(message).not.toMatch(/JSON|rows/i);
    expect(message).toMatch(/no longer in your library/i);
  });

  it('keeps any other database message, which is the useful line', () => {
    expect(
      describeFinishError({ code: '42501', message: 'permission denied for table stories' }),
    ).toBe('permission denied for table stories');
  });

  it('has something to say about a thrown thing with no message at all', () => {
    expect(describeFinishError(undefined)).toMatch(/could not be saved/i);
  });
});
