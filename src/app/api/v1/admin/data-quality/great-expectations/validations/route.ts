import { NextResponse } from 'next/server';
import { greatExpectationsLifecycle } from '@/lib/adapters/great-expectations-lifecycle';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  gxParseFailure,
  gxResultPayload,
} from '@/lib/service-capabilities/great-expectations-http';
import {
  parseHistoryQuery,
  parseValidationRequest,
} from '@/lib/service-capabilities/great-expectations-lifecycle';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const params = new URL(req.url).searchParams;
  const parsed = parseHistoryQuery({
    suiteName: params.get('suiteName') ?? undefined,
    dataSourceId: params.get('dataSourceId') ?? undefined,
    limit: params.has('limit') ? Number(params.get('limit')) : undefined,
    cursor: params.get('cursor') ?? undefined,
  });
  if (!parsed.ok || !parsed.value) {
    const response = gxParseFailure(parsed);
    return NextResponse.json(response.body, { status: response.status });
  }
  const orgId = await currentOrgId();
  const result = await greatExpectationsLifecycle.history(
    { orgId, actor: gate.user.email ?? gate.user.name ?? 'authenticated-admin' },
    parsed.value,
  );
  const response = gxResultPayload(result);
  return NextResponse.json(response.body, { status: response.status });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const parsed = parseValidationRequest(await req.json().catch(() => null));
  if (!parsed.ok || !parsed.value) {
    const response = gxParseFailure(parsed);
    return NextResponse.json(response.body, { status: response.status });
  }
  const orgId = await currentOrgId();
  const result = await greatExpectationsLifecycle.runValidation(
    { orgId, actor: gate.user.email ?? gate.user.name ?? 'authenticated-admin' },
    parsed.value,
  );
  auditFromSession(gate, orgId, {
    action: 'data-quality.gx.validation.run',
    resource: `suite:${parsed.value.suiteName}`,
    outcome: result.ok
      ? result.value.success
        ? 'ok'
        : 'fail'
      : result.kind === 'unavailable'
        ? 'blocked'
        : 'error',
  });
  const response = gxResultPayload(result, 201);
  return NextResponse.json(response.body, { status: response.status });
}
