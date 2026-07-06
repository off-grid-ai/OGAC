import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { setControlStatus } from '@/lib/compliance-adoption';
import { validateStatusTransition } from '@/lib/compliance-catalog';
import { currentOrgId } from '@/lib/tenancy';

// A single tracked control. PATCH sets its status (new | in-progress | met) after pure validation.
// Thin: admin-gated, validate the status against the catalog rule, delegate, audit.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { status?: unknown } | null;
  const parsed = validateStatusTransition(body?.status);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const orgId = await currentOrgId();
  const updated = await setControlStatus(id, parsed.status, orgId);
  if (!updated) return NextResponse.json({ error: 'unknown control' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'compliance.change',
    resource: `control:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}
