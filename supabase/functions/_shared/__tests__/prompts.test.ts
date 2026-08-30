import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  TUTOR_SYSTEM,
  buildExamplePrompt,
  buildGlossPrompt,
  buildNewCardPrompt,
  buildStoryPrompt,
  buildTutorSystem,
  CARD_DOMAINS,
} from '../prompts';

/**
 * These are voice/behaviour guardrails, not implementation details. The tutor
 * persona is the product: if one of these assertions starts failing because
 * someone reworded the prompt, that is exactly the review conversation the test
 * exists to force. Reword the assertion only together with a deliberate
 * decision to change how the tutor behaves.
 */
describe('TUTOR_SYSTEM invariants', () => {
  it('instructs Serbian-first replies written in Cyrillic', () => {
    expect(TUTOR_SYSTEM).toMatch(/Serbian first/i);
    expect(TUTOR_SYSTEM).toMatch(/Cyrillic/);
  });

  it('requires Latin and English help lines under the Serbian', () => {
    expect(TUTOR_SYSTEM).toMatch(/Latin/);
    expect(TUTOR_SYSTEM).toMatch(/English/);
    // The three-line shape must be spelled out, not merely implied.
    expect(TUTOR_SYSTEM).toMatch(/SR:/);
    expect(TUTOR_SYSTEM).toMatch(/LAT:/);
    expect(TUTOR_SYSTEM).toMatch(/EN:/);
  });

  it('mandates Ekavian and says so literally', () => {
    expect(TUTOR_SYSTEM).toContain('Ekavian');
    // Ijekavian is the variant to avoid; naming it prevents drift.
    expect(TUTOR_SYSTEM).toMatch(/Ijekavian/);
  });

  it('caps corrections at one short grammar note per reply', () => {
    expect(TUTOR_SYSTEM).toMatch(/at most one short grammar note/i);
    expect(TUTOR_SYSTEM).toMatch(/per reply/i);
  });

  it('caps reply length at 2-4 Serbian sentences', () => {
    expect(TUTOR_SYSTEM).toMatch(/2[-–]4 Serbian sentences/);
  });

  it('prefers family and home topics', () => {
    expect(TUTOR_SYSTEM).toMatch(/family/i);
    expect(TUTOR_SYSTEM).toMatch(/home/i);
    expect(TUTOR_SYSTEM).toMatch(/baby/i);
  });

  it('bans boilerplate openers and emoji', () => {
    expect(TUTOR_SYSTEM).toContain('Great question');
    // Assert the binding phrase, not merely that the words appear: a bare
    // /never/i matched elsewhere in the prompt, so the ban could have been
    // softened to "try to avoid emoji" with the test still green.
    expect(TUTOR_SYSTEM).toMatch(/Never use emoji/);
    expect(TUTOR_SYSTEM).toMatch(/Never open with filler/);
  });

  it('defines the DODAJ add-word convention with its exact line format', () => {
    expect(TUTOR_SYSTEM).toContain('DODAJ: <cyrillic> = <english>');
    // The client parses these off the tail of the message, so "at the end"
    // is load-bearing, not stylistic.
    expect(TUTOR_SYSTEM).toMatch(/end of (?:the|your) message/i);
  });

  it('does not itself contain emoji (it would model the banned behaviour)', () => {
    expect(TUTOR_SYSTEM).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('buildTutorSystem', () => {
  it('returns the stable persona verbatim when there is no learner state', () => {
    expect(buildTutorSystem()).toBe(TUTOR_SYSTEM);
    expect(buildTutorSystem(undefined)).toBe(TUTOR_SYSTEM);
    expect(buildTutorSystem('')).toBe(TUTOR_SYSTEM);
    expect(buildTutorSystem('   ')).toBe(TUTOR_SYSTEM);
  });

  it('appends learner state AFTER the stable persona (cache-friendly ordering)', () => {
    const state = 'Due today: мама, тата. Struggling with: locative case.';
    const built = buildTutorSystem(state);

    // Prompt caching only pays off when the stable prefix is byte-identical
    // across calls, so the persona must come first, unmodified.
    expect(built.startsWith(TUTOR_SYSTEM)).toBe(true);
    expect(built).toContain(state);
    expect(built.indexOf(state)).toBeGreaterThan(TUTOR_SYSTEM.length - 1);
  });

  it('labels the appended block so the model knows it is volatile context', () => {
    const built = buildTutorSystem('Due today: мама');
    expect(built.slice(TUTOR_SYSTEM.length)).toMatch(/learner/i);
  });
});

describe('buildExamplePrompt', () => {
  it('embeds the word and demands Ekavian Cyrillic', () => {
    const prompt = buildExamplePrompt('беба');
    expect(prompt).toContain('беба');
    expect(prompt).toContain('Ekavian');
    expect(prompt).toContain('Cyrillic');
  });

  it('asks for a short, everyday sentence plus its English translation', () => {
    const prompt = buildExamplePrompt('беба');
    expect(prompt).toMatch(/English/);
    expect(prompt).toMatch(/example_cyr/);
    expect(prompt).toMatch(/example_en/);
  });
});

describe('buildNewCardPrompt', () => {
  it('embeds the learner input and demands Ekavian Cyrillic-only output', () => {
    const prompt = buildNewCardPrompt('baby bottle');
    expect(prompt).toContain('baby bottle');
    expect(prompt).toContain('Ekavian');
    expect(prompt).toMatch(/Cyrillic only|only Cyrillic/i);
    expect(prompt).toMatch(/no Latin/i);
  });

  it('constrains the grammatical fields the card carries', () => {
    const prompt = buildNewCardPrompt('baby bottle');
    expect(prompt).toMatch(/gender/i);
    expect(prompt).toMatch(/aspect/i);
    expect(prompt).toMatch(/impf/);
    expect(prompt).toMatch(/pf/);
  });

  it('lists the allowed domains so the card slots into the existing deck', () => {
    const prompt = buildNewCardPrompt('baby bottle');
    for (const domain of CARD_DOMAINS) {
      expect(prompt).toContain(domain);
    }
  });

  it('accepts either an English word or a Serbian one', () => {
    expect(buildNewCardPrompt('пелена')).toContain('пелена');
  });
});

/**
 * The story prompt IS the graded reader. Every assertion here is a product
 * promise: Ekavian Cyrillic a beginner can actually decode, at a difficulty
 * pinned to his level, built out of words he already owns. The level bands are
 * asserted both ways round — each level carries its own band and *not* another
 * level's — because a copy-paste slip between bands would otherwise hand a
 * level-1 learner a 250-word story and no test would notice.
 */
describe('buildStoryPrompt', () => {
  const KNOWN = ['мама', 'тата', 'беба', 'кућа', 'мачка'];

  it('mandates Ekavian and says so literally', () => {
    const prompt = buildStoryPrompt(1, KNOWN);
    expect(prompt).toContain('Ekavian');
    expect(prompt).toMatch(/Ijekavian/);
  });

  it('demands Cyrillic-only output in both fields', () => {
    const prompt = buildStoryPrompt(2, KNOWN);
    expect(prompt).toMatch(/Cyrillic only|only Cyrillic/i);
    expect(prompt).toMatch(/no Latin/i);
    expect(prompt).toMatch(/title_cyr/);
    expect(prompt).toMatch(/body_cyr/);
  });

  it("asks for a children's-story register", () => {
    const prompt = buildStoryPrompt(1, KNOWN);
    expect(prompt).toMatch(/children's stor/i);
  });

  it('gives level 1 its own band and no other level\'s', () => {
    const prompt = buildStoryPrompt(1, KNOWN);
    expect(prompt).toContain('40 to 80');
    expect(prompt).toContain('6 words');
    expect(prompt).not.toContain('80 to 150');
    expect(prompt).not.toContain('150 to 250');
  });

  it('gives level 2 its own band and no other level\'s', () => {
    const prompt = buildStoryPrompt(2, KNOWN);
    expect(prompt).toContain('80 to 150');
    expect(prompt).toContain('9 words');
    expect(prompt).not.toContain('40 to 80');
    expect(prompt).not.toContain('150 to 250');
  });

  it('gives level 3 its own band and no other level\'s', () => {
    const prompt = buildStoryPrompt(3, KNOWN);
    expect(prompt).toContain('150 to 250');
    expect(prompt).not.toContain('40 to 80');
    expect(prompt).not.toContain('80 to 150');
  });

  it('constrains tense at level 1 only', () => {
    expect(buildStoryPrompt(1, KNOWN)).toMatch(/present tense/i);
    expect(buildStoryPrompt(3, KNOWN)).not.toMatch(/present tense/i);
  });

  it('passes the known words through with the ~10% new-vocabulary cap', () => {
    const prompt = buildStoryPrompt(1, KNOWN);
    for (const word of KNOWN) expect(prompt).toContain(word);
    // The cap is what keeps a "graded" reader graded.
    expect(prompt).toMatch(/10%/);
    expect(prompt).toMatch(/new (?:vocabulary|words)/i);
  });

  it('still produces a usable prompt when the learner knows no words yet', () => {
    const prompt = buildStoryPrompt(1, []);
    expect(prompt).toContain('40 to 80');
    expect(prompt).toContain('Ekavian');
    // No dangling "known words:" header with nothing under it.
    expect(prompt).not.toMatch(/known words:\s*$/im);
  });

  it('passes an explicit topic through and falls back to home topics without one', () => {
    expect(buildStoryPrompt(1, KNOWN, 'a cat at the market')).toContain('a cat at the market');
    const untopiced = buildStoryPrompt(1, KNOWN);
    expect(untopiced).toMatch(/family/i);
    expect(untopiced).toMatch(/home/i);
    expect(untopiced).toMatch(/animals/i);
  });

  it('ignores a blank topic rather than asking for a story about nothing', () => {
    expect(buildStoryPrompt(1, KNOWN, '   ')).toBe(buildStoryPrompt(1, KNOWN));
  });
});

describe('buildGlossPrompt', () => {
  it('embeds the tapped word and the sentence it was tapped in', () => {
    const prompt = buildGlossPrompt('мачку', 'Видим мачку у башти.');
    expect(prompt).toContain('мачку');
    expect(prompt).toContain('Видим мачку у башти.');
  });

  it('asks for the dictionary form in Cyrillic only', () => {
    const prompt = buildGlossPrompt('мачку', 'Видим мачку у башти.');
    expect(prompt).toMatch(/dictionary form/i);
    expect(prompt).toMatch(/base_form_cyr/);
    expect(prompt).toMatch(/Cyrillic only|only Cyrillic/i);
    expect(prompt).toMatch(/no Latin/i);
    expect(prompt).toContain('Ekavian');
  });

  it('caps the grammar note at one short line', () => {
    const prompt = buildGlossPrompt('мачку', 'Видим мачку у башти.');
    expect(prompt).toMatch(/\bnote\b/);
    expect(prompt).toMatch(/one (?:short )?(?:line|sentence)/i);
  });
});

describe('prompts.ts portability', () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts.ts'),
    'utf8',
  );

  // This module is imported by both Deno (Edge Functions) and Node (vitest),
  // so it must stay zero-dependency and runtime-neutral.
  it('has no imports at all', () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it('references no Deno or Node globals', () => {
    expect(source).not.toMatch(/\bDeno\./);
    expect(source).not.toMatch(/\bprocess\./);
    expect(source).not.toMatch(/npm:/);
  });
});
