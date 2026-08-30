import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { generateObject } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { createServiceClient, getAuthenticatedUser } from '../_shared/auth.ts';
import { corsHeaders, errorResponse, jsonHeaders } from '../_shared/cors.ts';
import { isCyrillicLine, isCyrillicProse } from '../_shared/cyrillic.ts';
import { buildStoryPrompt, type StoryLevel } from '../_shared/prompts.ts';
import { MODEL_IDS, vuk } from '../_shared/provider.ts';
import { extractUsage, logUsage } from '../_shared/usage.ts';

const StorySchema = z.object({
  title_cyr: z.string(),
  body_cyr: z.string(),
});

/**
 * How many known words the prompt may carry. The cap is about prompt size and
 * the model's ability to actually hold a word list in mind — past a couple of
 * hundred it stops steering and starts padding.
 */
const SAMPLE_SIZE = 120;

/**
 * How many known words to draw the sample FROM. Once the learner knows more
 * words than fit in a prompt, taking the first 120 every time would generate
 * the same story about the same five nouns forever, so we pull a wider set and
 * sample it. Bounded so the query stays one small round trip.
 */
const SAMPLE_POOL = 500;

/** Words a story is worth: whitespace-split, the same way a reader counts. */
function countWords(body: string): number {
  return body.trim().split(/\s+/).filter(Boolean).length;
}

/** Fisher-Yates, truncated: `size` distinct items, uniformly drawn. */
function sample(words: string[], size: number): string[] {
  const pool = [...words];
  const take = Math.min(size, pool.length);
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take);
}

/**
 * The learner's graduated vocabulary — `user_cards.state = 'review'`, which is
 * this app's definition of "known" (spec §2, Речи). Read with the service role
 * but filtered to this user explicitly; never blocks story generation, because
 * a story from common words beats no story at all.
 */
async function fetchKnownWords(client: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await client
    .from('user_cards')
    .select('cards(sr_cyr)')
    .eq('user_id', userId)
    .eq('state', 'review')
    .limit(SAMPLE_POOL);

  if (error) {
    console.error('[story] known-words lookup failed', error.message);
    return [];
  }

  const words = (data ?? [])
    // PostgREST embeds a to-one relation as an object, but returns an array
    // when it cannot prove the cardinality; accept both rather than silently
    // producing an empty vocabulary.
    .flatMap((row: { cards: { sr_cyr?: string } | { sr_cyr?: string }[] | null }) =>
      Array.isArray(row.cards) ? row.cards : row.cards ? [row.cards] : [],
    )
    .map((card: { sr_cyr?: string }) => card.sr_cyr?.trim())
    .filter((word: string | undefined): word is string => Boolean(word));

  return sample(words, SAMPLE_SIZE);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return errorResponse(401, 'unauthorized');

  let body: { level?: unknown; topic?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid_json');
  }

  if (body.level !== 1 && body.level !== 2 && body.level !== 3) {
    return errorResponse(400, 'invalid_level');
  }
  const level = body.level as StoryLevel;

  if (body.topic !== undefined && typeof body.topic !== 'string') {
    return errorResponse(400, 'invalid_topic');
  }
  const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, 200) : undefined;

  const serviceClient = createServiceClient();
  const knownWords = await fetchKnownWords(serviceClient, user.id);

  let title: string;
  let text: string;
  try {
    const result = await generateObject({
      model: vuk('chat'),
      schema: StorySchema,
      prompt: buildStoryPrompt(level, knownWords, topic),
      maxTokens: 2500,
    });

    logUsage(serviceClient, {
      userId: user.id,
      surface: 'story',
      model: MODEL_IDS.chat,
      usage: extractUsage(result),
    });

    title = result.object.title_cyr.trim();
    text = result.object.body_cyr.trim();
  } catch (error) {
    console.error('[story] provider call failed', error);
    return errorResponse(502, 'provider_error');
  }

  // The whole point of the reader is decoding Cyrillic, so a story carrying a
  // Latin letter is not a slightly imperfect story -- it is a broken one, and it
  // must never reach the library. Validated BEFORE the insert: nothing is
  // written when this fails.
  if (!isCyrillicLine(title) || !isCyrillicProse(text)) {
    console.error('[story] model returned non-Cyrillic output; nothing inserted', {
      userId: user.id,
      level,
      titleOk: isCyrillicLine(title),
      bodyOk: isCyrillicProse(text),
    });
    return errorResponse(502, 'invalid_story');
  }

  // Length bands are steered by the prompt, not enforced here (spec §3.2): a
  // story that is ten words long is still readable, and throwing away a good
  // story over a word or two would cost a model call for nothing.
  const { data, error } = await serviceClient
    .from('stories')
    .insert({
      user_id: user.id,
      title_cyr: title,
      body_cyr: text,
      level,
      word_count: countWords(text),
    })
    .select('id, title_cyr, body_cyr, level, word_count, created_at, finished_at')
    .single();

  if (error || !data) {
    console.error('[story] insert failed', error?.message);
    return errorResponse(500, 'insert_failed');
  }

  return new Response(JSON.stringify(data), { headers: jsonHeaders });
});
