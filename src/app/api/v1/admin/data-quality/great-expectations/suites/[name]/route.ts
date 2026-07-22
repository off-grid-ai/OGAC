import { NextResponse } from 'next/server';
import { greatExpectationsLifecycle } from '@/lib/adapters/great-expectations-lifecycle';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  gxParseFailure,
  gxResultPayload,
} from '@/lib/service-capabilities/great-expectations-http';
import {
  parseSuiteDelete,
  parseSuiteName,
  parseSuiteUpdate,
} from '@/lib/service-capabilities/great-expectations-lifecycle';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ name: string }> };

async function checkedName(context: Context) {
  return parseSuiteName((await context.params).name);
}

export async function GET(req: Request, context: Context) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const name = await checkedName(context);
  if (!name.ok || !name.value) {
    const response = gxParseFailure(name);
    return NextResponse.json(response.body, { status: response.status });
  }
  const orgId = await currentOrgId();
  const result = await greatExpectationsLifecycle.getSuite(
    { orgId, actor: gate.user.email ?? gate.user.name ?? 'authenticated-admin' },
    name.value,
  );
  const response = gxResultPayload(result);
  return NextResponse.json(response.body, { status: response.status });
}

export async function PATCH(req: Request, context: Context) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const name = await checkedName(context);
  const parsed = parseSuiteUpdate(await req.json().catch(() => null));
  if (!name.ok || !name.value) {
    const response = gxParseFailure(name);
    return NextResponse.json(response.body, { status: response.status });
  }
  if (!parsed.ok || !parsed.value) {
    const response = gxParseFailure(parsed);
    return NextResponse.json(response.body, { status: response.status });
  }
  const orgId = await currentOrgId();
  const result = await greatExpectationsLifecycle.updateSuite(
    { orgId, actor: gate.user.email ?? gate.user.name ?? 'authenticated-admin' },
    name.value,
    parsed.value,
  );
  auditFromSession(gate, orgId, {
    action: 'data-quality.gx.suite.update',
    resource: `suite:${name.value}`,
    outcome: result.ok ? 'ok' : result.kind === 'unavailable' ? 'blocked' : 'error',
  });
  const response = gxResultPayload(result);
  return NextResponse.json(response.body, { status: response.status });
}

export async function DELETE(req: Request, context: Context) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const name = await checkedName(context);
  const versionParam = new URL(req.url).searchParams.get('expectedVersion');
  const parsed = parseSuiteDelete({
    expectedVersion: versionParam === null ? undefined : Number(versionParam),
  });
  if (!name.ok || !name.value) {
    const response = gxParseFailure(name);
    return NextResponse.json(response.body, { status: response.status });
  }
  if (!parsed.ok || !parsed.value) {
    const response = gxParseFailure(parsed);
    return NextResponse.json(response.body, { status: response.status });
  }
  const orgId = await currentOrgId();
  const result = await greatExpectationsLifecycle.deleteSuite(
    { orgId, actor: gate.user.email ?? gate.user.name ?? 'authenticated-admin' },
    name.value,
    parsed.value.expectedVersion,
  );
  auditFromSession(gate, orgId, {
    action: 'data-quality.gx.suite.delete',
    resource: `suite:${name.value}`,
    outcome: result.ok ? 'ok' : result.kind === 'unavailable' ? 'blocked' : 'error',
  });
  const response = gxResultPayload(result);
  return NextResponse.json(response.body, { status: response.status });
}
