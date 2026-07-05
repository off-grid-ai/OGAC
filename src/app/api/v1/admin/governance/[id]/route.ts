import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteGovernance, updateGovernance } from '@/lib/store';

const KINDS = [
  'policy',
  'ethics_review',
  'raci',
  'training',
  'vendor',
  'insurance',
  'drill',
  'impact_assessment',
];
const STATUSES = ['draft', 'active', 'due', 'expired'];

// Edit a governance record — title / owner / status / kind / detail / reviewedAt. Only supplied
// fields change; invalid enum values are rejected.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: 'body required' }, { status: 400 });
  if (b.kind !== undefined && !KINDS.includes(String(b.kind)))
    return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
  if (b.status !== undefined && !STATUSES.includes(String(b.status)))
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  const patch: Record<string, string> = {};
  for (const k of ['title', 'owner', 'status', 'kind', 'detail', 'reviewedAt'] as const) {
    if (b[k] !== undefined) patch[k] = String(b[k]);
  }
  const updated = await updateGovernance(id, patch);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteGovernance(id);
  return NextResponse.json({ ok: true });
}
