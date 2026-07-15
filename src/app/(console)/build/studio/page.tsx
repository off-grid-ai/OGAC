import { Lightning, Robot, Sparkle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { AgentsGrid, type AgentCardModel } from '@/components/agents/AgentsGrid';
import { CreateAgentButton } from '@/components/agents/CreateAgentButton';
import { AppsList } from '@/components/build/AppsList';
import type { PipelineChipData } from '@/components/pipelines/PipelineChip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { agentActivity, listManagedAgents } from '@/lib/agents';
import { listApps } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { resolveConsumerChips } from '@/lib/pipeline-chip';
import { listTools } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { MODULES } from '@/modules/registry';

export const dynamic = 'force-dynamic';

// ─── Studio — the ONE build front door (Builder Epic #118) ────────────────────────────────────────
// The founder's brief: "agent and studio should become one." Studio was a separate visual-canvas
// surface and Apps/Agents was another; they are now ONE roster. Studio lists every app you've built
// (an agent = a one-step app, badged as such) with a single "New app" that opens the guided builder.
// Opening an app goes to ITS OWN surface (/apps/<id>) with the five lifecycle tabs. The agent roster
// (built-ins + your definitions) stays here, fully editable — an agent IS an app, just simpler.
function planeLabel(id: string): string {
  return MODULES.find((m) => m.id === id)?.label ?? id;
}

export default async function StudioPage() {
  await requireModuleForUser('studio');
  const orgId = await currentOrgId();
  const [apps, agents, activity, tools] = await Promise.all([
    listApps(orgId).catch(() => []),
    listManagedAgents(orgId),
    agentActivity(orgId),
    listTools(orgId).catch(() => []),
  ]);

  // Resolve each app's "Runs on: <pipeline>" chip in ONE batch (org governance + name map read once).
  const appChipList = await resolveConsumerChips(
    apps.map((a) => a.pipelineId ?? null),
    orgId,
  );
  const appChips: Record<string, PipelineChipData> = {};
  apps.forEach((a, i) => {
    appChips[a.id] = appChipList[i];
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
    <div className="w-full space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Sparkle className="size-5 text-primary" />
            Studio
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Build once, run everywhere. An app is anything you describe in plain language — a one-step
            agent or a multi-step workflow, built the same way. Every app runs through the same
            governed pipeline: policy gate, guardrails, model routing, retrieval grounding, and
            tamper-evident provenance. Open an app to build, run, monitor, review, and report on it.
          </p>
        </div>
        <Button asChild>
          <Link href="/build/studio/new?mode=chat">
            <Lightning weight="fill" className="size-4" />
            New app
          </Link>
        </Button>
      </div>

      {/* Stat band */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Apps" value={apps.length} />
        <Stat label={`Agents (${customCount} yours)`} value={agents.length} />
        <Stat label="Fleet runs (audit)" value={activity.totalRuns.toLocaleString()} />
        <Stat label="Grounded in org knowledge" value={`${activity.groundedShare}%`} />
      </div>

      {/* Apps — the unified builder's output. A single-step app IS an agent; a multi-step app is a
          workflow. One "New app" front door opens the guided builder for both. */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-foreground">Your apps</h2>
        <AppsList apps={apps} chips={appChips} />
      </div>

      {/* Agents = single-step apps: the built-in roster + your own definitions, still fully editable
          and runnable. "New app" (top) opens the guided builder; this quick-create adds a bare agent
          definition directly. */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Robot className="size-4 text-muted-foreground" />
          Agents
        </h2>
        <CreateAgentButton />
      </div>
      <AgentsGrid agents={cards} tools={toolOptions} />
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
