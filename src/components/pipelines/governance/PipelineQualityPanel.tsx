'use client';

import { ArrowCounterClockwise, CheckCircle, Plus, XCircle } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import type { EvalDef } from '@/lib/eval-defs';
import type { GoldenCase } from '@/lib/evals';
import { FEEDBACK_SUITE } from '@/lib/feedback-map';
import type { RollbackHistoryEntry } from '@/lib/pipeline-release';
import type { ReleaseGateDecision } from '@/lib/release-gate';

// ─── PipelineQualityPanel — the pipeline-scoped Quality surface (mirrors AppQualityPanel) ──────────
// Everything is scoped to ONE pipeline (pipelineId). Its evals run in THIS pipeline's context and can
// gate it; its golden set is its own; the library column attaches an org-wide eval to this pipeline
// (a copy stamped with pipelineId). This is the shipped app-Quality behaviour re-pointed to the
// PIPELINE entity (evals/golden associate via pipeline_id, not app_id).
type RunResult = {
  run?: { score: number; total: number; passed: number };
  computedBy?: string;
  unavailableReason?: string;
};

export function PipelineQualityPanel({
  pipelineId,
  pipelineName,
  status,
  version,
  evals,
  golden,
  libraryEvals,
  rollbacks,
  feedbackCount,
}: Readonly<{
  pipelineId: string;
  pipelineName: string;
  status: string;
  version: number;
  evals: EvalDef[];
  golden: GoldenCase[];
  libraryEvals: EvalDef[];
  rollbacks: RollbackHistoryEntry[];
  feedbackCount: number;
}>) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, RunResult>>({});
  const [gq, setGq] = useState('');
  const [ge, setGe] = useState('');
  const [adding, setAdding] = useState(false);
  const [attaching, setAttaching] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [gate, setGate] = useState<ReleaseGateDecision | null>(null);
  // M1-a: the in-flight gating job (evals running in the background). While set, the tab shows a
  // "gating in progress" state and polls the status route until the job resolves (published|blocked).
  const [gatingJobId, setGatingJobId] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Terminal-state handling for a gating job — surface the verdict + clear the gating state.
  const finishGate = useCallback(
    (job: {
      status: string;
      decision: { decision?: ReleaseGateDecision; overridden?: boolean } | null;
    }) => {
      setGatingJobId(null);
      setPublishing(false);
      const decision = job.decision?.decision ?? null;
      if (decision) setGate(decision);
      if (job.status === 'published') {
        toast.success(
          job.decision?.overridden
            ? 'Published with override — the gate failure is audited.'
            : 'Published — release gate cleared.',
        );
        router.refresh();
      } else {
        toast.error(decision?.summary ?? 'Release gate failed — publish blocked.');
      }
    },
    [router],
  );

  // Poll the status route for the given job until it reaches a terminal state. Self-scheduling; the
  // effect below clears the timer on unmount.
  const pollGate = useCallback(
    async (jobId: string) => {
      try {
        const r = await fetch(
          `/api/v1/admin/pipelines/${pipelineId}/publish/status?jobId=${encodeURIComponent(jobId)}`,
        );
        const job = (await r.json().catch(() => ({}))) as {
          status?: string;
          decision?: { decision?: ReleaseGateDecision; overridden?: boolean } | null;
        };
        if (job.status === 'published' || job.status === 'blocked') {
          finishGate({ status: job.status, decision: job.decision ?? null });
          return;
        }
      } catch {
        /* transient — keep polling */
      }
      pollTimer.current = setTimeout(() => void pollGate(jobId), 2500);
    },
    [pipelineId, finishGate],
  );

  useEffect(() => {
    if (gatingJobId) void pollGate(gatingJobId);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [gatingJobId, pollGate]);

  // Publish THROUGH the release gate. Ungated / no-evals → instant (200). A pipeline WITH evals goes
  // ASYNC (202 {status:'gating', jobId}): the evals run in the background so a slow ragas run never
  // times out the request — the tab polls the status route + surfaces the verdict when it lands.
  async function publish(override: boolean) {
    if (publishing) return;
    setPublishing(true);
    try {
      const r = await fetch(`/api/v1/admin/pipelines/${pipelineId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ override }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        status?: string;
        jobId?: string;
        decision?: ReleaseGateDecision;
        blocked?: boolean;
        overridden?: boolean;
      };

      if (r.status === 202 && data.status === 'gating' && data.jobId) {
        // Async gate accepted — enter gating state; the effect starts polling. Keep `publishing` true
        // so the buttons stay disabled while the evals run.
        setGate(null);
        setGatingJobId(data.jobId);
        toast.info('Running evals — publishing once the release gate clears.');
        return; // do NOT reset publishing here; finishGate clears it on resolve.
      }

      if (data.decision) setGate(data.decision);
      if (r.status === 422 && data.blocked) {
        toast.error(data.decision?.summary ?? 'Release gate failed — publish blocked.');
      } else if (r.ok) {
        toast.success(
          data.overridden
            ? 'Published with override — the gate failure is audited.'
            : 'Published — release gate cleared.',
        );
        router.refresh();
      } else {
        toast.error('Publish failed');
      }
      setPublishing(false);
    } catch {
      toast.error('Publish failed');
      setPublishing(false);
    }
  }

  async function rollback() {
    if (rollingBack) return;
    setRollingBack(true);
    try {
      const r = await fetch(`/api/v1/admin/pipelines/${pipelineId}/rollback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'manual' }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        rolledBack?: boolean;
        toVersion?: number;
        error?: string;
      };
      if (r.ok && data.rolledBack) {
        toast.success(`Rolled back to v${data.toVersion} — the last-good published version.`);
        router.refresh();
      } else {
        toast.error(data.error ?? 'Nothing to roll back to.');
      }
    } finally {
      setRollingBack(false);
    }
  }

  async function runEval(def: EvalDef) {
    setRunning(def.id);
    try {
      const r = await fetch(`/api/v1/admin/eval-defs/${def.id}/run`, { method: 'POST' });
      if (r.ok) {
        const result = (await r.json()) as RunResult;
        setResults((m) => ({ ...m, [def.id]: result }));
        if (result.computedBy === 'unavailable') {
          toast.warning(result.unavailableReason || 'Eval could not score — no result recorded.');
        } else {
          toast.success(`Ran "${def.name}" against ${pipelineName}`);
        }
      } else {
        toast.error('Eval run failed');
      }
    } finally {
      setRunning(null);
    }
  }

  async function attach(def: EvalDef) {
    setAttaching(def.id);
    try {
      // Attach = create a copy of the library eval scoped to THIS pipeline (stamps pipeline_id).
      const r = await fetch('/api/v1/admin/eval-defs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: def.name,
          templateId: def.templateId,
          metric: def.metric,
          engine: def.engine,
          direction: def.direction,
          threshold: def.threshold,
          description: def.description,
          suite: def.suite,
          pipelineId,
        }),
      });
      if (r.ok) {
        toast.success(`Attached "${def.name}" to ${pipelineName}`);
        router.refresh();
      } else toast.error('Could not attach eval');
    } finally {
      setAttaching(null);
    }
  }

  async function addGolden() {
    if (!gq.trim() || !ge.trim() || adding) return;
    setAdding(true);
    try {
      const r = await fetch('/api/v1/admin/golden-cases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: gq.slice(0, 60),
          query: gq,
          expected: ge,
          suite: 'golden',
          pipelineId,
        }),
      });
      if (r.ok) {
        setGq('');
        setGe('');
        toast.success('Golden case added to this pipeline');
        router.refresh();
      } else toast.error('Could not add golden case');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Quality</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Evals and the golden set here belong to{' '}
          <span className="text-foreground">{pipelineName}</span>. They run against this
          pipeline&apos;s own context, so a passing run means <span className="text-foreground">this
          pipeline</span> meets the bar — and it gates this pipeline&apos;s releases.
        </p>
      </div>

      {/* ── Release gate + auto-rollback (M1 close-the-loop) ── */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Release gate</CardTitle>
            <Badge variant="outline" className="capitalize">
              {status} · v{version}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Publishing runs this pipeline&apos;s evals first — a version only goes live if it clears
              them. A failing gate blocks the release (you can override, which is audited).
            </p>
            {gate ? (
              <div
                className={`rounded-md border px-3 py-2 text-sm ${
                  gate.pass
                    ? 'border-primary/40 text-foreground'
                    : 'border-destructive/50 text-foreground'
                }`}
              >
                <div className="flex items-center gap-2">
                  {gate.pass ? (
                    <CheckCircle className="size-4 text-primary" weight="fill" />
                  ) : (
                    <XCircle className="size-4 text-destructive" weight="fill" />
                  )}
                  <span>{gate.summary}</span>
                </div>
                {gate.failing.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {gate.failing.map((f) => (
                      <li key={f.evalId}>
                        {f.name}: {f.score}% &lt; {f.thresholdPct}% threshold
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {gatingJobId ? (
              <div className="flex items-center gap-2 rounded-md border border-primary/40 px-3 py-2 text-sm text-foreground">
                <Spinner />
                <span>
                  Running the release evals — this can take a minute. Publishing automatically once the
                  gate clears; you can leave this page and come back.
                </span>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => publish(false)} disabled={publishing}>
                {publishing ? <Spinner /> : <CheckCircle className="size-4" />}{' '}
                {gatingJobId ? 'Gating…' : 'Publish through gate'}
              </Button>
              {gate && !gate.pass ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => publish(true)}
                  disabled={publishing}
                >
                  Override &amp; publish
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Auto-rollback</CardTitle>
            <span className="text-xs text-muted-foreground">{rollbacks.length} event(s)</span>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              On an eval-gate fail or a drift breach the pipeline rolls back to its last-good published
              version. You can also roll back now.
            </p>
            {rollbacks.length > 0 ? (
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {rollbacks.map((r) => (
                  <div
                    key={`${r.version}-${r.at ?? ''}`}
                    className="rounded-md border border-border bg-background px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">v{r.version}</Badge>
                      <ArrowCounterClockwise className="size-3.5 text-muted-foreground" />
                      <span className="text-foreground">{r.note}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {r.at ? new Date(r.at).toLocaleString() : ''}
                      {r.by ? ` · ${r.by}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No rollbacks yet.</p>
            )}
            <Button size="sm" variant="outline" onClick={rollback} disabled={rollingBack}>
              {rollingBack ? <Spinner /> : <ArrowCounterClockwise className="size-4" />} Roll back to
              last-good
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* This pipeline's evals */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Evals for this pipeline</CardTitle>
            <span className="text-xs text-muted-foreground">{evals.length} attached</span>
          </CardHeader>
          <CardContent className="space-y-2">
            {evals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No evals yet. Attach one from the library below, or create one from the Evals catalog
                and attach it here.
              </p>
            ) : (
              evals.map((d) => {
                const res = results[d.id];
                const pct =
                  res?.run && res.run.total > 0
                    ? Math.round((res.run.passed / res.run.total) * 100)
                    : null;
                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{d.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {d.metric} · {d.engine} · threshold {d.threshold} · {d.direction}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {res?.computedBy === 'unavailable' ? (
                        <span className="text-xs text-muted-foreground">no score</span>
                      ) : pct !== null ? (
                        <span className="flex items-center gap-1 text-xs">
                          {pct >= Math.round(d.threshold * 100) ? (
                            <CheckCircle className="size-4 text-primary" weight="fill" />
                          ) : (
                            <XCircle className="size-4 text-destructive" weight="fill" />
                          )}
                          {pct}% {res?.computedBy ? `· ${res.computedBy}` : ''}
                        </span>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => runEval(d)}
                        disabled={running === d.id}
                      >
                        {running === d.id ? (
                          <>
                            <Spinner /> Running…
                          </>
                        ) : (
                          'Run'
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Golden set for this pipeline */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Golden set for this pipeline ({golden.length})</CardTitle>
            {feedbackCount > 0 ? (
              <Badge variant="outline">{feedbackCount} from feedback</Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Cases marked <span className="text-foreground">feedback</span> were captured from real
              user corrections (app review) and chat ratings — the next eval run is measured against
              them.
            </p>
            {golden.length > 0 ? (
              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {golden.map((g) => (
                  <div key={g.id} className="rounded-md border border-border bg-background px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-sm text-foreground">{g.query}</div>
                      {g.suite === FEEDBACK_SUITE ? (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          feedback
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-muted-foreground">expects: {g.expected}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No golden cases yet — add the questions this pipeline must get right, with their
                expected answers. Evals score against these.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input placeholder="Question / input" value={gq} onChange={(e) => setGq(e.target.value)} />
              <Input placeholder="Expected answer" value={ge} onChange={(e) => setGe(e.target.value)} />
              <Button onClick={addGolden} disabled={adding || !gq.trim() || !ge.trim()}>
                {adding ? <Spinner /> : <Plus className="size-4" />} Add case
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Attach from the org-wide library */}
      {libraryEvals.length > 0 ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Attach from the library</CardTitle>
            <p className="text-xs text-muted-foreground">
              Org-wide evals you can attach to this pipeline. Attaching makes a copy scoped to it.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {libraryEvals.map((d) => (
              <Button
                key={d.id}
                size="sm"
                variant="outline"
                onClick={() => attach(d)}
                disabled={attaching === d.id}
              >
                {attaching === d.id ? <Spinner /> : <Plus className="size-3.5" />} {d.name}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
