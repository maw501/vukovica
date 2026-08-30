import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { generateObject } from 'ai';
import { z } from 'zod';

import { getAuthenticatedUser, createServiceClient } from '../_shared/auth.ts';
import { corsHeaders, errorResponse, jsonHeaders } from '../_shared/cors.ts';
import { CYRILLIC_LINE } from '../_shared/cyrillic.ts';
import {
  CARD_DOMAINS,
  buildExamplePrompt,
  buildGlossPrompt,
  buildNewCardPrompt,
} from '../_shared/prompts.ts';
import { MODEL_IDS, vuk } from '../_shared/provider.ts';
import { extractUsage, logUsage } from '../_shared/usage.ts';

const ExampleSchema = z.object({
  example_cyr: z.string(),
  example_en: z.string(),
});

// The reader's tap-to-gloss sheet. `base_form_cyr` seeds the new_card flow, so
// a Latin-script or transliterated base form would head a card with the wrong
// script entirely -- the regex makes that a rejected generation, not a bad card.
const GlossSchema = z.object({
  base_form_cyr: z.string().regex(CYRILLIC_LINE),
  en: z.string(),
  note: z.string(),
});

// Mirrors public.cards minus the server-owned columns (id, audio_path,
// created_by, created_at). Task 7 inserts this object as-is.
const CardSchema = z.object({
  sr_cyr: z.string(),
  en: z.string(),
  pos: z.enum(['noun', 'verb', 'adjective', 'adverb', 'number', 'interjection', 'phrase']),
  gender: z.enum(['m', 'f', 'n']).nullable(),
  aspect: z.enum(['impf', 'pf']).nullable(),
  example_cyr: z.string(),
  example_en: z.string(),
  domain: z.enum(CARD_DOMAINS as unknown as [string, ...string[]]),
});

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return errorResponse(401, 'unauthorized');

  let body: { mode?: string; sr_cyr?: string; input?: string; word?: string; sentence?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid_json');
  }

  const mode = body.mode;
  if (mode !== 'example' && mode !== 'new_card' && mode !== 'gloss') {
    return errorResponse(400, 'invalid_mode');
  }

  // Each mode's own required inputs. Trimmed here so an all-whitespace field is
  // a 400 rather than a prompt asking about nothing.
  let word = '';
  let sentence = '';
  let subject = '';
  if (mode === 'gloss') {
    word = body.word?.trim() ?? '';
    if (!word) return errorResponse(400, 'word_required');
    sentence = body.sentence?.trim() ?? '';
    if (!sentence) return errorResponse(400, 'sentence_required');
  } else {
    subject = (mode === 'example' ? body.sr_cyr : body.input)?.trim() ?? '';
    if (!subject) {
      return errorResponse(400, mode === 'example' ? 'sr_cyr_required' : 'input_required');
    }
  }

  const serviceClient = createServiceClient();

  try {
    // All three modes are one small structured generation on the fast model.
    // Spelled out per mode rather than shared: the schema type is what makes
    // `result.object` typed, and hoisting it out erases that.
    const result =
      mode === 'example'
        ? await generateObject({
            model: vuk('fast'),
            schema: ExampleSchema,
            prompt: buildExamplePrompt(subject),
            maxTokens: 400,
          })
        : mode === 'new_card'
          ? await generateObject({
              model: vuk('fast'),
              schema: CardSchema,
              prompt: buildNewCardPrompt(subject),
              maxTokens: 500,
            })
          : await generateObject({
              model: vuk('fast'),
              schema: GlossSchema,
              prompt: buildGlossPrompt(word, sentence),
              maxTokens: 400,
            });

    logUsage(serviceClient, {
      userId: user.id,
      surface: mode,
      model: MODEL_IDS.fast,
      usage: extractUsage(result),
    });

    return new Response(JSON.stringify(result.object), { headers: jsonHeaders });
  } catch (error) {
    console.error('[generate] provider call failed', error);
    return errorResponse(502, 'provider_error');
  }
});
