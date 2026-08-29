import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  TUTOR_SYSTEM,
  buildExamplePrompt,
  buildNewCardPrompt,
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
    expect(TUTOR_SYSTEM).toMatch(/emoji/i);
    expect(TUTOR_SYSTEM).toMatch(/never/i);
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
