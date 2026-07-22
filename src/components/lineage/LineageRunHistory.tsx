import { ArrowRight, Clock, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  type JobRefView,
  type RunHistoryRow,
  type RunHistoryView,
  type RunState,
  formatDuration,
} from '@/lib/marquez-lineage';

// Real Marquez run history for a namespace — list (jobs) → detail (one job's runs with state, real
// timing, the NominalTimeRunFacet business-time window, and the facets Marquez holds). URL-driven
// via ?job= so the detail is deep-linkable and Back-coherent (per the nav rule). Server-rendered.

const STATE_TONE: Record<RunState, string> = {
  COMPLETED: 'bg-primary/10 text-primary border-primary/20',
  FAILED: 'bg-destructive/10 text-destructive border-destructive/20',
  RUNNING: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  ABORTED: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  NEW: 'bg-muted text-muted-foreground border-border',
  UNKNOWN: 'bg-muted text-muted-foreground border-border',
};

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function pct(n: number | null): string {
  return n === null ? '—' : `${Math.round(n * 100)}%`;
}

interface Props {
  namespace: string | null;
  jobs: JobRefView[];
  selectedJob: string | null;
  history: RunHistoryView | null;
  error: string | null;
  jobHref: (job: string) => string;
}

export function LineageRunHistory({
  namespace,
  jobs,
  selectedJob,
  history,
  error,
  jobHref,
}: Readonly<Props>) {
  if (error) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-16 text-center text-sm text-destructive">
          Lineage store unreachable: {error}
        </CardContent>
      </Card>
    );
  }
  if (!jobs.length) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          No jobs recorded in {namespace ?? 'this namespace'} yet. Run a governed pipeline or agent
          and its runs — with state, timing, and facets — appear here.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
      <JobList jobs={jobs} selectedJob={selectedJob} jobHref={jobHref} />
      <RunDetail history={history} selectedJob={selectedJob} />
    </div>
  );
}

function JobList({
  jobs,
  selectedJob,
  jobHref,
}: Readonly<Pick<Props, 'jobs' | 'selectedJob' | 'jobHref'>>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <TreeStructure className="size-4 text-primary" />
          Jobs ({jobs.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {jobs.map((job) => {
          const active = job.name === selectedJob;
          return (
            <Link
              key={job.name}
              href={jobHref(job.name)}
              scroll={false}
              title={job.name}
              className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-xs transition-colors ${
                active
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-transparent hover:border-border hover:bg-muted/50'
              }`}
            >
              <span className="truncate font-mono text-foreground">{job.label}</span>
              <Badge variant="outline" className={`shrink-0 text-[9px] ${STATE_TONE[job.lastRunState]}`}>
                {job.lastRunState}
              </Badge>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

function RunDetail({
  history,
  selectedJob,
}: Readonly<{ history: RunHistoryView | null; selectedJob: string | null }>) {
  if (!selectedJob || !history) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          Select a job to see its run history — state, start/end timing, duration, and the
          business-time (nominal) window each run carries.
        </CardContent>
      </Card>
    );
  }

  const s = history.summary;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Runs" value={String(s.total)} />
        <Stat label="Success rate" value={pct(s.successRate)} />
        <Stat label="Avg duration" value={formatDuration(s.avgDurationMs)} />
        <Stat label="Last run" value={fmtTime(s.lastRunAt)} mono />
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Clock className="size-4 text-primary" />
            <span className="truncate font-mono" title={history.job}>
              {history.jobLabel}
            </span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {s.completed} completed · {s.failed} failed · {s.running} running · {s.other} other
          </p>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {history.runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, mono }: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate text-sm font-semibold text-foreground ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function RunRow({ run }: Readonly<{ run: RunHistoryRow }>) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={`text-[9px] ${STATE_TONE[run.state]}`}>
          {run.state}
        </Badge>
        <span className="font-mono text-[10px] text-muted-foreground" title={run.id}>
          {run.id.slice(0, 12)}
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs text-foreground">
          <Clock className="size-3 text-muted-foreground" />
          {formatDuration(run.durationMs)}
          {run.durationDerived ? (
            <span className="text-[9px] text-muted-foreground" title="Computed from start/end bounds">
              (derived)
            </span>
          ) : null}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
        <span>Started: {fmtTime(run.startedAt)}</span>
        <span>Ended: {fmtTime(run.endedAt)}</span>
        {run.hasNominalTime ? (
          <span className="sm:col-span-2">
            Business time: {fmtTime(run.nominalStartTime)} → {fmtTime(run.nominalEndTime)}
            {run.nominalDurationMs !== null ? ` (${formatDuration(run.nominalDurationMs)})` : ''}
          </span>
        ) : null}
      </div>

      <RunDatasets inputs={run.inputs} outputs={run.outputs} />
      <RunFacets facetNames={run.facetNames} />
    </div>
  );
}

function RunDatasets({ inputs, outputs }: Readonly<{ inputs: string[]; outputs: string[] }>) {
  if (!inputs.length && !outputs.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
      {inputs.map((i) => (
        <Badge key={`in-${i}`} variant="outline" className="max-w-[12rem] truncate" title={i}>
          {i}
        </Badge>
      ))}
      {inputs.length && outputs.length ? (
        <ArrowRight className="size-3 text-muted-foreground" />
      ) : null}
      {outputs.map((o) => (
        <Badge
          key={`out-${o}`}
          variant="secondary"
          className="max-w-[12rem] truncate bg-primary/10 text-primary"
          title={o}
        >
          {o}
        </Badge>
      ))}
    </div>
  );
}

function RunFacets({ facetNames }: Readonly<{ facetNames: string[] }>) {
  if (!facetNames.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {facetNames.map((f) => (
        <span
          key={f}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
        >
          {f}
        </span>
      ))}
    </div>
  );
}
