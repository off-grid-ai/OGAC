import { ArrowLeft, SealCheck } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type AgentRun, getAgentRun } from '@/lib/agentrun';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const STATUS_COLOR: Record<string, string> = {
  done: 'bg-primary/10 text-primary',
  blocked: 'bg-destructive/10 text-destructive',
  denied: 'bg-destructive/10 text-destructive',
};

function verdictColor(v: string): string {
  if (v === 'pass' || v === 'ok') return 'bg-primary/10 text-primary';
  if (v === 'blocked' || v === 'fail') return 'bg-destructive/10 text-destructive';
  return 'bg-amber-500/10 text-amber-600';
}

function StepsCard({ run }: { run: AgentRun }) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Pipeline trace</CardTitle>
        <p className="text-xs text-muted-foreground">
          The ordered governed chain — every step recorded with its latency.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {run.steps.map((s, i) => (
          <div key={i} className="flex items-start gap-3 border-l-2 border-primary/30 py-1 pl-3">
            <Badge variant="outline" className="shrink-0">
              {s.kind}
            </Badge>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-foreground">{s.label}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{s.ms}ms</span>
              </div>
              <p className="break-words text-xs text-muted-foreground">{s.detail}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ChecksCard({ run }: { run: AgentRun }) {
  if (!run.checks.length) return null;
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Guardrail &amp; eval checks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {run.checks.map((c, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-foreground">{c.name}</span>
            <div className="flex items-center gap-2">
              {c.detail ? <span className="text-xs text-muted-foreground">{c.detail}</span> : null}
              <Badge variant="secondary" className={verdictColor(c.verdict)}>
                {c.verdict}
                {typeof c.score === 'number' ? ` · ${c.score}` : ''}
              </Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CitationsCard({ run }: { run: AgentRun }) {
  if (!run.citations.length) return null;
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Citations ({run.citations.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {run.citations.map((c) => (
          <div key={c.ref} className="rounded-md border border-border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm text-foreground">{c.title}</span>
              <Badge
                variant="secondary"
                className={c.supported ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}
              >
                {c.supported ? 'supported' : 'weak'} · {c.score}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.snippet}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProvenanceCard({ run }: { run: AgentRun }) {
  if (!run.provenance) return null;
  const p = run.provenance;
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <SealCheck className="size-4 text-primary" />
          Provenance
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {p.algorithm} signature over the answer + citations — tamper-evident, signed {p.signedAt.slice(0, 19).replace('T', ' ')}.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <code className="block break-all rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] text-foreground">
          {p.signature}
        </code>
        {p.publicKey ? (
          <code className="block break-all rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
            {p.publicKey}
          </code>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function RunTracePage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  await requireModuleForUser('agents');
  const { id, runId } = await params;
  const run = await getAgentRun(runId, await currentOrgId());
  if (!run) notFound();

  return (
    <div className="space-y-6">
      <Link
        href={`/build/agents/${id}/runs`}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Run history
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-foreground">Run {run.id}</h1>
        <Badge variant="secondary" className={STATUS_COLOR[run.status] ?? ''}>
          {run.status}
        </Badge>
        {run.provenance ? <Badge variant="outline">signed · {run.provenance.algorithm}</Badge> : null}
        <span className="text-xs text-muted-foreground">
          {run.startedAt.slice(0, 19).replace('T', ' ')}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Query</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-foreground">{run.query}</CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Answer</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-foreground">{run.answer || '—'}</CardContent>
        </Card>
      </div>

      <StepsCard run={run} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChecksCard run={run} />
        <CitationsCard run={run} />
      </div>
      <ProvenanceCard run={run} />
    </div>
  );
}
