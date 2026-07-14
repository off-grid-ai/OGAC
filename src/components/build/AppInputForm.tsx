'use client';

import { CheckCircle, Play, Warning } from '@phosphor-icons/react/dist/ssr';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { applyInputDefaults, coerceInputValues, validateInputValues } from '@/lib/app-inputs';
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

export function AppInputForm({ app }: Readonly<{ app: AppSpec }>) {
  const fields: FormField[] = app.inputForm && app.inputForm.length > 0 ? app.inputForm : FALLBACK_FIELDS;
  // Seed from each field's declared default so the form opens pre-filled where the builder said so.
  const [values, setValues] = useState<Record<string, string>>(() => applyInputDefaults(fields));
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  // Per-field errors: seeded from a server 400 (fieldErrors) or from the local validator on submit.
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Live validity (the same pure rule the server enforces) drives the Run button's enabled state.
  const validation = useMemo(() => validateInputValues(fields, values), [fields, values]);

  function setValue(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    // Clear a field's error as the user edits it.
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  }

  async function run() {
    if (running) return;
    const check = validateInputValues(fields, values);
    if (!check.ok) {
      setErrors(check.errors);
      toast.error('Fix the highlighted fields, then run.');
      return;
    }
    setRunning(true);
    setOutcome(null);
    setErrors({});
    try {
      const res = await fetch(`/api/v1/admin/apps/${app.id}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: coerceInputValues(fields, values) }),
      });
      if (res.status === 400) {
        const body = (await res.json().catch(() => ({}))) as {
          fieldErrors?: Record<string, string>;
        };
        setErrors(body.fieldErrors ?? {});
        throw new Error('Some inputs were rejected — see the highlighted fields.');
      }
      if (!res.ok) throw new Error('The run could not be started');
      const data = (await res.json()) as RunOutcome;
      setOutcome(data);
      if (data.status === 'error') toast.error('The run hit an error — see the trace below.');
      else if (data.status === 'awaiting_human') toast.info('Paused for human review.');
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
          <CardTitle className="text-sm">Run inputs</CardTitle>
          <p className="text-xs text-muted-foreground">
            Fill in what this run needs, then run it through the governed pipeline.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {fields.map((f) => (
            <FieldRow
              key={f.key}
              field={f}
              value={values[f.key] ?? ''}
              error={errors[f.key]}
              onChange={(val) => setValue(f.key, val)}
            />
          ))}
          <div className="flex items-center justify-end pt-1">
            <Button onClick={run} disabled={running || !validation.ok} className="gap-1.5">
              <Play className="size-4" weight="fill" />
              {running ? 'Running…' : 'Run'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {outcome ? <RunTrace outcome={outcome} /> : null}
    </div>
  );
}

// One input field — renders the right control for the field's type (select / textarea / typed
// input), its optional help text and placeholder, and an inline validation error when present.
function FieldRow({
  field,
  value,
  error,
  onChange,
}: Readonly<{
  field: FormField;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}>) {
  const invalid = !!error;
  const describedBy = field.description ? `${field.key}-help` : undefined;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {field.label}
        {field.required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {field.description ? (
        <p id={describedBy} className="text-[11px] text-muted-foreground/80">
          {field.description}
        </p>
      ) : null}
      <FieldControl field={field} value={value} invalid={invalid} onChange={onChange} />
      {error ? (
        <p className="flex items-center gap-1 text-[11px] text-destructive">
          <Warning className="size-3" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

const INVALID_RING = 'border-destructive focus-visible:ring-destructive';

function FieldControl({
  field,
  value,
  invalid,
  onChange,
}: Readonly<{
  field: FormField;
  value: string;
  invalid: boolean;
  onChange: (v: string) => void;
}>) {
  if (field.type === 'select' && field.options?.length) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-9 w-full rounded-md border bg-background px-2 text-sm ${invalid ? INVALID_RING : 'border-border'}`}
      >
        <option value="">{field.placeholder ?? '— choose —'}</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'textarea') {
    return (
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={field.placeholder}
        className={`text-sm ${invalid ? INVALID_RING : ''}`}
      />
    );
  }
  return (
    <Input
      type={htmlInputType(field.type)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder ?? (field.type === 'file' ? 'File reference / path' : undefined)}
      className={invalid ? INVALID_RING : undefined}
    />
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

const FALLBACK_FIELDS: FormField[] = [
  { key: 'input', label: 'Input', type: 'text', required: true },
];
