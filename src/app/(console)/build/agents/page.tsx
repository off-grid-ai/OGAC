import { Robot } from '@phosphor-icons/react/dist/ssr';
import { AgentsGrid, type AgentCardModel } from '@/components/agents/AgentsGrid';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import { AGENTS, agentActivity } from '@/lib/agents';
import { requireModuleForUser } from '@/lib/module-access';
import { listPipelines } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';
import { MODULES } from '@/modules/registry';

export const dynamic = 'force-dynamic';

// ─── /build/agents — the AGENTS list (deduped from Studio, Builder-Epic #118 / UX-audit T4) ─────────
// Studio (/build/studio) is the canonical app-centric front door. This surface is the agent lens:
// reusable built-in runtime capabilities plus the user's single-step AppSpecs. Materialized custom
// runtime rows stay hidden, so an authored agent has one owner, editor, lifecycle and URL.
function planeLabel(id: string): string {
  return MODULES.find((m) => m.id === id)?.label ?? id;
}

export default async function AgentsPage() {
  await requireModuleForUser('agents');
  const orgId = await currentOrgId();
  const [activity, pipelines] = await Promise.all([
    agentActivity(orgId),
    listPipelines(orgId).catch(() => []),
  ]);

  const cards: AgentCardModel[] = AGENTS.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    description: a.description,
    systemPrompt: a.systemPrompt,
    model: a.model,
    planes: a.planes,
    planeLabels: a.planes.map(planeLabel),
    tools: a.tools,
    grounded: a.grounded,
    trigger: a.trigger,
    custom: a.custom,
    enabled: a.enabled,
    pipelineId: a.pipelineId,
    pipeline: a.pipelineId
      ? {
          id: a.pipelineId,
          name: pipelines.find((p) => p.id === a.pipelineId)?.name ?? a.pipelineId,
        }
      : { id: null },
  }));

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Robot className="size-5 text-primary" />
            Agents
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Reusable built-in capabilities shipped with Off Grid AI. Open one to inspect its needs,
            tools, governed run path, and live run history. Your authored use cases remain Apps,
            with one lifecycle and one canonical editor.
          </p>
        </div>
      </div>

      {/* Stat band — agent-scoped (not the app-wide Studio band). */}
      <StatRail>
        <Stat label="Built-in agents" value={AGENTS.length} />
        <Stat label="Fleet runs (audit)" value={activity.totalRuns.toLocaleString()} />
        <Stat
          label="Grounded capabilities"
          value={`${Math.round((AGENTS.filter((agent) => agent.grounded).length / AGENTS.length) * 100)}%`}
        />
      </StatRail>

      {/* Built-ins link directly to their canonical Solutions detail route. */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Built-in capabilities</h2>
        <AgentsGrid agents={cards} />
      </div>
    </div>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: number | string }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-3xl font-semibold text-foreground">{value}</CardContent>
    </Card>
  );
}
