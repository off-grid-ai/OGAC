import { ArrowLeft, CheckCircle, Clock, PauseCircle, Pulse, XCircle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { StatRail } from '@/components/ui/StatRail';
import { getAgentRun } from '@/lib/agentrun';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { getRunByKey } from '@/lib/runs-monitor-reader';
import { type RunStatus, describeDuration, kindLabel, statusLabel } from '@/lib/runs-monitor';

export const dynamic = 'force-dynamic';

// ─── Operations → Runs → detail (generic run detail for agent + chat runs) ────────────────────────
// App runs deep-link to their own per-app run page (which has the live step tracker + review). This
// generic detail serves agent + chat runs: it resolves the `${kind}:${id}` key, shows the normalized
// header (kind/status/started/duration/pipeline/actor), and — for agent runs — the recorded step
// timeline + answer/checks. Deep-linkable at /operations/runs/<key>.
export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('runs');
  const { id } = await params;
  const key = decodeURIComponent(id);
  const orgId = await currentOrgId();

  const row = await getRunByKey(key, orgId);
  if (!row) notFound();

  // App runs have a richer per-app page — send the operator there.
  if (row.kind === 'app') redirect(row.href);

  const agent = row.kind === 'agent' ? await getAgentRun(row.id, orgId) : null;

  return (
    <div className="w-full space-y-5">
      <div>
        <Link
          href="/operations/runs"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> All runs
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Pulse className="size-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">{row.name}</h1>
              <p className="text-sm text-muted-foreground">
                {kindLabel(row.kind)} run · <span className="font-mono">{row.id}</span>
              </p>
            </div>
          </div>
          <StatusBadge status={row.status} />
        </div>
      </div>

      {/* Metadata band — horizontal rail on mobile, restored 4-col grid at sm+ (desktop unchanged). */}
      <StatRail at="sm" cols={4}>
        <Meta label="Kind" value={kindLabel(row.kind)} />
        <Meta label="Started" value={row.startedAt ? new Date(row.startedAt).toLocaleString() : '—'} />
        <Meta label="Duration" value={describeDuration(row.durationMs)} />
        <Meta label="Pipeline" value={row.pipeline} mono />
        <Meta label="Actor" value={row.actor || '—'} />
        <Meta label="Status" value={statusLabel(row.status)} />
      </StatRail>

      {/* Agent run — recorded step timeline + answer + checks */}
      {agent ? (
        <div className="space-y-4">
          {agent.query ? (
            <Section title="Query">
              <pre className="whitespace-pre-wrap text-sm text-foreground">{agent.query}</pre>
            </Section>
          ) : null}

          {agent.steps.length > 0 ? (
            <Section title="Timeline">
              <ol className="space-y-1.5">
                {agent.steps.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2"
                  >
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{s.label}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {s.kind}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {s.ms >= 1000 ? `${(s.ms / 1000).toFixed(1)}s` : `${s.ms}ms`}
                        </span>
                      </div>
                      {s.detail ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">{s.detail}</p>
                      ) : null}
                      {s.refs && s.refs.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {s.refs.map((r, j) => (
                            <span
                              key={j}
                              className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}

          {agent.checks && agent.checks.length > 0 ? (
            <Section title="Guardrail checks">
              <div className="flex flex-wrap gap-2">
                {agent.checks.map((c, i) => (
                  <span
                    key={i}
                    className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
                  >
                    {c.name}: {c.verdict}
                  </span>
                ))}
              </div>
            </Section>
          ) : null}

          {agent.answer ? (
            <Section title="Answer">
              <pre className="whitespace-pre-wrap text-sm text-foreground">{agent.answer}</pre>
            </Section>
          ) : null}

          {agent.provenance ? (
            <p className="truncate text-[10px] text-muted-foreground" title={agent.provenance.signature}>
              Signed {agent.provenance.algorithm} · {agent.provenance.signature.slice(0, 24)}…
            </p>
          ) : null}
        </div>
      ) : row.kind === 'chat' ? (
        <Section title="Chat run">
          <p className="text-sm text-muted-foreground">
            A governed chat turn — recorded with its guardrail outcome and correlated by run id for
            the audit trail. Open the conversation to see the full exchange.
          </p>
        </Section>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  const cls =
    status === 'succeeded'
      ? 'bg-primary/10 text-primary'
      : status === 'failed'
        ? 'bg-destructive/10 text-destructive'
        : status === 'paused'
          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-500'
          : status === 'running'
            ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
            : 'bg-muted text-muted-foreground';
  const Icon =
    status === 'succeeded'
      ? CheckCircle
      : status === 'failed'
        ? XCircle
        : status === 'paused'
          ? PauseCircle
          : Clock;
  return (
    <Badge variant="secondary" className={`${cls} gap-1`}>
      <Icon className="size-3.5" weight="fill" />
      {statusLabel(status)}
    </Badge>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate text-sm text-foreground ${mono ? 'font-mono text-xs' : ''}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-4">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}
