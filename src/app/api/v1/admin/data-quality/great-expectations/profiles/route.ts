import { NextResponse } from 'next/server';
import { greatExpectationsLifecycle } from '@/lib/adapters/great-expectations-lifecycle';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  gxParseFailure,
  gxResultPayload,
} from '@/lib/service-capabilities/great-expectations-http';
import { parseProfileRequest } from '@/lib/service-capabilities/great-expectations-lifecycle';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const parsed = parseProfileRequest(await req.json().catch(() => null));
  if (!parsed.ok || !parsed.value) {
    const response = gxParseFailure(parsed);
    return NextResponse.json(response.body, { status: response.status });
  }
  const orgId = await currentOrgId();
  const result = await greatExpectationsLifecycle.profile(
    { orgId, actor: gate.user.email ?? gate.user.name ?? 'authenticated-admin' },
    parsed.value,
  );
  auditFromSession(gate, orgId, {
    action: 'data-quality.gx.profile',
    resource: `data-source:${parsed.value.dataSourceId}/${parsed.value.assetName}`,
    outcome: result.ok ? 'ok' : result.kind === 'unavailable' ? 'blocked' : 'error',
  });
  const response = gxResultPayload(result);
  return NextResponse.json(response.body, { status: response.status });
}
