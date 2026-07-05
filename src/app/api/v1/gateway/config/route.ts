import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { gatewayFetch, shapeGatewayTuning, type AggregatorConfig } from '@/lib/gateway';

export const dynamic = 'force-dynamic';

// ── GET /api/v1/gateway/config ────────────────────────────────────────────────
// READ-ONLY runtime TUNING of the cluster aggregator. The aggregator exposes its
// live tuning knobs at GET /config (routing/health/timeouts + honest capability
// flags), but they are all env-set in its launchd plist on S1 and require a restart
// to change — there is no live-reconfigure endpoint. So this route only reads and
// shapes them (via the pure `shapeGatewayTuning`); it does NOT offer a write path,
// because faking an editable control the aggregator can't honour would be dishonest.
//
// Rate-limiting / WAF is the Caddy edge's job (+ the console middleware's 60/min
// per-IP layer) by design, and the router has no response cache / per-request
// fallback chain — all reflected in the capability flags, not as editable fields.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let raw: AggregatorConfig | null = null;
  try {
    const r = await gatewayFetch('/config', {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    if (r.ok) raw = (await r.json()) as AggregatorConfig;
  } catch {
    /* aggregator offline / older build without /config — surface as unavailable */
  }

  return NextResponse.json({
    available: raw !== null,
    tuning: shapeGatewayTuning(raw),
  });
}
