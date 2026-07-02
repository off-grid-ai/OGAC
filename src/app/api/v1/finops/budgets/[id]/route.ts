import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteBudget } from '@/lib/token-budgets';

export const dynamic = 'force-dynamic';

// DELETE a token budget by id (admin only).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteBudget(id);
  return NextResponse.json({ ok: true });
}
