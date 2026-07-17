'use client';

import { Plus, Trash } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { SolutionDeployment } from '@/lib/solution-blueprints';

interface Option {
  id: string;
  label: string;
  version?: number;
  compatibleBlueprintIds?: string[];
}

export function DeploymentForm({
  deployment,
  blueprints = [],
  apps = [],
  selectedBlueprintId,
}: Readonly<{
  deployment?: SolutionDeployment;
  blueprints?: Option[];
  apps?: Option[];
  selectedBlueprintId?: string;
}>) {
  const router = useRouter();
  const [blueprintId, setBlueprintId] = useState(
    deployment?.blueprintId ?? selectedBlueprintId ?? blueprints[0]?.id ?? '',
  );
  const compatibleApps = apps.filter((app) => app.compatibleBlueprintIds?.includes(blueprintId));
  const [appId, setAppId] = useState(deployment?.appId ?? '');
  const [status, setStatus] = useState(deployment?.status ?? 'active');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const endpoint = deployment
    ? `/api/v1/admin/solution-deployments/${deployment.id}`
    : '/api/v1/admin/solution-deployments';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const blueprintVersion = blueprints.find((item) => item.id === blueprintId)?.version;
      const response = await fetch(endpoint, {
        method: deployment ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          deployment ? { status } : { blueprintId, blueprintVersion, appId, status },
        ),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((result.errors ?? [result.error ?? 'Unable to save']).join(' · '));
        return;
      }
      if (deployment) router.refresh();
      else router.push(`/solutions/deployed/${result.id}`);
    } catch {
      setError('Unable to reach the control plane. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !deployment ||
      !window.confirm(
        'Retire this deployment binding? Its App, runs, and evidence remain readable.',
      )
    )
      return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setError(result.error ?? 'Unable to retire deployment');
        return;
      }
      router.push('/solutions/deployed');
      router.refresh();
    } catch {
      setError('Unable to reach the control plane. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const selectClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm';
  return (
    <form onSubmit={submit} className="grid gap-4 rounded-lg border bg-card p-5 lg:grid-cols-4">
      {deployment ? null : (
        <>
          <label className="space-y-1 text-xs text-muted-foreground">
            Blueprint
            <select
              required
              className={selectClass}
              value={blueprintId}
              onChange={(e) => {
                setBlueprintId(e.target.value);
                setAppId('');
              }}
            >
              {blueprints.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Canonical App
            <select
              required
              className={selectClass}
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
            >
              <option value="">Select a compatible App</option>
              {compatibleApps.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="space-y-1 text-xs text-muted-foreground">
        Status
        <select
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as SolutionDeployment['status'])}
        >
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          {deployment?.status === 'retired' ? (
            <option value="retired" disabled>
              Retired
            </option>
          ) : null}
        </select>
      </label>
      {!deployment && blueprintId && compatibleApps.length === 0 ? (
        <p role="status" className="text-xs text-muted-foreground lg:col-span-2">
          No published App currently satisfies this Blueprint version&apos;s pipeline, domain, and
          capability contract.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive lg:col-span-4">
          {error}
        </p>
      ) : null}
      <div className="flex justify-between gap-2 lg:col-span-4">
        {deployment && deployment.status !== 'retired' ? (
          <Button type="button" variant="destructive" disabled={saving} onClick={remove}>
            <Trash /> Retire binding
          </Button>
        ) : (
          <span />
        )}
        <Button
          disabled={
            saving || deployment?.status === 'retired' || (!deployment && (!blueprintId || !appId))
          }
        >
          <Plus />
          {saving ? 'Saving…' : deployment ? 'Save deployment' : 'Adopt Blueprint'}
        </Button>
      </div>
    </form>
  );
}
