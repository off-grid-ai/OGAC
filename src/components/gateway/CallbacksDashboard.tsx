'use client';

import { Broadcast } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CallbacksStatus } from '@/lib/litellm-callbacks';
import { CallbacksPayloadPreview } from './CallbacksPayloadPreview';
import { CallbacksStatusPanel } from './CallbacksStatusPanel';
import { CallbacksTeamForm } from './CallbacksTeamForm';

// Gateway structured-callbacks control + observability. Shows the LIVE callback sinks the proxy fans
// every model call to, the per-call record shape being streamed, and the team-scoped runtime lever.
// Honest about what the deployed LiteLLM actually supports (global callbacks are deploy-owned).

export function CallbacksDashboard() {
  const [status, setStatus] = useState<CallbacksStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/gateway/callbacks', { cache: 'no-store' });
      setStatus((await res.json()) as CallbacksStatus);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const gatewayDown = status !== null && status.configured && !status.reachable;

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-mono text-lg font-semibold tracking-tight">
            <Broadcast weight="duotone" className="size-5 text-primary" />
            Structured callbacks
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The gateway streams a structured record of every model call — model, tokens, cost, latency,
            who called — to your observability and logging sinks. See what&apos;s wired, what the record
            looks like, and point a team&apos;s logs at a new sink.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <CallbacksStatusPanel status={status} loading={loading} />
        <CallbacksPayloadPreview />
      </div>

      <CallbacksTeamForm disabled={gatewayDown} />
    </div>
  );
}
