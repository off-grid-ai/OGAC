'use client';

import { ArrowLeft, CheckCircle } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, NativeSelect } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionOutcomeCode, ActionOutcomeRecord } from '@/lib/action-outcome-contract';
import { isoObservedAtFromForm } from '@/lib/action-outcome-request';
import { actionOutcomeDetailHref, appRunHref } from '@/lib/action-outcome-routes';

interface OutcomeEntryFormProps {
  appId: string;
  runId: string;
  stepId: string;
  eventId: string;
  mode: 'observed' | 'corrected';
  initial?: ActionOutcomeRecord;
  defaultCode?: ActionOutcomeCode;
  initialObservedAt: string;
}

function localDateTime(iso: string): string {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function OutcomeEntryForm({
  appId,
  runId,
  stepId,
  eventId,
  mode,
  initial,
  defaultCode = 'accepted',
  initialObservedAt,
}: Readonly<OutcomeEntryFormProps>) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const runHref = appRunHref(appId, runId);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const baseline = String(form.get('baseline') ?? '').trim();
    const revenue = String(form.get('revenue') ?? '').trim();
    if (baseline && !revenue) {
      setError('Enter the result before adding a baseline.');
      setSaving(false);
      return;
    }
    const observedAt = isoObservedAtFromForm(form.get('observedAt'));
    if (!observedAt.ok) {
      setError(observedAt.error);
      setSaving(false);
      return;
    }
    const body = {
      outcomeCode: String(form.get('outcomeCode') ?? ''),
      observedAt: observedAt.value,
      eventId,
      note: String(form.get('note') ?? ''),
      evidenceLinks: [String(form.get('evidenceLink') ?? '')],
      ...(revenue
        ? {
            measurement: {
              metricName: 'Incremental revenue',
              metricUnit: String(form.get('currency') ?? 'INR'),
              resultValue: revenue,
              ...(baseline ? { baselineValue: baseline } : {}),
            },
          }
        : {}),
    };
    const endpoint = `/api/v1/admin/app-runs/${encodeURIComponent(runId)}/actions/${encodeURIComponent(stepId)}/outcomes${
      mode === 'corrected' ? `/${encodeURIComponent(initial!.id)}` : ''
    }`;
    try {
      const response = await fetch(endpoint, {
        method: mode === 'corrected' ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as {
        observation?: ActionOutcomeRecord;
        error?: string;
        errors?: string[];
        reason?: string;
      };
      if (!response.ok || !result.observation) {
        if (response.status === 403) {
          setError('Your role cannot record or correct business results.');
        } else if (response.status === 409) {
          setError('A newer result is already recorded. Refresh before adding another.');
        } else {
          setError(
            result.errors?.join(' ') ||
              result.reason ||
              result.error ||
              'The result was not saved. Nothing changed. Try again.',
          );
        }
        return;
      }
      router.push(actionOutcomeDetailHref(appId, runId, stepId, result.observation.id));
      router.refresh();
    } catch {
      setError('The result was not saved. Nothing changed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full space-y-5">
      <Link
        href={
          mode === 'corrected'
            ? actionOutcomeDetailHref(appId, runId, stepId, initial!.id)
            : runHref
        }
        className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden /> {mode === 'corrected' ? 'Business result' : 'Run'}
      </Link>
      <header>
        <p className="text-[11px] uppercase tracking-wide text-primary">Business result</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">
          {mode === 'corrected' ? 'Correct this result' : 'Record what happened'}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          The system change is already complete. This records what happened afterward.
          {mode === 'corrected' ? ' The original remains in the audit history.' : ''}
        </p>
      </header>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[1.45fr_1fr]">
        <section className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-5">
          <Field>
            <Label htmlFor="outcome-code">What happened?</Label>
            <NativeSelect
              id="outcome-code"
              name="outcomeCode"
              defaultValue={initial?.outcomeCode ?? defaultCode}
              required
            >
              <option value="accepted">Customer accepted</option>
              <option value="rejected">Customer declined</option>
              <option value="converted">Customer converted</option>
              <option value="cured">Account cured</option>
              <option value="settled">Claim settled</option>
            </NativeSelect>
            <FieldDescription>
              Customer results are separate from the relationship manager's approval decision.
            </FieldDescription>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="observed-at">When did this happen?</Label>
              <Input
                id="observed-at"
                name="observedAt"
                type="datetime-local"
                defaultValue={localDateTime(initial?.observedAt ?? initialObservedAt)}
                required
              />
            </Field>
            <Field>
              <Label htmlFor="evidence-link">Evidence reference</Label>
              <Input
                id="evidence-link"
                name="evidenceLink"
                defaultValue={initial?.evidenceLinks[0] ?? runHref}
                required
              />
              <FieldDescription>
                A run, CRM, document or HTTP link another reviewer can open.
              </FieldDescription>
            </Field>
          </div>

          <Field>
            <Label htmlFor="outcome-note">What confirms this result?</Label>
            <Textarea
              id="outcome-note"
              name="note"
              rows={4}
              maxLength={2000}
              defaultValue={initial?.note ?? ''}
              placeholder="Example: Customer accepted during the recorded follow-up call."
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_10rem]">
            <Field>
              <Label htmlFor="baseline">Revenue before this action (optional)</Label>
              <Input
                id="baseline"
                name="baseline"
                type="number"
                step="any"
                min="0"
                defaultValue={initial?.measurement?.baselineValue}
              />
            </Field>
            <Field>
              <Label htmlFor="revenue">Revenue after this action (optional)</Label>
              <Input
                id="revenue"
                name="revenue"
                type="number"
                step="any"
                min="0"
                defaultValue={initial?.measurement?.resultValue}
              />
            </Field>
            <Field>
              <Label htmlFor="currency">Currency</Label>
              <NativeSelect
                id="currency"
                name="currency"
                defaultValue={initial?.measurement?.metricUnit ?? 'INR'}
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </NativeSelect>
            </Field>
          </div>

          {error ? (
            <div ref={errorRef} tabIndex={-1} className="outline-none">
              <FieldError role="alert">{error}</FieldError>
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button asChild variant="outline" className="min-h-11">
              <Link href={runHref}>Cancel</Link>
            </Button>
            <Button type="submit" disabled={saving} className="min-h-11">
              {saving ? 'Saving…' : mode === 'corrected' ? 'Save correction' : 'Record result'}
            </Button>
          </div>
        </section>

        <aside className="min-w-0 rounded-lg border border-border bg-muted/20 p-5">
          <CheckCircle className="size-5 text-primary" aria-hidden />
          <h2 className="mt-3 text-sm font-medium text-foreground">What this creates</h2>
          <ul className="mt-3 space-y-3 text-xs leading-relaxed text-muted-foreground">
            <li>The result is linked to the exact system change shown on this run.</li>
            <li>The time, person, evidence and optional before-and-after values are kept with it.</li>
            <li>If saving is retried, the same result is not added twice.</li>
            <li>A correction or withdrawal keeps the original record for review.</li>
          </ul>
        </aside>
      </div>
    </form>
  );
}
