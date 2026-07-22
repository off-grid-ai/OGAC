import { NextResponse } from 'next/server';
import { kestraCatalog } from '@/lib/adapters/kestra-catalog';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { validateKvKey, validateKvValue, validateNamespaceName } from '@/lib/kestra-catalog';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Update (PUT) or delete (DELETE) a single KV entry. Both validated before the engine call and
// audited. Delete is idempotent (a missing key still succeeds).
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ ns: string; key: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { ns, key } = await params;
  const nsCheck = validateNamespaceName(ns);
  if (!nsCheck.ok) return NextResponse.json({ error: nsCheck.error }, { status: 400 });
  const keyCheck = validateKvKey(key);
  if (!keyCheck.ok) return NextResponse.json({ error: keyCheck.error }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { value?: unknown } | null;
  const valueCheck = validateKvValue(body?.value);
  if (!valueCheck.ok) return NextResponse.json({ error: valueCheck.error }, { status: 400 });

  const orgId = await currentOrgId();
  const result = await kestraCatalog.putKv(ns, key, body!.value as string);
  auditFromSession(gate, orgId, {
    action: 'orchestration.kv.write',
    resource: `orchestration-kv:${ns}/${key}`,
    outcome: result.ok ? 'ok' : 'error',
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.configured ? 502 : 503 });
  }
  return NextResponse.json(result.value);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ ns: string; key: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { ns, key } = await params;
  const nsCheck = validateNamespaceName(ns);
  if (!nsCheck.ok) return NextResponse.json({ error: nsCheck.error }, { status: 400 });
  const keyCheck = validateKvKey(key);
  if (!keyCheck.ok) return NextResponse.json({ error: keyCheck.error }, { status: 400 });

  const orgId = await currentOrgId();
  const result = await kestraCatalog.deleteKv(ns, key);
  auditFromSession(gate, orgId, {
    action: 'orchestration.kv.delete',
    resource: `orchestration-kv:${ns}/${key}`,
    outcome: result.ok ? 'ok' : 'error',
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.configured ? 502 : 503 });
  }
  return NextResponse.json(result.value);
}
