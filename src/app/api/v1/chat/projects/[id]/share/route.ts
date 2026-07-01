import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  addProjectMember,
  listProjectMembers,
  projectAccess,
  removeProjectMember,
  setProjectVisibility,
} from '@/lib/chat';

export const dynamic = 'force-dynamic';

// Sharing is managed by the project owner (or an admin). Members get view or edit; visibility
// toggles the project between private and org-shared.
async function ownerOnly(id: string, email: string, role: string) {
  return (await projectAccess(email, id, role)) === 'owner' || role === 'admin';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const access = await projectAccess(email, id, session.user.role ?? 'viewer');
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ members: await listProjectMembers(id), access });
}

// PATCH: set visibility. POST: add/update a member. DELETE: remove a member.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await ownerOnly(id, email, session.user.role ?? 'viewer')))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { visibility } = await req.json().catch(() => ({}));
  await setProjectVisibility(id, visibility);
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await ownerOnly(id, email, session.user.role ?? 'viewer')))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { userId, canEdit = false } = await req.json().catch(() => ({}));
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
  await addProjectMember(id, String(userId), Boolean(canEdit));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await ownerOnly(id, email, session.user.role ?? 'viewer')))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const member = searchParams.get('userId');
  if (!member) return NextResponse.json({ error: 'userId required' }, { status: 400 });
  await removeProjectMember(id, member);
  return NextResponse.json({ ok: true });
}
