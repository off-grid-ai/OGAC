'use client';

import {
  Broadcast,
  ChartLineUp,
  CheckCircle,
  Database,
  Eye,
  Warning,
  WarningOctagon,
  XCircle,
} from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CallbackSink, CallbacksStatus, SinkCategory } from '@/lib/litellm-callbacks';

// Live structured-callbacks status — the active success/failure sinks the gateway streams every call
// to, rendered HONESTLY. Distinguishes: not configured (console can't reach a proxy), reachable-but-no
// -callbacks (proxy up, nothing streaming), and live sinks. Global callbacks are set at deploy.

const CATEGORY_ICON: Record<SinkCategory, typeof Eye> = {
  observability: Eye,
  metrics: ChartLineUp,
  storage: Database,
  alerting: WarningOctagon,
  unknown: Broadcast,
};

const CATEGORY_LABEL: Record<SinkCategory, string> = {
  observability: 'Observability',
  metrics: 'Metrics',
  storage: 'Storage',
  alerting: 'Alerting',
  unknown: 'Other',
};

export function CallbacksStatusPanel({
  status,
  loading,
}: Readonly<{ status: CallbacksStatus | null; loading: boolean }>) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <Broadcast weight="duotone" className="size-4 text-primary" />
          Callback sinks
        </CardTitle>
        <StatusBadge status={status} loading={loading} />
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !status ? (
          <p className="text-sm text-muted-foreground">Reading callback status…</p>
        ) : (
          <>
            <StatusBody status={status} />
            {status.active ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <SinkColumn title="On success" sinks={status.success} />
                <SinkColumn title="On failure" sinks={status.failure} />
              </div>
            ) : null}
            <DeployNote />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, loading }: Readonly<{ status: CallbacksStatus | null; loading: boolean }>) {
  if (loading || !status) return <Badge variant="outline" className="font-mono text-[11px]">…</Badge>;
  if (!status.configured) return <Badge variant="outline" className="font-mono text-[11px]">not configured</Badge>;
  if (!status.reachable) return <Badge variant="destructive" className="font-mono text-[11px]">unreachable</Badge>;
  if (!status.active) return <Badge variant="secondary" className="font-mono text-[11px]">no callbacks</Badge>;
  return (
    <Badge
      variant="outline"
      className="border-emerald-500/50 font-mono text-[11px] text-emerald-600 dark:text-emerald-400"
    >
      streaming
    </Badge>
  );
}

function StatusBody({ status }: Readonly<{ status: CallbacksStatus }>) {
  if (!status.configured) {
    return (
      <Row icon="off">
        The gateway is not configured (<code className="font-mono">OFFGRID_LITELLM_URL</code> unset). Point
        the console at the proxy to read callback status.
      </Row>
    );
  }
  if (!status.reachable) {
    return (
      <Row icon="off">
        Could not read the proxy&apos;s callbacks
        {status.error ? <> — {status.error}</> : null}.
      </Row>
    );
  }
  if (!status.active) {
    return (
      <Row icon="warn">
        The proxy is reachable but <span className="text-foreground">no logging callbacks are wired</span>.
        Add a sink to <code className="font-mono">litellm_settings.success_callback</code> /{' '}
        <code className="font-mono">failure_callback</code> and reload the proxy to stream per-call records.
      </Row>
    );
  }
  return (
    <Row icon="ok">
      The gateway is streaming a structured record for every model call to{' '}
      <span className="text-foreground">
        {status.success.length} success
      </span>{' '}
      and{' '}
      <span className="text-foreground">{status.failure.length} failure</span> sink
      {status.success.length + status.failure.length === 1 ? '' : 's'}.
    </Row>
  );
}

function SinkColumn({ title, sinks }: Readonly<{ title: string; sinks: CallbackSink[] }>) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{title}</div>
      {sinks.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">None</p>
      ) : (
        <ul className="space-y-2">
          {sinks.map((s) => {
            const Icon = CATEGORY_ICON[s.category];
            return (
              <li key={s.name} className="flex items-center gap-2">
                <Icon weight="duotone" className="size-4 shrink-0 text-primary" />
                <span className="font-mono text-sm">{s.label}</span>
                <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                  {CATEGORY_LABEL[s.category]}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DeployNote() {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          Global callbacks
        </span>
        <Badge variant="outline" className="font-mono text-[10px]">
          read-only · set at deploy
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Global success/failure callbacks are configured in the proxy at deploy time (
        <code className="font-mono">litellm_settings</code>) and require a reload to change — they are not
        runtime-settable from the console. Team-scoped callbacks below <em>are</em> runtime-settable.
      </p>
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
