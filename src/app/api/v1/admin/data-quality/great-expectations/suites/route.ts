import { NextResponse } from 'next/server';
import { greatExpectationsLifecycle } from '@/lib/adapters/great-expectations-lifecycle';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { gxParseFailure, gxResultPayload } from '@/lib/service-capabilities/great-expectations-http';
import { parseSuiteDraft } from '@/lib/service-capabilities/great-expectations-lifecycle';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const result = await greatExpectationsLifecycle.listSuites({
    orgId,
    actor: gate.user.email ?? gate.user.name ?? 'authenticated-admin',
  });
  const response = gxResultPayload(result);
  return NextResponse.json(response.body, { status: response.status });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const parsed = parseSuiteDraft(await req.json().catch(() => null));
  if (!parsed.ok || !parsed.value) {
    const response = gxParseFailure(parsed);
    return NextResponse.json(response.body, { status: response.status });
  }
  const orgId = await currentOrgId();
  const result = await greatExpectationsLifecycle.createSuite(
    { orgId, actor: gate.user.email ?? gate.user.name ?? 'authenticated-admin' },
    parsed.value,
  );
  auditFromSession(gate, orgId, {
    action: 'data-quality.gx.suite.create',
    resource: `suite:${parsed.value.name}`,
    outcome: result.ok ? 'ok' : result.kind === 'unavailable' ? 'blocked' : 'error',
  });
  const response = gxResultPayload(result, 201);
  return NextResponse.json(response.body, { status: response.status });
}
