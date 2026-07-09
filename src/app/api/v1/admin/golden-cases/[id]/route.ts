import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteGoldenCase, getGoldenCase, updateGoldenCase } from '@/lib/evals';
import { validateGoldenCase } from '@/lib/evals-golden';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const v = validateGoldenCase(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  // Org-scoped: a case owned by another tenant matches no row → 404 (no cross-tenant edit).
  const updated = await updateGoldenCase(id, v.value, await currentOrgId());
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  // 404 if it isn't the caller's (or doesn't exist) so a guessed cross-tenant id can't be deleted.
  const existing = await getGoldenCase(id, orgId);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await deleteGoldenCase(id, orgId);
  return NextResponse.json({ deleted: true });
}
