import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { marquezLineageReader } from '@/lib/adapters/marquez-lineage';
import { validateOwnerInput } from '@/lib/marquez-lineage';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET — list Marquez namespaces WITH their owner + description (the governance/ownership view the
// graph reader drops). Best-effort read; envelope is always returned.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await marquezLineageReader.listNamespaces());
}

// POST — set/update a namespace's OWNER (create-or-update; Marquez PUT is idempotent). Ownership is
// the data-provenance question "who owns this dataset lineage" — a governed, audited write.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!marquezLineageReader.configured()) {
    return NextResponse.json({ error: 'Marquez not configured' }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const v = validateOwnerInput(body ?? {});
  if (!v.ok || !v.value) return NextResponse.json({ error: v.error }, { status: 400 });
  const result = await marquezLineageReader.setNamespaceOwner(v.value);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
  }
  auditFromSession(gate, await currentOrgId(), {
    action: 'lineage.namespace.owner.set',
    resource: `namespace:${v.value.name}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
