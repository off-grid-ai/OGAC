'use client';

import { Plus } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { splitList } from '@/lib/solution-blueprints';

export function ObservationForm({ deploymentId }: Readonly<{ deploymentId: string }>) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries());
    try {
      const response = await fetch(
        `/api/v1/admin/solution-deployments/${deploymentId}/observations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...body,
            evidenceLinks: splitList(String(body.evidenceLinks ?? '')),
          }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((result.errors ?? [result.error ?? 'Unable to record evidence']).join(' · '));
        return;
      }
      formElement.reset();
      router.refresh();
    } catch {
      setError('Unable to reach the control plane. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border bg-card p-5 lg:grid-cols-4">
      <div className="lg:col-span-4">
        <h2 className="text-sm font-medium">Record an operator KPI claim</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Completed runs and AI cost are read from canonical run evidence for this window. You enter
          the KPI claim, labor assumptions, and supporting evidence.
        </p>
      </div>
      <label className="text-xs text-muted-foreground">
        Window start
        <Input name="windowStart" type="datetime-local" required />
      </label>
      <label className="text-xs text-muted-foreground">
        Window end
        <Input name="windowEnd" type="datetime-local" required />
      </label>
      <label className="text-xs text-muted-foreground">
        KPI label
        <Input name="claimLabel" required />
      </label>
      <label className="text-xs text-muted-foreground">
        KPI value
        <Input name="claimedMetricValue" type="number" step="any" required />
      </label>
      <label className="text-xs text-muted-foreground">
        Minutes saved / run (estimate)
        <Input name="estimatedMinutesSavedPerRun" type="number" min="0" step="any" required />
      </label>
      <label className="text-xs text-muted-foreground">
        Loaded cost / hour in USD (estimate)
        <Input name="estimatedLoadedCostPerHour" type="number" min="0" step="any" required />
      </label>
      <label className="text-xs text-muted-foreground lg:col-span-3">
        Evidence links
        <Input name="evidenceLinks" placeholder="/governance/evidence/..." required />
      </label>
      <Button type="submit" disabled={saving} className="self-end">
        <Plus /> {saving ? 'Recording…' : 'Record evidence'}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive lg:col-span-4">
          {error}
        </p>
      ) : null}
    </form>
  );
}
