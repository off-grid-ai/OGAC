import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteProject, projectAccess, updateProjectFields } from '@/lib/chat';
import { isChatPipelineAllowed } from '@/lib/chat-pipeline-policy';
import { getChatBindingGovernance } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Editing is allowed for the owner, a member with edit rights, or an admin. Deleting is
// owner/admin only.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const access = await projectAccess(userId, id, session.user.role ?? 'viewer');
  if (access !== 'owner' && access !== 'edit')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const patch = await req.json().catch(() => ({}));
  // Only touch pipelineId when the caller sent it, and gate it against the org's available set.
  const fields: { name?: string; description?: string; systemPrompt?: string; pipelineId?: string | null } = {
    name: patch.name,
    description: patch.description,
    systemPrompt: patch.systemPrompt,
  };
  if (patch.pipelineId !== undefined) {
    const gov = await getChatBindingGovernance(await currentOrgId());
    const next = patch.pipelineId ?? null;
    if (!isChatPipelineAllowed(next, gov)) {
      return NextResponse.json({ error: 'pipeline not available for chat' }, { status: 403 });
    }
    fields.pipelineId = next;
  }
  await updateProjectFields(id, fields);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const access = await projectAccess(userId, id, session.user.role ?? 'viewer');
  if (access !== 'owner') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await deleteProject(userId, id);
  return NextResponse.json({ ok: true });
}
