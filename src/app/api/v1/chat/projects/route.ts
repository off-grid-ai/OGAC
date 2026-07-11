import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createProject, listProjects } from '@/lib/chat';
import { availableChatPipelines, isChatPipelineAllowed } from '@/lib/chat-pipeline-policy';
import { listPipelines } from '@/lib/pipelines';
import { getChatBindingGovernance } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // Surface the governed set a user may pick from (default first) so the UI can render a picker.
  // Enrich the ids with names via the server-side lib read (NOT the admin HTTP route) so a
  // non-admin chat user sees friendly pipeline names without needing the admin pipelines endpoint.
  const orgId = await currentOrgId();
  const gov = await getChatBindingGovernance(orgId);
  const availableIds = availableChatPipelines(gov);
  const nameById = new Map((await listPipelines(orgId).catch(() => [])).map((p) => [p.id, p.name]));
  return NextResponse.json({
    projects: await listProjects(userId, orgId),
    chatBinding: {
      defaultChatPipelineId: gov.defaultChatPipelineId,
      available: availableIds,
      // {id,name} pairs for the picker (name falls back to the id when not resolvable).
      pipelines: availableIds.map((id) => ({ id, name: nameById.get(id) ?? id })),
    },
  });
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { name = 'New project', systemPrompt = '', pipelineId } = await req.json().catch(() => ({}));
  // Server-side governance gate: a user may only bind a pipeline in the org's available-for-chat set.
  const orgId = await currentOrgId();
  const gov = await getChatBindingGovernance(orgId);
  if (!isChatPipelineAllowed(pipelineId ?? null, gov)) {
    return NextResponse.json({ error: 'pipeline not available for chat' }, { status: 403 });
  }
  const id = await createProject(userId, orgId, name, systemPrompt, pipelineId ?? null);
  return NextResponse.json({ id });
}
