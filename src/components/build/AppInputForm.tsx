'use client';

import { CheckCircle, Play, Warning } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CasePicker } from '@/components/build/CasePicker';
import { runInputPrompt } from '@/lib/app-input-prompt';
import type { AppSpec, FormField } from '@/lib/app-model';

// ─── AppInputForm (Builder Epic Phase 3A) — the INPUT screen (screen 2 of 5) ─────────────────────
//
// Renders a structured input form from the saved AppSpec's `inputForm` (FormField[]), collects the
// run inputs, and submits them to the app's inline test-run route (POST /apps/[id]/run) which drives
// the Phase 2A executor. It shows the per-step trace + final outcome the run returns. If a `human`
// step is hit the run pauses (status awaiting_human) — screens 3 (live status) + 4 (review) are
// later phases; this leaves a clear seam (the returned steps already carry per-step status).
//
// If the app declares no inputForm, we still offer a single free-text "input" so the app is runnable.

type RunStep = {
  stepId: string;
  kind: string;
  status: string;
  output?: string;
  detail?: string;
};
type RunOutcome = { runId: string; status: string; steps: RunStep[]; outcome: string };

export function AppInputForm({
  app,
  exampleSubject,
}: Readonly<{
  app: AppSpec;
  /** A subject line from a REAL previous run of this app, used as the entry example. */
  exampleSubject?: string | null;
}>) {
  // With no declared inputForm the fallback used to be a lone required field labelled "Input", which
  // told the reader nothing about what to type. The prompt is now derived from the app itself and quotes
  // a real previous case — see src/lib/app-input-prompt.ts and docs/APP_AS_PRODUCT.md §3 (hand-authored
  // per-app form fields are explicitly NOT the answer).
  const prompt = runInputPrompt({ trigger: app.trigger?.kind, exampleSubject });
  // GAP 0: pick a real record instead of typing a description of one. Only offered when the app declares no
  // form of its own — an app WITH declared fields already knows exactly what it needs.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const fields: FormField[] =
    app.inputForm && app.inputForm.length > 0
      ? app.inputForm
      : [{ key: 'input', label: prompt.label, type: 'text', required: true }];
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [rehearsed, setRehearsed] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);

  const missing = fields.filter((f) => f.required && !values[f.key]?.trim());

  async function run(rehearse = false) {
    if (running || missing.length > 0) return;
    setRunning(true);
    setOutcome(null);
    setRehearsed(rehearse);
    try {
      const res = await fetch(`/api/v1/admin/apps/${app.id}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // REHEARSE ON A REAL CASE. Shadow mode and the case picker both already existed; nothing joined
        // them, so testing before publishing was an act of faith. In shadow every side-effecting step is
        // intercepted and reports what it WOULD have done — the decision itself is made for real, which
        // is the whole point: you see the judgement without the consequence.
        body: JSON.stringify({ input: values, ...(rehearse ? { mode: 'shadow' } : {}) }),
      });
      if (!res.ok) throw new Error('The run could not be started');
      const data = (await res.json()) as RunOutcome;
      setOutcome(data);
      if (data.status === 'error') toast.error('The run hit an error — see the trace below.');
      else if (data.status === 'awaiting_human') toast.info('Paused for human review.');
      else if (rehearse) toast.success('Rehearsal finished — nothing was actually sent or changed.');
      else toast.success('Run complete.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Start a case</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* The guidance sits in the CONTENT, not the header: CardHeader lays its children out in a
            grid, so a sibling paragraph landed in the title's cell and overlapped it. */}
          {!app.inputForm || app.inputForm.length === 0 ? (
            <>
              {/* The org's own records come FIRST. Typing is the fallback beneath them, not the front door. */}
              <CasePicker
                appId={app.id}
                selectedId={pickedId}
                onPick={(candidate) => {
                  setPickedId(candidate.id);
                  // The run receives the WHOLE record, so nothing is re-typed and nothing must be parsed
                  // back out of prose. The readable label goes in `input` for the case subject.
                  setValues((v) => ({
                    ...v,
                    input: [candidate.label, candidate.detail].filter(Boolean).join(' · '),
                    case_record: JSON.stringify(candidate.record),
                  }));
                }}
              />
              <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                Or describe it by hand: {prompt.hint}
              </p>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Fill in the details for this case, then start it.
            </p>
          )}
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {f.label}
                {f.required ? <span className="text-destructive"> *</span> : null}
              </Label>
              {f.type === 'select' && f.options?.length ? (
                <select
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">— choose —</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  type={htmlInputType(f.type)}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={
                    f.type === 'file'
                      ? 'File reference / path'
                      : // Only the derived single field carries the real-case example.
                        (f.key === 'input' && prompt.placeholder) || undefined
                  }
                />
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {/* REHEARSE FIRST. Testing before publishing was an act of faith: shadow mode existed as a
                setting and the case picker existed, and nothing joined them. The decision is made for
                real; only the side effects are intercepted — you see the judgement without the
                consequence, which is the only kind of test worth running on someone's real data. */}
            <p className="text-[11px] text-muted-foreground">
              A rehearsal makes the real decision but sends nothing and changes nothing.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => run(true)}
                disabled={running || missing.length > 0}
                className="gap-1.5"
              >
                <Play className="size-4" />
                {running && rehearsed ? 'Rehearsing…' : 'Rehearse it'}
              </Button>
              <Button
                onClick={() => run(false)}
                disabled={running || missing.length > 0}
                className="gap-1.5"
              >
                <Play className="size-4" weight="fill" />
                {running && !rehearsed ? 'Running…' : 'Run for real'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {outcome ? <RunTrace outcome={outcome} /> : null}
    </div>
  );
}

// The per-step trace + outcome. A seam for the live-status screen (Phase 3/4): today it renders the
// completed run's steps; a streaming version will render the same shape as it fills.
function RunTrace({ outcome }: Readonly<{ outcome: RunOutcome }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm">Run result</CardTitle>
        <StatusBadge status={outcome.status} />
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="space-y-1.5">
          {outcome.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{s.kind}</span>
                  <StatusBadge status={s.status} small />
                </div>
                {s.output ? (
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] text-foreground">
                    {s.output}
                  </pre>
                ) : null}
                {s.detail ? <p className="mt-1 text-[11px] text-muted-foreground">{s.detail}</p> : null}
              </div>
            </li>
          ))}
        </ol>
        {outcome.outcome ? (
          <div className="rounded-md border border-primary/25 bg-primary/[0.04] p-3">
            <p className="text-[11px] uppercase tracking-wide text-primary/80">Outcome</p>
            <pre className="mt-1 whitespace-pre-wrap text-sm text-foreground">{outcome.outcome}</pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// Map a form-field type to the HTML <input type>: number/date pass through, everything else is text.
function htmlInputType(type: FormField['type']): 'number' | 'date' | 'text' {
  if (type === 'number') return 'number';
  if (type === 'date') return 'date';
  return 'text';
}

// Status pill colour: error → destructive, done → primary, otherwise (running/pending) → amber.
function statusBadgeClass(ok: boolean, err: boolean): string {
  if (err) return 'bg-destructive/10 text-destructive';
  if (ok) return 'bg-primary/10 text-primary';
  return 'bg-amber-500/10 text-amber-600 dark:text-amber-500';
}

function StatusBadge({ status, small }: Readonly<{ status: string; small?: boolean }>) {
  const ok = status === 'done';
  const err = status === 'error';
  const cls = statusBadgeClass(ok, err);
  return (
    <Badge variant="secondary" className={`${cls} ${small ? 'text-[10px]' : ''} gap-1`}>
      {ok ? <CheckCircle className="size-3" /> : err ? <Warning className="size-3" /> : null}
      {status}
    </Badge>
  );
}

