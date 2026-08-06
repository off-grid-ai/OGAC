import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/authz';
import {
  buildCommonPromptsQuery,
  tallyCommonPrompts,
  type GatewayInputHit,
} from '@/lib/common-prompts';
import { opensearchFetch } from '@/lib/opensearch-http';
import { classifySinkStatus, sinkUnreachable } from '@/lib/sink-unavailable';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Common prompts — mines the gateway's durable call history (the observability sink ships every call
// there) for the prompt texts users actually send, then normalizes + counts them to surface the org's
// most frequently-used prompts. These can be saved into the personal/org prompt library. Falls back to
// available:false when the store is unreachable so the UI degrades gracefully (mirrors /gateway/logs).
//
// SCOPED PER ORG since 2026-08-05. This route previously ran a query whose only predicate was
// `exists: input`, and returned the top 25 prompts across the ENTIRE index to any caller — so each
// tenant's read-only demo account could read the other tenant's verbatim prompt text. The rule, the
// measured numbers and why an unattributable record is shown to nobody are documented in
// src/lib/common-prompts.ts, which owns the query and the tally so both can be unit-tested.
const OS_INDEX = process.env.OFFGRID_GATEWAY_INDEX ?? 'offgrid-gateway';

export async function GET(req: NextRequest) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;

  // From the session, never from a query parameter — a client-supplied org would be the leak, not the fix.
  const org = await currentOrgId();

  try {
    // Goes through the brokered helper, not a raw fetch: with the security plugin on, an
    // unauthenticated call 401s and the surface silently shows nothing.
    const r = await opensearchFetch(`/${OS_INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildCommonPromptsQuery(org)),
      cache: 'no-store',
      timeoutMs: 6000,
    });
    if (!r.ok) {
      return NextResponse.json(classifySinkStatus(r.status, 'The prompt history'), { status: 200 });
    }
    const data = await r.json();
    const hits: GatewayInputHit[] = data?.hits?.hits ?? [];
    return NextResponse.json({ available: true, common: tallyCommonPrompts(hits) });
  } catch {
    return NextResponse.json(sinkUnreachable('The prompt history'), { status: 200 });
  }
}
