'use client';

import { ArrowClockwise, ArrowLeft, ArrowSquareOut, LockKey } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toDisplayHostname } from '@/lib/display-host';
import type { ServiceTopologyDetailEntry } from '@/lib/service-directory-view';
import type { ServiceHealth } from '@/lib/service-health';
import type { ServiceControl } from '@/lib/services-directory';
import { READINESS_GATES } from '@/lib/service-topology';
import { RedpandaManager } from './RedpandaManager';
import { GATE_LABEL, HEALTH_UI, READINESS_UI, withLiveReachability } from './ServiceReadiness';

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
  service: ServiceTopologyDetailEntry;
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
  const readiness = withLiveReachability(service.readiness, health);
  const isHttp = service.displayUrl !== null;
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
            <a href={service.displayUrl ?? undefined} target="_blank" rel="noopener noreferrer">
              <Button size="sm">
                Open <ArrowSquareOut className="size-4" />
              </Button>
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {READINESS_GATES.map((gate) => (
          <Card key={gate} className={`shadow-sm ${READINESS_UI[readiness[gate]]}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                {GATE_LABEL[gate]}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm font-semibold capitalize">
              {readiness[gate].replace('-', ' ')}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="shadow-sm xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">
              Deployment components · {service.componentCount} component
              {service.componentCount === 1 ? '' : 's'} · {service.instanceCount} instance
              {service.instanceCount === 1 ? '' : 's'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {service.components.map((component) => (
              <section key={component.id} className="rounded-lg border border-border">
                <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
                  <div>
                    <h2 className="text-sm font-medium text-foreground">{component.label}</h2>
                    <p className="font-mono text-[10px] uppercase text-muted-foreground">
                      {component.role}
                    </p>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {component.instances.length} instance
                    {component.instances.length === 1 ? '' : 's'}
                  </Badge>
                </div>
                <div className="divide-y divide-border">
                  {component.instances.length === 0 ? (
                    <p className="px-4 py-4 text-xs text-muted-foreground">
                      No deployed instances are registered.
                    </p>
                  ) : (
                    component.instances.map((instance) => (
                      <div key={instance.id} className="grid gap-3 px-4 py-3 lg:grid-cols-3">
                        <div>
                          <p className="text-xs font-medium text-foreground">{instance.label}</p>
                          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                            {instance.nodeId ? `node ${instance.nodeId}` : 'no node placement'}
                          </p>
                        </div>
                        <div className="space-y-2 lg:col-span-2">
                          {instance.endpoints.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No endpoint registered.</p>
                          ) : (
                            instance.endpoints.map((endpoint) => (
                              <div
                                key={endpoint.id}
                                className="flex flex-wrap items-center justify-between gap-2 text-xs"
                              >
                                <div>
                                  <span className="text-foreground">{endpoint.label}</span>
                                  <span className="ml-2 text-muted-foreground">
                                    {endpoint.purpose}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-[9px] uppercase">
                                    {endpoint.scope}
                                  </Badge>
                                  {endpoint.displayUrl ? (
                                    <a
                                      href={endpoint.displayUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-mono text-[10px] text-primary hover:underline"
                                    >
                                      {toDisplayHostname(endpoint.displayUrl)}
                                    </a>
                                  ) : (
                                    <span className="font-mono text-[10px] text-muted-foreground">
                                      in-process
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Dependencies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {service.dependencies.length === 0 ? (
              <p className="text-xs text-muted-foreground">No dependencies are registered.</p>
            ) : (
              service.dependencies.map((dependency) => (
                <Link
                  key={`${dependency.serviceId}:${dependency.purpose}`}
                  href={`/operations/services/${dependency.serviceId}`}
                  className="block rounded-md border border-border p-3 hover:border-primary/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {dependency.serviceId}
                    </span>
                    <Badge variant="outline" className="text-[9px] uppercase">
                      {dependency.required ? 'required' : 'optional'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{dependency.purpose}</p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Readiness evidence</CardTitle>
          <p className="text-xs text-muted-foreground">
            A gate is only green when registered evidence proves it; missing proof stays unknown.
          </p>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border rounded-lg border border-border">
            {service.evidence.map((item, index) => (
              <div
                key={`${item.gate}:${item.source}:${index}`}
                className="grid gap-2 px-3 py-2 text-xs md:grid-cols-[8rem_7rem_1fr_12rem]"
              >
                <span>{GATE_LABEL[item.gate]}</span>
                <span className="capitalize text-muted-foreground">
                  {item.state.replace('-', ' ')}
                </span>
                <span className="text-foreground">{item.summary}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{item.source}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

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
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Live probe</dt>
                <dd>{ui?.label ?? 'Checking'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Latency</dt>
                <dd>{health?.ms != null ? `${health.ms}ms` : '—'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Uptime (session)</dt>
                <dd>{uptimePct != null ? `${uptimePct}%` : '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Endpoint</dt>
                <dd className="truncate font-mono text-[11px] text-foreground">
                  {service.displayUrl ? toDisplayHostname(service.displayUrl) : 'in-process'}
                </dd>
              </div>
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
