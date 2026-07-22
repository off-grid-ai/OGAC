'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { RetentionResult } from '@/lib/adapters/victorialogs';

// Retention view. Retention on single-node VictoriaLogs is a DEPLOY flag (-retentionPeriod), not a
// runtime-CRUD setting — so this is honestly read-only: it shows the configured period when VL
// surfaces the flag, else says it's the deploy-managed default. Never fakes a control the service
// can't perform.
export function LogsRetentionPanel() {
  const [state, setState] = useState<RetentionResult | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/admin/operations/logs/retention', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: RetentionResult) => { if (alive) setState(j); })
      .catch(() => { if (alive) setState({ configured: false }); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">Retention</h3>
        {state?.configured === false ? (
          <Badge variant="secondary">not configured</Badge>
        ) : state?.retention ? (
          <Badge variant={state.retention.source === 'flags' ? 'default' : 'secondary'}>
            {state.retention.source === 'flags' ? 'deploy flag' : 'default'}
          </Badge>
        ) : null}
      </div>
      {state === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : state.configured === false ? (
        <p className="text-xs text-muted-foreground">
          VictoriaLogs isn&apos;t configured on this deployment (no <code>OFFGRID_VICTORIALOGS_URL</code>).
        </p>
      ) : state.error ? (
        <p className="text-xs text-destructive">Couldn&apos;t read retention: {state.error}</p>
      ) : state.retention ? (
        <div className="space-y-2 text-xs">
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground">Period</span>
            <span className="font-mono text-sm">{state.retention.retentionPeriod ?? 'default'}</span>
          </div>
          <p className="text-muted-foreground">{state.retention.note}</p>
        </div>
      ) : null}
    </div>
  );
}
