import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { createGateway, listGatewaysWithHealth } from '@/lib/gateways';
import { validateGatewayCreate } from '@/lib/gateways-policy';

export const dynamic = 'force-dynamic';

// ─── Gateway REGISTRY (Gateways × Pipelines, P1) ─────────────────────────────────────────────────
// First-class model-serving endpoints a pipeline runs on. Admin-gated, org-scoped, audited. The GET
// returns the registry MERGED with live health (honest `available` = enabled+configured+reachable —
// never faked). The pure rules live in gateways-policy.ts, persistence + probing in gateways.ts.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  return NextResponse.json({ object: 'list', data: await listGatewaysWithHealth(orgId) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const result = validateGatewayCreate({
    name: body?.name,
    kind: body?.kind,
    baseUrl: body?.baseUrl,
    defaultModel: body?.defaultModel,
    enabled: body?.enabled,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const orgId = await currentOrgId();
  const created = await createGateway(result.value, orgId);
  auditFromSession(gate, orgId, {
    action: 'gateway.create',
    resource: `gateway:${created.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}
