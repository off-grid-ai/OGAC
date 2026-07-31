import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { listProjectArtifacts, projectAccess } from '@/lib/chat';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Artifacts produced by this project's chats. A project groups conversations, and those conversations
// produce renderable outputs — but the project page showed instructions, knowledge, memory and chats while
// the artifacts they generated were only findable in the global Artifacts list. The work a project produced
// belongs to the project.
//
// Read-only: the same access gate as the project itself, and artifacts are created by chats, not here.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const access = await projectAccess(email, id, session.user.role ?? 'viewer');
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ artifacts: await listProjectArtifacts(id, await currentOrgId()) });
}
