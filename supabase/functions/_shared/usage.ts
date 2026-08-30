import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Per-token pricing, USD per 1M tokens. OpenAI models are deliberately absent:
 * this instance runs on Anthropic in production, and an unknown model logs a
 * cost of 0 rather than a wrong number.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
}

/** Cost in cents (USD x 100). Unpriced models return 0. */
export function costCents(model: string, usage: UsageSnapshot): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  return (
    ((usage.inputTokens * pricing.input) / 1_000_000 +
      (usage.outputTokens * pricing.output) / 1_000_000) *
    100
  );
}

// AI SDK v4 result shape (pinned in deno.json): promptTokens / completionTokens.
interface AIUsageResult {
  usage?: { promptTokens?: number; completionTokens?: number };
}

export function extractUsage(result: AIUsageResult): UsageSnapshot {
  return {
    inputTokens: result.usage?.promptTokens ?? 0,
    outputTokens: result.usage?.completionTokens ?? 0,
  };
}

export type Surface = 'tutor' | 'example' | 'new_card' | 'gloss' | 'story';

interface LogUsageInput {
  userId: string;
  surface: Surface;
  model: string;
  usage: UsageSnapshot;
}

/**
 * Writes one ai_usage row. Fire-and-forget: never blocks or fails the user's
 * response, but insert errors are logged — silently losing cost data is a bug
 * we would otherwise only notice at the end of a billing month.
 */
export function logUsage(
  serviceClient: SupabaseClient,
  { userId, surface, model, usage }: LogUsageInput,
): void {
  serviceClient
    .from('ai_usage')
    .insert({
      user_id: userId,
      surface,
      model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cost_cents: costCents(model, usage),
    })
    // Two-argument `then`: Postgrest reports query failures in `error`, but a
    // transport failure rejects, and an unhandled rejection would take down the
    // isolate over a logging write. (The builder is typed PromiseLike, so
    // `.catch` is not available to chain.)
    .then(
      ({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.error('[ai_usage] insert failed', {
            userId,
            surface,
            model,
            error: error.message,
          });
        }
      },
      (error: unknown) => {
        console.error('[ai_usage] insert threw', { userId, surface, model, error });
      },
    );
}
