import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { streamText } from 'ai';

import { getAuthenticatedUser, createServiceClient } from '../_shared/auth.ts';
import { corsHeaders, errorResponse } from '../_shared/cors.ts';
import { buildTutorSystem } from '../_shared/prompts.ts';
import { MODEL_IDS, vuk } from '../_shared/provider.ts';
import { extractUsage, logUsage } from '../_shared/usage.ts';

interface TutorRequest {
  messages?: { role: 'user' | 'assistant'; content: string }[];
  learnerState?: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return errorResponse(401, 'unauthorized');

  let body: TutorRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid_json');
  }

  const messages = body.messages ?? [];
  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse(400, 'messages_required');
  }

  // The TypeScript type on `role` constrains nothing at runtime. Without this
  // check an authenticated caller could send role:'system' and append their own
  // instructions after the persona, overriding it. Rejecting (rather than
  // silently dropping) surfaces a malformed client instead of quietly changing
  // the conversation the user thinks they sent.
  const isValidTurn = (m: unknown): boolean => {
    if (typeof m !== 'object' || m === null) return false;
    const { role, content } = m as { role?: unknown; content?: unknown };
    return (role === 'user' || role === 'assistant') && typeof content === 'string';
  };

  if (!messages.every(isValidTurn)) {
    return errorResponse(400, 'invalid_message');
  }

  const serviceClient = createServiceClient();

  try {
    // The client owns truncation — it knows which turns are still on screen —
    // so the history arrives ready to send.
    const result = await streamText({
      model: vuk('chat'),
      system: buildTutorSystem(body.learnerState),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      maxTokens: 700,
      // Once the response object is handed back the stream owns its own errors:
      // a provider failure mid-stream ends the body silently, so without this
      // the user sees an empty reply and the logs show nothing at all.
      onError: ({ error }) => {
        console.error('[tutor] stream failed', error);
      },
      onFinish: ({ usage }) => {
        logUsage(serviceClient, {
          userId: user.id,
          surface: 'tutor',
          model: MODEL_IDS.chat,
          usage: extractUsage({ usage }),
        });
      },
    });

    // Plain text stream: the client appends chunks straight to the bubble, no
    // SSE framing to parse.
    return result.toTextStreamResponse({ headers: corsHeaders });
  } catch (error) {
    console.error('[tutor] provider call failed', error);
    return errorResponse(502, 'provider_error');
  }
});
