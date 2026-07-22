'use client';

import { CheckCircle } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, NativeSelect } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionReceipt } from '@/lib/action-contract';
import type { ActionOutcomeRecord } from '@/lib/action-outcome-contract';
import { isoObservedAtFromForm } from '@/lib/action-outcome-request';

interface CrossSellOutcomeEntryProps {
  slug: string;
  customerId: string;
  receipt: ActionReceipt;
  mode: 'initial' | 'conversion';
}

export function CrossSellOutcomeEntry({
  slug,
  customerId,
  receipt,
  mode,
}: Readonly<CrossSellOutcomeEntryProps>) {
  const router = useRouter();
  const eventId = useRef(`human:${crypto.randomUUID()}`);
  const errorRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [observedAt, setObservedAt] = useState('');

  useEffect(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    setObservedAt(local.toISOString().slice(0, 16));
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const observedAt = isoObservedAtFromForm(form.get('observedAt'));
    if (!observedAt.ok) {
      setError(observedAt.error);
      setSaving(false);
      return;
    }
    const resultValue = String(form.get('resultValue') ?? '').trim();
    const baselineValue = String(form.get('baselineValue') ?? '').trim();
    if (baselineValue && !resultValue) {
      setError('Enter the result before adding a baseline.');
      setSaving(false);
      return;
    }
    const body = {
      outcomeCode: String(form.get('outcomeCode') ?? ''),
      observedAt: observedAt.value,
      eventId: eventId.current,
      note: String(form.get('note') ?? ''),
      evidenceLinks: [String(form.get('evidenceLink') ?? '')],
      ...(resultValue
        ? {
            measurement: {
              metricName: 'Incremental revenue',
              metricUnit: 'INR',
              resultValue,
              ...(baselineValue ? { baselineValue } : {}),
            },
          }
        : {}),
    };

    try {
      const response = await fetch(
        `/api/v1/admin/app-runs/${encodeURIComponent(receipt.runId)}/actions/${encodeURIComponent(receipt.stepId)}/outcomes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json().catch(() => ({}))) as {
        observation?: ActionOutcomeRecord;
        error?: string;
        errors?: string[];
        reason?: string;
      };
      if (!response.ok || !result.observation) {
        if (response.status === 403) {
          setError('Your role can view customer results but cannot record them.');
        } else if (response.status === 409) {
          setError('A newer customer result is already recorded. Refresh before adding another.');
        } else {
          setError(
            result.errors?.join(' ') ||
              result.reason ||
              result.error ||
              'The customer result was not saved. Nothing changed. Try again.',
          );
        }
        return;
      }
      router.refresh();
    } catch {
      setError('The customer result was not saved. Nothing changed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card aria-label="Record customer result" className="border-border">
      <CardHeader className="space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle className="size-4 text-primary" aria-hidden />
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Business result
          </p>
        </div>
        <CardTitle className="text-base">
          {mode === 'conversion' ? 'Record the confirmed conversion' : 'Record what happened'}
        </CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The CRM task is complete. This records the customer response separately and links it to
          the exact execution receipt.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="cross-sell-outcome-code">What happened?</Label>
              <NativeSelect
                id="cross-sell-outcome-code"
                name="outcomeCode"
                defaultValue={mode === 'conversion' ? 'converted' : 'accepted'}
                required
              >
                <option value="accepted">Customer accepted</option>
                <option value="rejected">Customer declined</option>
                <option value="converted">Customer converted</option>
              </NativeSelect>
              <FieldDescription>
                This is the customer result, not the relationship manager decision.
              </FieldDescription>
            </Field>
            <Field>
              <Label htmlFor="cross-sell-observed-at">When did this happen?</Label>
              <Input
                id="cross-sell-observed-at"
                name="observedAt"
                type="datetime-local"
                value={observedAt}
                onChange={(event) => setObservedAt(event.target.value)}
                required
              />
            </Field>
          </div>

          <Field>
            <Label htmlFor="cross-sell-outcome-note">What confirms this result?</Label>
            <Textarea
              id="cross-sell-outcome-note"
              name="note"
              rows={3}
              maxLength={2000}
              placeholder="Example: Customer accepted during the follow-up call."
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Field>
              <Label htmlFor="cross-sell-evidence-link">Evidence reference</Label>
              <Input
                id="cross-sell-evidence-link"
                name="evidenceLink"
                defaultValue={`/app/${encodeURIComponent(slug)}/customers/${encodeURIComponent(customerId)}`}
                required
              />
              <FieldDescription>
                A CRM, document, or HTTP link a reviewer can open.
              </FieldDescription>
            </Field>
            <Field>
              <Label htmlFor="cross-sell-baseline-value">Revenue before (optional)</Label>
              <Input
                id="cross-sell-baseline-value"
                name="baselineValue"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
              />
            </Field>
            <Field>
              <Label htmlFor="cross-sell-result-value">Revenue after (optional)</Label>
              <Input
                id="cross-sell-result-value"
                name="resultValue"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
              />
              <FieldDescription>Recorded in INR.</FieldDescription>
            </Field>
          </div>

          {error ? (
            <div ref={errorRef} tabIndex={-1} className="outline-none">
              <FieldError role="alert">{error}</FieldError>
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving} className="min-h-11 w-full sm:w-auto">
              {saving ? 'Recording...' : 'Record customer result'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
