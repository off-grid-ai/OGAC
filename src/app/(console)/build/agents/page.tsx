import { Plus } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { AgentsGrid, type AgentCardModel } from '@/components/agents/AgentsGrid';
import { CreateAgentButton } from '@/components/agents/CreateAgentButton';
import { SandboxRunner } from '@/components/agents/SandboxRunner';
import { AppsList } from '@/components/build/AppsList';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { agentActivity, listManagedAgents } from '@/lib/agents';
import { listApps } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { listTools } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { MODULES } from '@/modules/registry';

export const dynamic = 'force-dynamic';

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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Apps</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Build once, run everywhere. An app is anything you describe in plain language — a
            one-step agent or a multi-step workflow, built the same way. Every app runs through the
            same governed pipeline: policy gate, guardrails, model routing, retrieval grounding, and
            tamper-evident provenance. Nothing you build can opt out of the conventions set on this
            console.
          </p>
        </div>
        <Button asChild>
          <Link href="/build/studio/new">
            <Plus className="size-4" />
            New app
          </Link>
        </Button>
      </div>

      {/* Apps — the unified builder's output. A single-step app IS an agent; a multi-step app is a
          workflow. One "New app" front door (above) opens the guided builder for both. */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-foreground">Your apps</h2>
        <AppsList apps={apps} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
              Agents ({customCount} yours)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-foreground">{agents.length}</CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
              Fleet runs (audit)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-foreground">
            {activity.totalRuns.toLocaleString()}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
              Grounded in the Brain
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-foreground">
            {activity.groundedShare}%
          </CardContent>
        </Card>
      </div>

      {/* Agents = single-step apps: the built-in roster + your own definitions, still fully editable
          and runnable. "New app" (top) opens the same guided builder; this quick-create adds a bare
          agent definition directly. */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-foreground">Agents</h2>
        <CreateAgentButton />
      </div>

      <AgentsGrid agents={cards} tools={toolOptions} />

      <SandboxRunner />
    </div>
  );
}
