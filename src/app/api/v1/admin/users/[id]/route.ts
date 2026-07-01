import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { isRbacRole } from '@/lib/roles';
import { setUserRole } from '@/lib/store';

// Change a user's RBAC role.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!isRbacRole(body?.role)) {
    return NextResponse.json(
      { error: 'role must be admin, compliance, or viewer' },
      { status: 400 },
    );
  }
  const updated = await setUserRole(id, body.role);
  if (!updated) {
    return NextResponse.json({ error: 'unknown user' }, { status: 404 });
  }
  return NextResponse.json(updated);
}
