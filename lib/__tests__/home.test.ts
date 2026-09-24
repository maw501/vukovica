import { describe, expect, it } from 'vitest';

import {
  LETTERS_DONE_LINK,
  lettersLeading,
  lettersProgressLine,
  myWordsLine,
  PRACTISE_LINE,
} from '@/lib/home';
import { LETTER_TOTAL } from '@/lib/stages';

describe('lettersLeading', () => {
  it('leads with the letters until all thirty are learned', () => {
    expect(lettersLeading(0)).toBe(true);
    expect(lettersLeading(LETTER_TOTAL - 1)).toBe(true);
    expect(lettersLeading(LETTER_TOTAL)).toBe(false);
  });

  it('treats an unknown count as still learning, so a beginner never loses the card', () => {
    expect(lettersLeading(null)).toBe(true);
    expect(lettersLeading(undefined)).toBe(true);
    expect(lettersLeading(Number.NaN)).toBe(true);
  });
});

describe('lettersProgressLine', () => {
  it('says how many of the thirty are learned', () => {
    expect(lettersProgressLine(12)).toBe('12 of 30 learned');
  });

  it('says what the job is before any are learned, not "0 of 30"', () => {
    expect(lettersProgressLine(0)).toBe('30 letters to learn');
    expect(lettersProgressLine(-3)).toBe('30 letters to learn');
  });

  it('caps at the alphabet', () => {
    expect(lettersProgressLine(30)).toBe('All 30 learned');
    expect(lettersProgressLine(31)).toBe('All 30 learned');
  });

  it('matches the wording of the collapsed link', () => {
    expect(LETTERS_DONE_LINK).toBe('Letters — all 30 learned');
  });
});

describe('PRACTISE_LINE', () => {
  it('says what practising is, and never that anything is waiting', () => {
    expect(PRACTISE_LINE).toBe('Read, write or say what words mean');
    expect(PRACTISE_LINE.toLowerCase()).not.toMatch(/waiting|due|today/);
  });
});

describe('myWordsLine', () => {
  it('leads with the first job when nothing is known yet', () => {
    expect(myWordsLine(0)).toBe('Tick the words you already know');
    expect(myWordsLine(null)).toBe('Tick the words you already know');
  });

  it('counts the words known', () => {
    expect(myWordsLine(1)).toBe('1 word known');
    expect(myWordsLine(42)).toBe('42 words known');
  });
});
