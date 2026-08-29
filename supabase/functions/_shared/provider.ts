import { customProvider } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

/**
 * Semantic model aliases. Swapping providers is a change to this file plus the
 * `AI_PROVIDER` env var — no call site names a concrete model.
 *
 *   chat -> conversational tutor replies (streamed)
 *   fast -> structured generation (example sentences, new cards)
 */
export type ModelAlias = 'chat' | 'fast';

const PROVIDER = (Deno.env.get('AI_PROVIDER') ?? 'anthropic').toLowerCase();

const DEFAULTS: Record<string, { chat: string; fast: string }> = {
  anthropic: { chat: 'claude-sonnet-5', fast: 'claude-haiku-4-5' },
  openai: { chat: 'gpt-4o', fast: 'gpt-4o-mini' },
};

const defaults = DEFAULTS[PROVIDER] ?? DEFAULTS['anthropic'];

/** Concrete model ids in force for this deployment. Used for usage logging. */
export const MODEL_IDS: Record<ModelAlias, string> = {
  chat: Deno.env.get('AI_CHAT_MODEL') || defaults.chat,
  fast: Deno.env.get('AI_FAST_MODEL') || defaults.fast,
};

/**
 * Base URLs are overridable so the functions can be pointed at a gateway or a
 * local mock. The SDK's default provider instances ignore the corresponding env
 * vars, so they are read and passed explicitly. Unset = the provider's own API.
 */
function buildModels() {
  if (PROVIDER === 'openai') {
    const openai = createOpenAI({
      apiKey: Deno.env.get('OPENAI_API_KEY') ?? '',
      baseURL: Deno.env.get('OPENAI_BASE_URL') || undefined,
      // The proxy shape below is OpenAI-compatible, not OpenAI itself.
      compatibility: Deno.env.get('OPENAI_BASE_URL') ? 'compatible' : 'strict',
    });
    return { chat: openai(MODEL_IDS.chat), fast: openai(MODEL_IDS.fast) };
  }

  const anthropic = createAnthropic({
    apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '',
    baseURL: Deno.env.get('ANTHROPIC_BASE_URL') || undefined,
  });
  return { chat: anthropic(MODEL_IDS.chat), fast: anthropic(MODEL_IDS.fast) };
}

const provider = customProvider({ languageModels: buildModels() });

/**
 * `customProvider` returns a provider object, not a callable — wrapping it here
 * keeps call sites reading as `vuk('fast')`.
 */
export const vuk = (alias: ModelAlias) => provider.languageModel(alias);
