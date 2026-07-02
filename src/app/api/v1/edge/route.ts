import { getEdgeSnapshot } from '@/lib/edge-log';

// Edge status for the console: live WAF + rate-limit policy and recent blocks,
// read from the Caddy access log + Caddyfile on the same host.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json(await getEdgeSnapshot());
}
