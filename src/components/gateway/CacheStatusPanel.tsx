'use client';

import { CheckCircle, Database, Warning, XCircle } from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CacheStatus } from '@/lib/litellm-cache';

// Live response-cache status — the /cache/ping result rendered HONESTLY. Distinguishes three states
// the operator must not confuse: not configured (console can't reach a proxy), reachable-but-no-cache
// (proxy up, caching off), and a live healthy cache. The policy block is READ-ONLY (set at deploy).

export function CacheStatusPanel({
  status,
  loading,
}: Readonly<{ status: CacheStatus | null; loading: boolean }>) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <Database weight="duotone" className="size-4 text-primary" />
          Cache status
        </CardTitle>
        <StatusBadge status={status} loading={loading} />
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !status ? (
          <p className="text-sm text-muted-foreground">Reading cache status…</p>
        ) : (
          <>
            <StatusBody status={status} />
            <PolicyBlock status={status} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, loading }: Readonly<{ status: CacheStatus | null; loading: boolean }>) {
  if (loading || !status) return <Badge variant="outline" className="font-mono text-[11px]">…</Badge>;
  if (!status.configured) return <Badge variant="outline" className="font-mono text-[11px]">not configured</Badge>;
  if (!status.reachable) return <Badge variant="destructive" className="font-mono text-[11px]">unreachable</Badge>;
  if (!status.cacheEnabled) return <Badge variant="secondary" className="font-mono text-[11px]">no cache wired</Badge>;
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-mono text-[11px]',
        status.healthy
          ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
          : 'border-amber-500/50 text-amber-600 dark:text-amber-400',
      )}
    >
      {status.healthy ? 'healthy' : 'degraded'}
    </Badge>
  );
}

function StatusBody({ status }: Readonly<{ status: CacheStatus }>) {
  if (!status.configured) {
    return (
      <Row icon="off">
        The gateway is not configured (<code className="font-mono">OFFGRID_LITELLM_URL</code> unset). Point
        the console at the proxy to read cache status.
      </Row>
    );
  }
  if (!status.reachable) {
    return (
      <Row icon="off">
        Could not read <code className="font-mono">/cache/ping</code>
        {status.error ? <> — {status.error}</> : null}.
      </Row>
    );
  }
  if (!status.cacheEnabled) {
    return (
      <Row icon="warn">
        The proxy is reachable but <span className="text-foreground">no response cache is wired</span> in
        its config. Enable <code className="font-mono">litellm_settings.cache</code> and reload the proxy
        to turn on response caching.
      </Row>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Backend" value={status.type} />
      <Metric label="Reachable" value="yes" ok />
      <Metric label="Healthy" value={status.healthy ? 'yes' : 'no'} ok={status.healthy} />
    </div>
  );
}

function PolicyBlock({ status }: Readonly<{ status: CacheStatus }>) {
  if (!status.cacheEnabled) return null;
  const p = status.policy;
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          Cache policy
        </span>
        <Badge variant="outline" className="font-mono text-[10px]">
          read-only · set at deploy
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-4">
        <Field label="TTL" value={p.ttlSeconds == null ? '—' : `${p.ttlSeconds}s`} />
        <Field label="Mode" value={p.mode ?? '—'} />
        <Field label="Namespace" value={p.namespace ?? '—'} />
        <Field
          label="Call types"
          value={p.supportedCallTypes.length ? p.supportedCallTypes.join(', ') : 'all'}
        />
      </dl>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Cache policy is configured in the proxy at deploy time and requires a reload to change — it is
        not runtime-settable from the console.
      </p>
    </div>
  );
}

function Metric({ label, value, ok }: Readonly<{ label: string; value: string; ok?: boolean }>) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 font-mono text-lg font-semibold',
          ok === true && 'text-emerald-600 dark:text-emerald-400',
          ok === false && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Field({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

function Row({ icon, children }: Readonly<{ icon: 'off' | 'warn' | 'ok'; children: React.ReactNode }>) {
  const Icon = icon === 'ok' ? CheckCircle : icon === 'warn' ? Warning : XCircle;
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      <Icon
        weight="duotone"
        className={cn(
          'mt-0.5 size-4 shrink-0',
          icon === 'ok' && 'text-emerald-500',
          icon === 'warn' && 'text-amber-500',
          icon === 'off' && 'text-muted-foreground',
        )}
      />
      <p>{children}</p>
    </div>
  );
}
