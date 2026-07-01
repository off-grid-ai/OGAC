import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createSkill, listSkills } from '@/lib/chat';

export const dynamic = 'force-dynamic';

// Org skills — reusable RBAC-scoped assistants. Listing is scoped to the caller's role (admins
// see all); creation is admin-only. Mirrors the console's other admin-gated resources.
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const role = session.user.role ?? 'viewer';
  return NextResponse.json({ skills: await listSkills(role) });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = await createSkill(session.user.email, {
    name: body.name,
    description: body.description,
    systemPrompt: body.systemPrompt,
    model: body.model,
    projectId: body.projectId ?? null,
    allowedRoles: Array.isArray(body.allowedRoles) ? body.allowedRoles : [],
    icon: body.icon ?? null,
  });
  return NextResponse.json({ id });
}
