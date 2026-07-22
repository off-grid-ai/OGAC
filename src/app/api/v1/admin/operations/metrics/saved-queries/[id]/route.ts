import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { validateSavedQuery } from '@/lib/victoriametrics-query';
import { deleteSavedQuery, updateSavedQuery } from '@/lib/vm-saved-queries-store';

export const dynamic = 'force-dynamic';

// PATCH (admin) → update a saved query. DELETE (admin) → remove one. Both org-scoped: another
// tenant's query matches no row → 404 (no cross-tenant edit/delete via a guessed id).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const v = validateSavedQuery(raw);
  if (!v.valid || !v.value) {
    return NextResponse.json({ error: v.errors.join('; ') }, { status: 400 });
  }
  const org = await currentOrgId();
  const updated = await updateSavedQuery(id, v.value, org);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  auditFromSession(gate, org, {
    action: 'metrics.saved_query.update',
    resource: `vm_saved_query/${id}`,
    outcome: 'success',
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const org = await currentOrgId();
  const removed = await deleteSavedQuery(id, org);
  if (!removed) return NextResponse.json({ error: 'not found' }, { status: 404 });
  auditFromSession(gate, org, {
    action: 'metrics.saved_query.delete',
    resource: `vm_saved_query/${id}`,
    outcome: 'success',
  });
  return NextResponse.json({ ok: true });
}
