import { listAppsByPipeline } from '@/lib/apps-store';
import { listProjectsByPipeline } from '@/lib/chat';
import { getChatBindingGovernance, listCustomAgentsByPipeline } from '@/lib/store';

export type PipelineConsumer =
  | { kind: 'app'; id: string; label: string }
  | { kind: 'runtime_agent'; id: string; label: string; ownerAppId: string | null }
  | { kind: 'chat_project'; id: string; label: string }
  | { kind: 'chat_default'; id: 'chat-default'; label: string }
  | { kind: 'chat_allowlist'; id: 'chat-allowlist'; label: string };

/** One org-scoped inventory used by overview, deprecation, and deletion decisions. */
export async function listPipelineConsumers(
  pipelineId: string,
  orgId: string,
): Promise<PipelineConsumer[]> {
  const [apps, agents, projects, chat] = await Promise.all([
    listAppsByPipeline(pipelineId, orgId),
    listCustomAgentsByPipeline(pipelineId, orgId),
    listProjectsByPipeline(pipelineId, orgId),
    getChatBindingGovernance(orgId),
  ]);
  return [
    ...apps.map((app) => ({ kind: 'app' as const, id: app.id, label: app.title })),
    ...agents.map((agent) => ({
      kind: 'runtime_agent' as const,
      id: agent.id,
      label: agent.name,
      ownerAppId: agent.ownerAppId,
    })),
    ...projects.map((project) => ({
      kind: 'chat_project' as const,
      id: project.id,
      label: project.name,
    })),
    ...(chat.defaultChatPipelineId === pipelineId
      ? [{ kind: 'chat_default' as const, id: 'chat-default' as const, label: 'Chat default' }]
      : []),
    ...(chat.allowlist.includes(pipelineId)
      ? [
          {
            kind: 'chat_allowlist' as const,
            id: 'chat-allowlist' as const,
            label: 'Available in Chat',
          },
        ]
      : []),
  ];
}
