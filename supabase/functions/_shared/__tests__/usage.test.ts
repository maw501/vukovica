import { describe, expect, it } from 'vitest';

import { costCents } from '../usage';

/**
 * Cost math is invisible until the bill arrives, so the rates are pinned here.
 * Rates (USD per 1M tokens): sonnet-5 $2 in / $10 out, haiku-4-5 $1 in / $5 out.
 */
describe('costCents', () => {
  it('prices claude-sonnet-5 at $2/MTok in, $10/MTok out', () => {
    // 1M in + 1M out = $2 + $10 = $12 = 1200 cents.
    expect(costCents('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(
      1200,
    );
  });

  it('prices claude-haiku-4-5 at $1/MTok in, $5/MTok out', () => {
    expect(costCents('claude-haiku-4-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(
      600,
    );
  });

  it('scales linearly for realistic token counts', () => {
    // 10k in, 1k out on sonnet-5: (10_000 * 2 + 1_000 * 10) / 1e6 USD = $0.03.
    expect(
      costCents('claude-sonnet-5', { inputTokens: 10_000, outputTokens: 1_000 }),
    ).toBeCloseTo(3, 10);
  });

  it('returns 0 for OpenAI models, which are unpriced here', () => {
    expect(costCents('gpt-4o', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0);
    expect(costCents('gpt-4o-mini', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0);
  });

  it('returns 0 rather than guessing for an unknown model', () => {
    expect(costCents('some-future-model', { inputTokens: 500, outputTokens: 500 })).toBe(0);
  });

  it('is zero at zero usage', () => {
    expect(costCents('claude-sonnet-5', { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});
