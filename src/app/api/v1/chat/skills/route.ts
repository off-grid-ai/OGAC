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
  return NextResponse.json({ skills: await listSkills(role, session.user.email) });
}

// Create an assistant. Admins may publish org-wide assistants (visibility 'org'); non-admins may
// only create private ones (visibility is forced to 'private' for them). Assistant-builder fields
// (conversation starters, capability toggles, Actions OpenAPI schema) are all optional/additive.
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const isAdmin = session.user.role === 'admin';
  const body = await req.json().catch(() => ({}));
  const visibility = isAdmin ? (body.visibility === 'private' ? 'private' : 'org') : 'private';
  const cap = body.capabilities ?? {};
  const id = await createSkill(session.user.email, {
    name: body.name,
    description: body.description,
    systemPrompt: body.systemPrompt,
    model: body.model,
    projectId: body.projectId ?? null,
    allowedRoles: Array.isArray(body.allowedRoles) ? body.allowedRoles : [],
    icon: body.icon ?? null,
    conversationStarters: Array.isArray(body.conversationStarters)
      ? body.conversationStarters.filter((s: unknown) => typeof s === 'string' && s.trim())
      : [],
    capabilities: {
      web: Boolean(cap.web),
      tools: Boolean(cap.tools),
      code: Boolean(cap.code),
    },
    actionsSchema: typeof body.actionsSchema === 'string' ? body.actionsSchema : '',
    visibility,
  });
  return NextResponse.json({ id });
}
