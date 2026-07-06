import { AgentsGrid, type AgentCardModel } from '@/components/agents/AgentsGrid';
import { CreateAgentButton } from '@/components/agents/CreateAgentButton';
import { SandboxRunner } from '@/components/agents/SandboxRunner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { agentActivity, listManagedAgents } from '@/lib/agents';
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
  const [agents, activity, tools] = await Promise.all([
    listManagedAgents(),
    agentActivity(),
    listTools(await currentOrgId()).catch(() => []),
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
          <h1 className="text-lg font-semibold text-foreground">Agents</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Author an agent in plain language. Every agent — built-in or yours — runs through the
            same governed pipeline: policy gate, guardrails, model routing, retrieval grounding, and
            tamper-evident provenance. No agent can opt out of the conventions set on this console.
          </p>
        </div>
        <CreateAgentButton />
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

      <AgentsGrid agents={cards} tools={toolOptions} />

      <SandboxRunner />
    </div>
  );
}
