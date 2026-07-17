'use client';

import { ArrowClockwise, ArrowLeft, ArrowSquareOut, LockKey } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toDisplayHost, toDisplayHostname } from '@/lib/display-host';
import type { ServiceControl, ServiceEntry, ServiceHealth } from '@/lib/services-directory';
import { RedpandaManager } from './RedpandaManager';

const HEALTH_UI: Record<ServiceHealth['status'], { dot: string; text: string; label: string }> = {
  up: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Up' },
  down: { dot: 'bg-red-500', text: 'text-red-500', label: 'Down' },
  embedded: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    label: 'Embedded',
  },
  optional: { dot: 'bg-muted-foreground/50', text: 'text-muted-foreground', label: 'Optional' },
};

interface Sample {
  at: string;
  status: ServiceHealth['status'];
  ms: number | null;
  httpStatus: number | null;
}

// Service detail — the drill-through from the Services directory. Shows the live health with a
// rolling history sampled client-side (the console has no historical health store; we accumulate
// samples while the page is open, honestly labelled "this session"), the real management action
// that exists (re-probe now, open the surface, jump to its logs), and an HONEST note about why the
// service can't be restarted from the console (per serviceControl — no dead buttons).
export function ServiceDetail({
  service,
  control,
  logsHref,
}: Readonly<{
  service: ServiceEntry;
  control: ServiceControl;
  logsHref: string | null;
}>) {
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [history, setHistory] = useState<Sample[]>([]);
  const [probing, setProbing] = useState(false);

  const probe = useCallback(async () => {
    setProbing(true);
    try {
      const res = await fetch('/api/v1/services/health', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { services: ServiceHealth[]; checkedAt: string };
      const h = data.services.find((s) => s.id === service.id) ?? null;
      if (h) {
        setHealth(h);
        setHistory((prev) =>
          [
            ...prev,
            { at: data.checkedAt, status: h.status, ms: h.ms, httpStatus: h.httpStatus },
          ].slice(-60),
        );
      }
    } catch {
      /* keep last */
    } finally {
      setProbing(false);
    }
  }, [service.id]);

  useEffect(() => {
    void probe();
    const t = setInterval(() => void probe(), 15_000);
    return () => clearInterval(t);
  }, [probe]);

  const ui = health ? HEALTH_UI[health.status] : null;
  const isHttp = /^https?:\/\//i.test(service.url);
  const ups = history.filter((s) => s.status !== 'down').length;
  const uptimePct = history.length ? Math.round((ups / history.length) * 100) : null;

  async function reprobe() {
    await probe();
    toast.success('Health re-checked');
  }

  return (
    <div className="space-y-6">
      <Link
        href="/operations/services"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Services
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">{service.label}</h1>
            {ui && (
              <span className="flex items-center gap-1.5 text-sm">
                <span className={`size-2 rounded-full ${ui.dot}`} />
                <span className={ui.text}>{ui.label}</span>
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{service.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={probing} onClick={() => void reprobe()}>
            <ArrowClockwise className={`size-4 ${probing ? 'animate-spin' : ''}`} /> Re-check health
          </Button>
          {isHttp && (
            <a href={toDisplayHost(service.url)} target="_blank" rel="noopener noreferrer">
              <Button size="sm">
                Open <ArrowSquareOut className="size-4" />
              </Button>
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Status', value: ui?.label ?? '—' },
          { label: 'Latency', value: health?.ms != null ? `${health.ms}ms` : '—' },
          { label: 'HTTP', value: health?.httpStatus != null ? String(health.httpStatus) : '—' },
          { label: 'Uptime (session)', value: uptimePct != null ? `${uptimePct}%` : '—' },
        ].map((f) => (
          <Card key={f.label} className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                {f.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-lg font-semibold text-foreground">{f.value}</CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Health history (this session) */}
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Health history</CardTitle>
            <p className="text-xs text-muted-foreground">
              Sampled every 15s while this page is open ({history.length} sample
              {history.length === 1 ? '' : 's'}). The console keeps no long-term health store — this
              is the live session.
            </p>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Collecting first sample…
              </p>
            ) : (
              <div className="flex items-end gap-0.5 overflow-x-auto">
                {history.map((s, i) => {
                  const down = s.status === 'down';
                  const h = s.ms != null ? Math.min(48, Math.max(6, Math.round(s.ms / 40))) : 20;
                  const msSuffix = s.ms != null ? ` · ${s.ms}ms` : '';
                  return (
                    <div
                      key={i}
                      title={`${new Date(s.at).toLocaleTimeString()} · ${s.status}${msSuffix}`}
                      className={`w-2 shrink-0 rounded-sm ${down ? 'bg-red-500' : 'bg-emerald-500'}`}
                      style={{ height: down ? 48 : h }}
                    />
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Management */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Management</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <LockKey className="mt-0.5 size-4 shrink-0" />
              <span>{control.managedBy}</span>
            </div>
            <dl className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Auth</dt>
                <dd>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {service.auth}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Endpoint</dt>
                <dd className="truncate font-mono text-[11px] text-foreground">
                  {isHttp ? toDisplayHostname(service.url) : 'in-process'}
                </dd>
              </div>
              {service.healthPath && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Health path</dt>
                  <dd className="font-mono text-[11px] text-foreground">{service.healthPath}</dd>
                </div>
              )}
            </dl>
            {logsHref && (
              <Link
                href={logsHref}
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                View logs & telemetry <ArrowSquareOut className="size-3" />
              </Link>
            )}
          </CardContent>
        </Card>
      </div>

      {service.management === 'redpanda' && <RedpandaManager />}
    </div>
  );
}
