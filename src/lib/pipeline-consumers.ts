import { materializedAgentIds } from '@/lib/app-agent-ownership';
import { listApps, listAppsByPipeline } from '@/lib/apps-store';
import { listProjectsByPipeline } from '@/lib/chat';
import { getChatBindingGovernance, listCustomAgentsByPipeline } from '@/lib/store';

export type PipelineConsumer =
  | { kind: 'app'; id: string; label: string }
  | { kind: 'runtime_agent'; id: string; label: string }
  | { kind: 'chat_project'; id: string; label: string }
  | { kind: 'chat_default'; id: 'chat-default'; label: string }
  | { kind: 'chat_allowlist'; id: 'chat-allowlist'; label: string };

/** One org-scoped inventory used by overview, deprecation, and deletion decisions. */
export async function listPipelineConsumers(
  pipelineId: string,
  orgId: string,
): Promise<PipelineConsumer[]> {
  const [apps, allApps, agents, projects, chat] = await Promise.all([
    listAppsByPipeline(pipelineId, orgId),
    listApps(orgId),
    listCustomAgentsByPipeline(pipelineId, orgId),
    listProjectsByPipeline(pipelineId, orgId),
    getChatBindingGovernance(orgId),
  ]);
  const appOwnedRuntimeIds = new Set(allApps.flatMap(materializedAgentIds));
  return [
    ...apps.map((app) => ({ kind: 'app' as const, id: app.id, label: app.title })),
    ...agents
      .filter((agent) => !appOwnedRuntimeIds.has(agent.id))
      .map((agent) => ({
        kind: 'runtime_agent' as const,
        id: agent.id,
        label: agent.name,
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
