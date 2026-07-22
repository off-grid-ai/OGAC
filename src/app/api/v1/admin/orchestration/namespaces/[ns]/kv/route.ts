import { NextResponse } from 'next/server';
import { kestraCatalog } from '@/lib/adapters/kestra-catalog';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { validateKvWrite, validateNamespaceName } from '@/lib/kestra-catalog';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The writable, governed per-namespace key/value store. GET lists entries (key + version + dates,
// never fetching values). POST creates/overwrites a key — validated (charset/length) before it
// reaches the engine, and audited.
export async function GET(req: Request, { params }: { params: Promise<{ ns: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { ns } = await params;
  const kv = await kestraCatalog.listKv(ns);
  return NextResponse.json({ configured: kestraCatalog.configured(), kv });
}

export async function POST(req: Request, { params }: { params: Promise<{ ns: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { ns } = await params;
  const nsCheck = validateNamespaceName(ns);
  if (!nsCheck.ok) return NextResponse.json({ error: nsCheck.error }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  const key = typeof body?.key === 'string' ? body.key.trim() : body?.key;
  const value = body?.value;
  const check = validateKvWrite(key, value);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const orgId = await currentOrgId();
  const result = await kestraCatalog.putKv(ns, key as string, value as string);
  if (!result.ok) {
    auditFromSession(gate, orgId, {
      action: 'orchestration.kv.write',
      resource: `orchestration-kv:${ns}/${key}`,
      outcome: 'error',
    });
    return NextResponse.json({ error: result.error }, { status: result.configured ? 502 : 503 });
  }
  auditFromSession(gate, orgId, {
    action: 'orchestration.kv.write',
    resource: `orchestration-kv:${ns}/${result.value.key}`,
    outcome: 'ok',
  });
  return NextResponse.json(result.value, { status: 201 });
}
