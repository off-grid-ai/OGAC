import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { executeFlush } from '@/lib/adapters/litellm-cache';
import { flushAuditResource, planFlush } from '@/lib/litellm-cache';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Flush the gateway response cache — a direct cost/latency lever. Body: { mode: 'all' } to clear
// everything (redis FLUSHALL) or { mode: 'keys', keys: [...] } to evict specific entries. The pure
// planFlush validates + shapes the request; the adapter POSTs /cache/flushall|/cache/delete. Every
// flush is AUDITED (routing.change), with the target described in the resource.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => ({}))) as unknown;
  const plan = planFlush((body ?? {}) as { mode?: unknown; keys?: unknown });
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

  const result = await executeFlush(plan);
  const org = await currentOrgId();
  auditFromSession(gate, org, {
    action: 'routing.change',
    resource: `gateway.${flushAuditResource(plan)}.flush`,
    outcome: result.ok ? 'ok' : 'error',
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json(result);
}
