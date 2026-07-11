'use client';

import { CheckCircle, Plus, XCircle } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import type { EvalDef } from '@/lib/eval-defs';
import type { GoldenCase } from '@/lib/evals';

// Per-pipeline Quality surface (#154/#158). Everything here is scoped to ONE pipeline (appId):
// its evals run in THIS pipeline's context and can gate it; its golden set is its own; the library
// column lets you attach an org-wide eval to this pipeline. Makes "what does this apply to / where do
// I run it" obvious — it applies to, and runs against, this pipeline.
type RunResult = { run?: { score: number; total: number; passed: number }; computedBy?: string };

export function AppQualityPanel({
  appId,
  appTitle,
  evals,
  golden,
  libraryEvals,
}: Readonly<{
  appId: string;
  appTitle: string;
  evals: EvalDef[];
  golden: GoldenCase[];
  libraryEvals: EvalDef[];
}>) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, RunResult>>({});
  const [gq, setGq] = useState('');
  const [ge, setGe] = useState('');
  const [adding, setAdding] = useState(false);
  const [attaching, setAttaching] = useState<string | null>(null);

  async function runEval(def: EvalDef) {
    setRunning(def.id);
    try {
      const r = await fetch(`/api/v1/admin/eval-defs/${def.id}/run`, { method: 'POST' });
      if (r.ok) {
        const result = (await r.json()) as RunResult;
        setResults((m) => ({ ...m, [def.id]: result }));
        toast.success(`Ran "${def.name}" against ${appTitle}`);
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
      // Attach = create a copy of the library eval scoped to this pipeline.
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
          appId,
        }),
      });
      if (r.ok) {
        toast.success(`Attached "${def.name}" to ${appTitle}`);
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
        body: JSON.stringify({ name: gq.slice(0, 60), query: gq, expected: ge, suite: 'golden', appId }),
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
          Evals and the golden set here belong to <span className="text-foreground">{appTitle}</span>.
          They run against this pipeline&apos;s own context (its data, knowledge, and model), so a
          passing run means <span className="text-foreground">this pipeline</span> meets the bar — not
          the gateway in the abstract.
        </p>
      </div>

      {/* This pipeline's evals */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Evals for this pipeline</CardTitle>
          <span className="text-xs text-muted-foreground">{evals.length} attached</span>
        </CardHeader>
        <CardContent className="space-y-2">
          {evals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No evals yet. Attach one from the library below, or create one from the Evals catalog and
              attach it here.
            </p>
          ) : (
            evals.map((d) => {
              const res = results[d.id];
              const pct = res?.run && res.run.total > 0 ? Math.round((res.run.passed / res.run.total) * 100) : null;
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
                    {pct !== null ? (
                      <span className="flex items-center gap-1 text-xs">
                        {pct >= Math.round(d.threshold * 100) ? (
                          <CheckCircle className="size-4 text-primary" weight="fill" />
                        ) : (
                          <XCircle className="size-4 text-destructive" weight="fill" />
                        )}
                        {pct}% {res?.computedBy ? `· ${res.computedBy}` : ''}
                      </span>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => runEval(d)} disabled={running === d.id}>
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
        <CardHeader>
          <CardTitle className="text-sm">Golden set for this pipeline ({golden.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {golden.length > 0 ? (
            <div className="space-y-1.5">
              {golden.map((g) => (
                <div key={g.id} className="rounded-md border border-border bg-background px-3 py-2">
                  <div className="text-sm text-foreground">{g.query}</div>
                  <div className="text-[11px] text-muted-foreground">expects: {g.expected}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No golden cases yet — add the questions this pipeline must get right, with their expected
              answers. Evals score against these.
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
