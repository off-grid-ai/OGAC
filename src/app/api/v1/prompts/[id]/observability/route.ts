import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/authz';
import { getPrompt } from '@/lib/prompts';
import {
  buildPromptAggsQuery,
  emptyPromptObservability,
  parsePromptAggsResponse,
} from '@/lib/prompt-observability';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Per-prompt observability — real per-version performance metrics (runs, p50/p95 latency, token usage,
// gateway block/fail rate, daily run series) rolled up from ACTUAL run telemetry. The metric SOURCE is
// the same OpenSearch `offgrid-gateway` index the analytics/usage views read; prompt runs are tagged at
// the Playground emit path via the `x-offgrid-run` header (→ `corrId` on the doc) and rolled up here by
// the pure aggregation in src/lib/prompt-observability.ts. Graceful zeros when OpenSearch is
// unreachable or the prompt has no runs yet.
const OS_URL = process.env.OFFGRID_OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
const OS_INDEX = process.env.OFFGRID_GATEWAY_INDEX ?? 'offgrid-gateway';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const email = gate.user.email ?? '';

  const { id } = await ctx.params;

  // Visibility mirrors the detail page: a user may see an org-visible prompt or their own private one,
  // scoped to their own org so another tenant's prompt id resolves to null → 404.
  const p = await getPrompt(id, await currentOrgId()).catch(() => null);
  if (!p || !(p.visibility === 'org' || p.owner === email)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const daysParam = Number(new URL(req.url).searchParams.get('days'));
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 365 ? Math.floor(daysParam) : 30;

  try {
    const r = await fetch(`${OS_URL}/${OS_INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildPromptAggsQuery(id, Date.now(), days)),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return NextResponse.json(emptyPromptObservability(days));
    const data = await r.json();
    return NextResponse.json(parsePromptAggsResponse(id, data, days));
  } catch {
    return NextResponse.json(emptyPromptObservability(days));
  }
}
