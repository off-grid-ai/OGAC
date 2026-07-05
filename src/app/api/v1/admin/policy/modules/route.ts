import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { deployModule, listModules } from '@/lib/opa-policy';
import { formatCompileErrors, slugifyModuleId, validateRegoModule } from '@/lib/opa-policy-policy';

export const dynamic = 'force-dynamic';

// OPA Rego-module collection: list stored modules + create/deploy a new one. Thin — the pure module
// validates the payload and shapes the OPA response; the I/O lib talks to /v1/policies. This is the
// advanced policy-as-code path; the first-party ABAC engine remains the default decision engine.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const res = await listModules();
  if (!res.reachable) {
    return NextResponse.json({ error: res.reason, reachable: false }, { status: 502 });
  }
  return NextResponse.json({ object: 'list', data: res.modules });
}

// Create/deploy a module. When the client sends no id, derive one from a `title` slug. OPA compiles
// on upload, so invalid Rego comes back as a 400 with per-line compile diagnostics.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const candidate = {
    id: (body?.id as string) || slugifyModuleId((body?.title as string) ?? ''),
    rego: body?.rego,
  };
  const parsed = validateRegoModule(candidate);
  if (!parsed.ok || !parsed.value) {
    return NextResponse.json({ error: parsed.errors.join('; ') }, { status: 400 });
  }
  const result = await deployModule(parsed.value);
  if (result.status === 'invalid') {
    return NextResponse.json(
      { error: formatCompileErrors(result.errors), errors: result.errors },
      { status: 400 },
    );
  }
  if (result.status === 'unreachable') {
    return NextResponse.json({ error: result.reason, reachable: false }, { status: 502 });
  }
  auditFromSession(gate, await currentOrgId(), {
    action: 'policy.change',
    resource: `opa-module:${parsed.value.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(result.module, { status: 201 });
}
