import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { validateExportTarget } from '@/lib/exporters/config';
import { deleteExportTarget, getExportTarget, updateExportTarget } from '@/lib/exporters/store';

export const dynamic = 'force-dynamic';

// One export target: read, update (full config replace), or delete. Admin-gated, org-scoped, audited.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const target = await getExportTarget(id, orgId);
  if (!target) return NextResponse.json({ error: 'unknown export target' }, { status: 404 });
  return NextResponse.json(target);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const existing = await getExportTarget(id, orgId);
  if (!existing) return NextResponse.json({ error: 'unknown export target' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  // Fold the patch over the existing config, then validate the whole normalized result — kind is
  // immutable once created (it selects the exporter), so we always re-use the stored kind.
  const check = validateExportTarget({
    kind: existing.kind,
    endpoint: body && 'endpoint' in body ? body.endpoint : existing.endpoint,
    enabled: body && 'enabled' in body ? body.enabled : existing.enabled,
    secretRef: body && 'secretRef' in body ? body.secretRef : existing.secretRef,
  });
  if (!check.ok || !check.value) {
    return NextResponse.json(
      { error: check.errors.join('; '), errors: check.errors },
      { status: 400 },
    );
  }

  const updated = await updateExportTarget(id, orgId, check.value);
  if (!updated) return NextResponse.json({ error: 'unknown export target' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'exporter.update',
    resource: `exporter:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const removed = await deleteExportTarget(id, orgId);
  if (!removed) return NextResponse.json({ error: 'unknown export target' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'exporter.delete',
    resource: `exporter:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
