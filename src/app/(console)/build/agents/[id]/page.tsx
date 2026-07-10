import { ArrowLeft, Robot } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentCardActions } from '@/components/agents/AgentCardActions';
import { AgentFormPanel } from '@/components/agents/AgentFormPanel';
import { AgentRunner } from '@/components/agents/AgentRunner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PipelineChip } from '@/components/pipelines/PipelineChip';
import { type AgentRun, listAgentRunsByAgent } from '@/lib/agentrun';
import { resolveAgent } from '@/lib/agents';
import { requireModuleForUser } from '@/lib/module-access';
import { resolveConsumerChip } from '@/lib/pipeline-chip';
import { listTools } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { MODULES } from '@/modules/registry';

export const dynamic = 'force-dynamic';

const STATUS_COLOR: Record<string, string> = {
  done: 'bg-primary/10 text-primary',
  blocked: 'bg-destructive/10 text-destructive',
  denied: 'bg-destructive/10 text-destructive',
};

const planeLabel = (id: string) => MODULES.find((m) => m.id === id)?.label ?? id;

function RecentRunsTable({ agentId, runs }: { agentId: string; runs: AgentRun[] }) {
  if (!runs.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No runs yet. Use Run above to execute this agent.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Query</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Checks</TableHead>
            <TableHead>Signed</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="max-w-md truncate text-foreground">{r.query}</TableCell>
              <TableCell>
                <Badge variant="secondary" className={STATUS_COLOR[r.status] ?? ''}>
                  {r.status}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{r.checks.length}</TableCell>
              <TableCell className="text-muted-foreground">
                {r.provenance?.algorithm ?? '—'}
              </TableCell>
              <TableCell>
                <Link
                  href={`/build/agents/${agentId}/runs/${r.id}`}
                  className="text-xs text-primary hover:underline"
                >
                  trace →
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('agents');
  const { id } = await params;
  const orgId = await currentOrgId();
  const agent = await resolveAgent(id, orgId);
  if (!agent) notFound();
  // Agents carry no own pipeline binding — every run flows through the org-default governed pipeline.
  // Name + link it (was a generic "governed pipeline" mention) so the join-key is legible here too.
  const pipeline = await resolveConsumerChip(null, orgId).catch(() => null);
  // Degrade gracefully (matches the sibling listTools().catch below): DB down → no runs, page still renders.
  const runs = await listAgentRunsByAgent(id, 8, orgId).catch(() => []);
  const done = runs.filter((r) => r.status === 'done').length;
  const tools = agent.custom
    ? (await listTools(orgId).catch(() => []))
        .filter((t) => t.enabled)
        .map((t) => ({ id: t.id, name: t.name, policy: t.policy }))
    : [];
  const editable = agent.custom
    ? [
        {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          grounded: agent.grounded,
          trigger: agent.trigger,
          tools: agent.tools,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <Link
        href="/build/agents"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All agents
      </Link>

      <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-3">
          <Robot className="size-6 text-primary" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground">{agent.name}</h1>
              {agent.custom ? (
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  yours
                </Badge>
              ) : null}
              <Badge variant="secondary">{agent.role}</Badge>
              <PipelineChip pipeline={pipeline} size="xs" />
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{agent.description}</p>
          </div>
        </div>
        <AgentCardActions agentId={agent.id} custom={agent.custom} enabled />
      </div>

      {agent.custom ? <AgentFormPanel tools={tools} editable={editable} /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            {agent.systemPrompt ? (
              <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs text-foreground">
                {agent.systemPrompt}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                Built-in agent — answers from retrieved sources via the shared system prompt. Its
                governing pipeline (see the &quot;Runs on&quot; chip above) applies policy,
                guardrails, grounding, and provenance.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Trigger" value={agent.trigger} />
            <Row label="Model" value={agent.model || 'gateway default'} />
            <Row label="Grounded" value={agent.grounded ? 'yes' : 'no'} />
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Tools
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {agent.tools.length ? (
                  agent.tools.map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Needs
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {agent.planes.length ? (
                  agent.planes.map((p) => (
                    <Badge key={p} variant="secondary" className="bg-primary/10 text-primary">
                      {planeLabel(p)}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <AgentRunner agentId={agent.id} />

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">Recent runs</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {runs.length} shown · {done} completed. Each run is traced through the governed
              pipeline.
            </p>
          </div>
          <Link
            href={`/build/agents/${agent.id}/runs`}
            className="text-xs text-primary hover:underline"
          >
            View all runs →
          </Link>
        </CardHeader>
        <CardContent>
          <RecentRunsTable agentId={agent.id} runs={runs} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
