import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { gatewayWiringView, resolveGatewayEndpoints } from '@/lib/gateway-endpoints';
import { safeRouterView } from '@/lib/litellm';

export const dynamic = 'force-dynamic';

// ── GET /api/v1/gateway/router ──────────────────────────────────────────────────
// The LiteLLM Proxy router that sits behind the gateway's GATEWAY_URL seam — the professional
// load-balancer / failover / budget layer replacing the hand-rolled aggregator. This surfaces the
// router's LIVE view: every deployment (fleet node + cloud) with per-deployment health, and the
// enforced key budgets. Admin-only (it can reveal deployment topology). Graceful by construction:
// when OFFGRID_LITELLM_URL is unset the adapter returns configured:false and the UI shows the honest
// "not wired yet" state; when the proxy is unreachable it returns live:false — never a 500 into the page.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const view = await safeRouterView();
  return NextResponse.json({ ...view, wiring: gatewayWiringView(resolveGatewayEndpoints()) });
}
