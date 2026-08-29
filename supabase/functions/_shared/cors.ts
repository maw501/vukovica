// Shared CORS headers. The app is served from Expo web / the native shell, so
// there is no fixed origin worth pinning to for a single-user MVP.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

/** JSON error response with CORS headers attached. */
export function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: jsonHeaders });
}
