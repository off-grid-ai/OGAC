'use client';

import { Waveform } from '@phosphor-icons/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  DEFAULT_DRIFT_SHARE_THRESHOLD,
  DRIFT_CATALOG,
  type DriftCatalogItem,
} from '@/lib/drift-catalog';
import type { DriftDisplayStatus, DriftView } from '@/lib/drift-view';
import { cn } from '@/lib/utils';

// ─── PipelineDriftPanel — drift over THIS pipeline's eval-run history ──────────────────────────────
// Drift is a LENS over the pipeline's own run stream (its eval scores split into baseline/current
// windows). The operator picks a drift check (an Evidently preset or per-column stat test — PSI /
// KL / KS — from the shared catalog) + a drift-share threshold, and runs it. Honest: when the
// pipeline has no eval-run history yet, there is nothing to compare — we say so plainly and never
// fabricate a verdict. Runs through the SAME drift path (/api/v1/admin/drift), which degrades to the
// built-in PSI heuristic when Evidently is not configured.

const STATUS_VARIANT: Record<DriftDisplayStatus, string> = {
  stable: 'bg-primary/10 text-primary',
  warning: 'bg-amber-500/10 text-amber-600',
  drift: 'bg-destructive/10 text-destructive',
};

type RunEnvelope = { data: DriftView | null; error: string | null };

export function PipelineDriftPanel({
  pipelineName,
  hasHistory,
  evalCount,
}: {
  pipelineName: string;
  /** True when this pipeline has enough eval-run history to compute drift honestly. */
  hasHistory: boolean;
  /** How many evals are attached (drives the "run an eval first" guidance). */
  evalCount: number;
}) {
  const recommended = DRIFT_CATALOG.filter((i) => i.recommended);
  const [itemId, setItemId] = useState<string>(recommended[0]?.id ?? DRIFT_CATALOG[0]?.id ?? 'psi');
  const [threshold, setThreshold] = useState<number>(DEFAULT_DRIFT_SHARE_THRESHOLD);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunEnvelope | null>(null);

  const selected: DriftCatalogItem | undefined = DRIFT_CATALOG.find((i) => i.id === itemId);

  async function run() {
    setRunning(true);
    try {
      const r = await fetch('/api/v1/admin/drift', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId, driftShareThreshold: threshold }),
      });
      const env = (await r.json().catch(() => null)) as RunEnvelope | null;
      if (r.ok && env) {
        setResult(env);
        if (env.data) toast.success(`Drift check complete — ${env.data.status}`);
        else toast.warning(env.error || 'Drift could not be computed.');
      } else {
        toast.error('Drift run failed');
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Waveform className="size-4" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Drift</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Quality and data drift over <span className="text-foreground">{pipelineName}</span>&apos;s
            own eval-run history — the recent window compared to a baseline. Pick a check, set the
            drift-share threshold, and run it.
          </p>
        </div>
      </div>

      {!hasHistory ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">No run history to compare yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Drift needs a history of eval runs for this pipeline to split into a baseline and a
              current window.{' '}
              {evalCount === 0
                ? 'Attach an eval on the Quality tab and run it a few times, then come back here.'
                : 'Run this pipeline’s evals a few times on the Quality tab to build up history, then run a drift check.'}{' '}
              We won’t show a verdict until there’s real data to compare — no fabricated scores.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        {/* Configure a drift check for this pipeline */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Configure a check</CardTitle>
            <p className="text-xs text-muted-foreground">
              Standard drift presets and stat tests (PSI · KL · KS · …). Without the drift
              collector, the built-in PSI heuristic runs and still honours the threshold.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-foreground">Drift check</div>
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {DRIFT_CATALOG.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setItemId(item.id)}
                    className={cn(
                      'w-full rounded-md border px-3 py-2 text-left transition-colors',
                      item.id === itemId
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border hover:bg-muted',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{item.name}</span>
                      <span className="flex items-center gap-1">
                        {item.recommended ? (
                          <Badge variant="secondary" className="text-[10px]">
                            recommended
                          </Badge>
                        ) : null}
                        <Badge variant="outline" className="text-[10px]">
                          {item.kind}
                        </Badge>
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{item.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                Drift-share threshold (0–1) — drift when the share of drifted features reaches this
              </span>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="max-w-32"
              />
            </label>

            <Button onClick={run} disabled={running || !hasHistory}>
              {running ? (
                <>
                  <Spinner /> Running…
                </>
              ) : (
                'Run drift check'
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Result */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Result</CardTitle>
            {result?.data ? (
              <Badge variant="secondary" className={STATUS_VARIANT[result.data.status]}>
                {result.data.status}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {!result ? (
              <p className="text-sm text-muted-foreground">
                {selected
                  ? `Selected: ${selected.name}. Run the check to see this pipeline's drift verdict.`
                  : 'Pick a check and run it.'}
              </p>
            ) : result.error || !result.data ? (
              <p className="text-sm text-muted-foreground">
                Could not compute drift{result.error ? `: ${result.error}` : ''}. This surface stays
                reachable and will populate once there is eval-run history to compare.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Engine: {result.data.engine} · baseline {result.data.baseline} vs current{' '}
                  {result.data.current} samples
                  {result.data.driftScore !== null ? ` · score ${result.data.driftScore}` : ''}
                </p>
                {result.data.note ? (
                  <p className="text-sm text-muted-foreground">{result.data.note}</p>
                ) : null}
                {result.data.features.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No per-feature drift signals reported.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {result.data.features.map((f) => (
                      <div
                        key={f.name}
                        className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                      >
                        <span className="text-sm text-foreground">{f.name}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {f.score === null ? '—' : f.score}
                          </span>
                          <Badge variant="secondary" className={STATUS_VARIANT[f.status]}>
                            {f.status}
                          </Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
