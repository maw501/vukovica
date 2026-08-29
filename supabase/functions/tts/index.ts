import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

import { createServiceClient, getAuthenticatedUser } from '../_shared/auth.ts';
import { corsHeaders, errorResponse, jsonHeaders } from '../_shared/cors.ts';

const BUCKET = 'audio';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Public URL for a cached clip.
 *
 * Built by hand rather than via getPublicUrl(): inside the Edge runtime
 * SUPABASE_URL points at the internal gateway (http://kong:8000 locally), which
 * the phone cannot reach. PUBLIC_SUPABASE_URL overrides it for local dev.
 */
function publicUrl(name: string): string {
  const base = (
    Deno.env.get('PUBLIC_SUPABASE_URL') ||
    Deno.env.get('SUPABASE_URL') ||
    ''
  ).replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${BUCKET}/${name}`;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return errorResponse(401, 'unauthorized');

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid_json');
  }

  const text = body.text?.trim();
  if (!text) return errorResponse(400, 'text_required');

  const serviceClient = createServiceClient();
  const name = `${await sha256Hex(text)}.mp3`;

  // Cache hit: the same sentence is spoken on every review of a card, so this
  // is the common path once a card has been seen once.
  const { data: existing } = await serviceClient.storage
    .from(BUCKET)
    .list('', { limit: 1, search: name });
  if (existing?.some((f: { name: string }) => f.name === name)) {
    return new Response(JSON.stringify({ url: publicUrl(name) }), { headers: jsonHeaders });
  }

  // No key configured: a null url is a valid answer, and the client just hides
  // the play button rather than showing an error.
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ url: null }), { headers: jsonHeaders });
  }

  // Defaults to OpenAI proper; overridable so the same code can be pointed at a
  // gateway or a local mock.
  const baseUrl = (Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(
    /\/+$/,
    '',
  );

  try {
    const speech = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('TTS_MODEL') || 'gpt-4o-mini-tts',
        voice: Deno.env.get('TTS_VOICE') || 'alloy',
        input: text,
        response_format: 'mp3',
      }),
    });

    if (!speech.ok) {
      console.error('[tts] openai failed', speech.status, await speech.text());
      return errorResponse(502, 'tts_error');
    }

    const { error: uploadError } = await serviceClient.storage
      .from(BUCKET)
      .upload(name, await speech.arrayBuffer(), { contentType: 'audio/mpeg', upsert: true });

    if (uploadError) {
      console.error('[tts] upload failed', uploadError.message);
      return errorResponse(502, 'tts_error');
    }

    return new Response(JSON.stringify({ url: publicUrl(name) }), { headers: jsonHeaders });
  } catch (error) {
    console.error('[tts] failed', error);
    return errorResponse(502, 'tts_error');
  }
});
