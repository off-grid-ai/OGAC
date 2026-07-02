// Single source of truth for reaching the Off Grid AI Gateway (the OpenAI-compatible
// cluster aggregator). The aggregator authenticates /v1/* with a static API key
// (OFFGRID_GATEWAY_API_KEY) sent as `x-api-key`. Every server-side call to the gateway
// must go through gatewayHeaders() so the key is attached — without it the aggregator
// returns 401 and the console shows "no models" / empty responses.
export const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

const GATEWAY_API_KEY = process.env.OFFGRID_GATEWAY_API_KEY ?? '';

/** Headers for a gateway call — attaches the API key when configured, plus any extras. */
export function gatewayHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...(GATEWAY_API_KEY ? { 'x-api-key': GATEWAY_API_KEY } : {}),
    ...extra,
  };
}
