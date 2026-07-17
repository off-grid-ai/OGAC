'use client';

import { Plus, Trash } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SolutionDeployment } from '@/lib/solution-blueprints';
import { splitList } from '@/lib/solution-blueprints';

interface Option {
  id: string;
  label: string;
}

export function DeploymentForm({
  deployment,
  blueprints = [],
  apps = [],
}: Readonly<{ deployment?: SolutionDeployment; blueprints?: Option[]; apps?: Option[] }>) {
  const router = useRouter();
  const [blueprintId, setBlueprintId] = useState(
    deployment?.blueprintId ?? blueprints[0]?.id ?? '',
  );
  const [appId, setAppId] = useState(deployment?.appId ?? apps[0]?.id ?? '');
  const [status, setStatus] = useState(deployment?.status ?? 'active');
  const [evidence, setEvidence] = useState((deployment?.evidenceLinks ?? []).join(', '));
  const [error, setError] = useState('');
  const endpoint = deployment
    ? `/api/v1/admin/solution-deployments/${deployment.id}`
    : '/api/v1/admin/solution-deployments';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const response = await fetch(endpoint, {
      method: deployment ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprintId, appId, status, evidenceLinks: splitList(evidence) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError((result.errors ?? [result.error ?? 'Unable to save']).join(' · '));
      return;
    }
    if (deployment) router.refresh();
    else router.push(`/solutions/deployed/${result.id}`);
  }

  async function remove() {
    if (
      !deployment ||
      !window.confirm('Remove this deployment binding? The App and its runs will remain intact.')
    )
      return;
    if ((await fetch(endpoint, { method: 'DELETE' })).ok) {
      router.push('/solutions/deployed');
      router.refresh();
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
              onChange={(e) => setBlueprintId(e.target.value)}
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
              {apps.map((option) => (
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
          <option value="retired">Retired</option>
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        Evidence links
        <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} />
      </label>
      {error ? (
        <p role="alert" className="text-xs text-destructive lg:col-span-4">
          {error}
        </p>
      ) : null}
      <div className="flex justify-between gap-2 lg:col-span-4">
        {deployment ? (
          <Button type="button" variant="destructive" onClick={remove}>
            <Trash /> Remove binding
          </Button>
        ) : (
          <span />
        )}
        <Button disabled={!blueprintId || !appId}>
          <Plus />
          {deployment ? 'Save deployment' : 'Bind existing App'}
        </Button>
      </div>
    </form>
  );
}
