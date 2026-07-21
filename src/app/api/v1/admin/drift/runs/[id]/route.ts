import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteDriftRun, getDriftRun } from '@/lib/drift-runs';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// One retained drift run (with full attribution), org-scoped so a cross-tenant id resolves to 404.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const run = await getDriftRun(id, await currentOrgId());
  if (!run) return NextResponse.json({ error: 'drift run not found' }, { status: 404 });
  return NextResponse.json(run);
}

// Delete a retained drift run (management surface — operators prune their own history).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const ok = await deleteDriftRun(id, await currentOrgId());
  if (!ok) return NextResponse.json({ error: 'drift run not found' }, { status: 404 });
  return NextResponse.json({ deleted: true, id });
}
