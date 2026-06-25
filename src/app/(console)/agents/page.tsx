import { Robot } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { AgentCardActions } from '@/components/agents/AgentCardActions';
import { CreateAgentButton } from '@/components/agents/CreateAgentButton';
import { SandboxRunner } from '@/components/agents/SandboxRunner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { agentActivity, listAllAgents } from '@/lib/agents';
import { requireModule } from '@/lib/modules';
import { MODULES } from '@/modules/registry';

export const dynamic = 'force-dynamic';

const TRIGGER: Record<string, string> = {
  'on-call': 'bg-blue-500/10 text-blue-600',
  'on-message': 'bg-blue-500/10 text-blue-600',
  observed: 'bg-primary/10 text-primary',
  scheduled: 'bg-amber-500/10 text-amber-600',
  'on-demand': 'bg-muted text-muted-foreground',
};

function planeLabel(id: string): string {
  return MODULES.find((m) => m.id === id)?.label ?? id;
}

export default async function AgentsPage() {
  requireModule('agents');
  const [agents, activity] = await Promise.all([listAllAgents(), agentActivity()]);
  const customCount = agents.filter((a) => a.custom).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Author an agent in plain language. Every agent — built-in or yours — runs through the same
          governed pipeline: policy gate, guardrails, model routing, retrieval grounding, and
          tamper-evident provenance. No agent can opt out of the conventions set on this console.
        </p>
        <CreateAgentButton />
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
              Agents ({customCount} yours)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-foreground">
            {agents.length}
          </CardContent>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {agents.map((a) => (
          <Card key={a.id} className="shadow-sm">
            <CardHeader className="space-y-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Robot className="size-5 text-primary" />
                  <Link href={`/agents/${a.id}`} className="hover:text-primary">
                    <CardTitle className="text-sm">{a.name}</CardTitle>
                  </Link>
                  {a.custom ? (
                    <Badge variant="secondary" className="bg-primary/10 text-primary">
                      yours
                    </Badge>
                  ) : null}
                </div>
                <Badge variant="secondary">{a.role}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {a.description || a.systemPrompt || 'No description.'}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className={TRIGGER[a.trigger]}>
                  {a.trigger}
                </Badge>
                {a.grounded ? (
                  <Badge variant="secondary" className="bg-primary/10 text-primary">
                    grounded
                  </Badge>
                ) : null}
                {a.tools.map((t) => (
                  <Badge key={t} variant="outline">
                    {t}
                  </Badge>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    Needs
                  </span>
                  {a.planes.length ? (
                    a.planes.map((p) => (
                      <Badge key={p} variant="secondary" className="bg-primary/10 text-primary">
                        {planeLabel(p)}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
                <AgentCardActions agentId={a.id} custom={a.custom} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <SandboxRunner />
    </div>
  );
}
