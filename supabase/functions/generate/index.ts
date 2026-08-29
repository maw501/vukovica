import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { generateObject } from 'ai';
import { z } from 'zod';

import { getAuthenticatedUser, createServiceClient } from '../_shared/auth.ts';
import { corsHeaders, errorResponse, jsonHeaders } from '../_shared/cors.ts';
import { CARD_DOMAINS, buildExamplePrompt, buildNewCardPrompt } from '../_shared/prompts.ts';
import { MODEL_IDS, vuk } from '../_shared/provider.ts';
import { extractUsage, logUsage } from '../_shared/usage.ts';

const ExampleSchema = z.object({
  example_cyr: z.string(),
  example_en: z.string(),
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

  let body: { mode?: string; sr_cyr?: string; input?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid_json');
  }

  const isExample = body.mode === 'example';
  if (!isExample && body.mode !== 'new_card') {
    return errorResponse(400, 'invalid_mode');
  }

  const subject = (isExample ? body.sr_cyr : body.input)?.trim();
  if (!subject) {
    return errorResponse(400, isExample ? 'sr_cyr_required' : 'input_required');
  }

  const serviceClient = createServiceClient();

  try {
    const result = isExample
      ? await generateObject({
          model: vuk('fast'),
          schema: ExampleSchema,
          prompt: buildExamplePrompt(subject),
          maxTokens: 400,
        })
      : await generateObject({
          model: vuk('fast'),
          schema: CardSchema,
          prompt: buildNewCardPrompt(subject),
          maxTokens: 500,
        });

    logUsage(serviceClient, {
      userId: user.id,
      surface: isExample ? 'example' : 'new_card',
      model: MODEL_IDS.fast,
      usage: extractUsage(result),
    });

    return new Response(JSON.stringify(result.object), { headers: jsonHeaders });
  } catch (error) {
    console.error('[generate] provider call failed', error);
    return errorResponse(502, 'provider_error');
  }
});
