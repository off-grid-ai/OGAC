import { Robot } from '@phosphor-icons/react/dist/ssr';
import { AgentsGrid, type AgentCardModel } from '@/components/agents/AgentsGrid';
import { CreateAgentButton } from '@/components/agents/CreateAgentButton';
import { AppsList } from '@/components/build/AppsList';
import type { PipelineChipData } from '@/components/pipelines/PipelineChip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import { agentActivity, listManagedAgents } from '@/lib/agents';
import { filterSingleStepApps } from '@/lib/app-model';
import { listApps } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { resolveConsumerChips } from '@/lib/pipeline-chip';
import { listTools } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { MODULES } from '@/modules/registry';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// ─── /build/agents — the AGENTS list (deduped from Studio, Builder-Epic #118 / UX-audit T4) ─────────
// Studio (/build/studio) is the app-centric front door — every app (single- or multi-step) + the
// agent roster. This surface is deliberately the OTHER lens: JUST agents. An agent is a one-step app,
// so this page lists (a) the managed agent roster — built-ins + your custom definitions, each opening
// its own detail (/build/agents/[id]) — and (b) the single-step apps you built (filtered via the pure
// isSimpleAgent predicate), each opening its lifecycle shell (/build/apps/[id]). Multi-step workflows
// live on Studio, not here — that's the distinction that de-dupes the two surfaces.
function planeLabel(id: string): string {
  return MODULES.find((m) => m.id === id)?.label ?? id;
}

export default async function AgentsPage() {
  await requireModuleForUser('agents');
  const orgId = await currentOrgId();
  const [agents, activity, tools, apps] = await Promise.all([
    listManagedAgents(orgId),
    agentActivity(orgId),
    listTools(orgId).catch(() => []),
    listApps(orgId).catch(() => []),
  ]);

  // The distinct list: single-step apps only (an agent IS a one-step app). Multi-step workflows stay
  // on Studio. Resolve each one's "Runs on: <pipeline>" chip in a single batch.
  const singleStepApps = filterSingleStepApps(apps);
  const chipList = await resolveConsumerChips(
    singleStepApps.map((a) => a.pipelineId ?? null),
    orgId,
  );
  const appChips: Record<string, PipelineChipData> = {};
  singleStepApps.forEach((a, i) => {
    appChips[a.id] = chipList[i];
  });

  const customCount = agents.filter((a) => a.custom).length;
  const toolOptions = tools
    .filter((t) => t.enabled)
    .map((t) => ({ id: t.id, name: t.name, policy: t.policy }));

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
  }));

  return (
    <PageFrame>
      {
        <div className="w-full space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Robot className="size-5 text-primary" />
                Agents
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                An agent is the simplest app — a single governed step. This is your agent roster:
                the built-in agents and your own definitions, plus the single-step apps you&rsquo;ve
                built. Open one to view, edit, and run it; build multi-step workflows in{' '}
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
            <Stat label={`Agents (${customCount} yours)`} value={agents.length} />
            <Stat label="Single-step apps" value={singleStepApps.length} />
            <Stat label="Fleet runs (audit)" value={activity.totalRuns.toLocaleString()} />
            <Stat label="Grounded in org knowledge" value={`${activity.groundedShare}%`} />
          </StatRail>

          {/* The agent roster — each card links to its own detail (/build/agents/[id]). */}
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Agent roster</h2>
            <AgentsGrid agents={cards} tools={toolOptions} />
          </div>

          {/* Single-step apps you built — an agent IS a one-step app; each opens its lifecycle shell. */}
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">Single-step apps you built</h2>
            {singleStepApps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No single-step apps yet. Describe an agent in{' '}
                <a
                  href="/build/studio/new"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  the builder
                </a>{' '}
                and it appears here.
              </p>
            ) : (
              <AppsList apps={singleStepApps} chips={appChips} />
            )}
          </div>
        </div>
      }
    </PageFrame>
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
