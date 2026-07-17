import { Robot } from '@phosphor-icons/react/dist/ssr';
import { AgentsGrid, type AgentCardModel } from '@/components/agents/AgentsGrid';
import { CreateAgentButton } from '@/components/agents/CreateAgentButton';
import { AppsList } from '@/components/build/AppsList';
import type { PipelineChipData } from '@/components/pipelines/PipelineChip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import { agentActivity, listManagedAgents } from '@/lib/agents';
import { canonicalAgentCatalog } from '@/lib/agent-catalog';
import { listApps } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { resolveConsumerChips } from '@/lib/pipeline-chip';
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
  const [managedAgents, activity, apps, pipelines] = await Promise.all([
    listManagedAgents(orgId),
    agentActivity(orgId),
    listApps(orgId).catch(() => []),
    listPipelines(orgId).catch(() => []),
  ]);

  // Authored agents are single-step AppSpecs. Custom runtime rows are materialization details and
  // must never appear as a second editable entity in the roster.
  const { builtIns: agents, authored: singleStepApps } = canonicalAgentCatalog(managedAgents, apps);

  // The distinct list: single-step apps only (an agent IS a one-step app). Multi-step workflows stay
  // on Studio. Resolve each one's "Runs on: <pipeline>" chip in a single batch.
  const chipList = await resolveConsumerChips(
    singleStepApps.map((a) => a.pipelineId ?? null),
    orgId,
  );
  const appChips: Record<string, PipelineChipData> = {};
  singleStepApps.forEach((a, i) => {
    appChips[a.id] = chipList[i];
  });

  const cards: AgentCardModel[] = agents.map((a) => ({
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
            An agent is the simplest app — a single governed step. This is your agent roster: the
            reusable built-in capabilities plus the single-step apps you&rsquo;ve built. Open a
            built-in to run it, or open one of your agents to edit its complete lifecycle in{' '}
            <a href="/build/studio" className="text-primary underline-offset-4 hover:underline">
              Studio
            </a>
            .
          </p>
        </div>
        <CreateAgentButton />
      </div>

      {/* Stat band — agent-scoped (not the app-wide Studio band). */}
      <StatRail>
        <Stat label="Built-in agents" value={agents.length} />
        <Stat label="Your agents" value={singleStepApps.length} />
        <Stat label="Fleet runs (audit)" value={activity.totalRuns.toLocaleString()} />
        <Stat label="Grounded in org knowledge" value={`${activity.groundedShare}%`} />
      </StatRail>

      {/* Built-ins link to runtime detail; authored agents below link to their App lifecycle. */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Built-in capabilities</h2>
        <AgentsGrid agents={cards} />
      </div>

      {/* Single-step apps you built — an agent IS a one-step app; each opens its lifecycle shell. */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Your agents</h2>
        {singleStepApps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No single-step apps yet. Describe an agent in{' '}
            <a href="/build/studio/new" className="text-primary underline-offset-4 hover:underline">
              the builder
            </a>{' '}
            and it appears here.
          </p>
        ) : (
          <AppsList apps={singleStepApps} chips={appChips} />
        )}
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
