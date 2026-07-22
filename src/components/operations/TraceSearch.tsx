'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TRACE_RANGES, type TraceListRow } from '@/lib/jaeger-trace';

// Distributed-trace search — the third observability pillar next to logs and metrics. URL-DRIVEN:
// every filter (service, operation, range, min-duration, error-only) lives in searchParams so the
// search is deep-linkable + Back-coherent. Each result row opens a real detail route (list → detail).
const RANGE_LABEL: Record<string, string> = { '15m': '15m', '1h': '1h', '6h': '6h', '24h': '24h' };

const fmtDuration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);
const fmtTime = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 19).replace('T', ' ') : '—');

export function TraceSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const service = params.get('service') ?? '';
  const operation = params.get('operation') ?? '';
  const range = params.get('range') ?? '1h';
  const minDuration = params.get('minDuration') ?? '';
  const errorOnly = params.get('errorOnly') === 'true';

  const [configured, setConfigured] = useState(true);
  const [services, setServices] = useState<string[]>([]);
  const [operations, setOperations] = useState<string[]>([]);
  const [traces, setTraces] = useState<TraceListRow[]>([]);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const qs = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') qs.delete(k);
        else qs.set(k, v);
      }
      router.replace(`${pathname}?${qs}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // Services for the picker.
  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/v1/admin/operations/traces/services', { cache: 'no-store' });
      const j = (await res.json()) as { configured?: boolean; services?: string[] };
      setConfigured(j.configured !== false);
      setServices(j.services ?? []);
    })();
  }, []);

  // Operations for the chosen service.
  useEffect(() => {
    if (!service) return setOperations([]);
    void (async () => {
      const res = await fetch(
        `/api/v1/admin/operations/traces/operations?service=${encodeURIComponent(service)}`,
        { cache: 'no-store' },
      );
      const j = (await res.json()) as { operations?: string[] };
      setOperations(j.operations ?? []);
    })();
  }, [service]);

  // Run the search whenever the URL filters change.
  useEffect(() => {
    if (!service) return setTraces([]);
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ service, range });
    if (operation) qs.set('operation', operation);
    if (minDuration) qs.set('minDuration', minDuration);
    if (errorOnly) qs.set('errorOnly', 'true');
    void (async () => {
      try {
        const res = await fetch(`/api/v1/admin/operations/traces?${qs}`, { cache: 'no-store' });
        const j = (await res.json()) as {
          configured?: boolean;
          traces?: TraceListRow[];
          webUrl?: string | null;
          error?: string;
        };
        setConfigured(j.configured !== false);
        setTraces(j.traces ?? []);
        setWebUrl(j.webUrl ?? null);
        setError(j.error ?? null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [service, operation, range, minDuration, errorOnly]);

  const detailHref = (traceId: string) => {
    const qs = new URLSearchParams(params.toString());
    return `${pathname}/${encodeURIComponent(traceId)}?${qs}`;
  };

  if (!configured) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Distributed tracing isn&apos;t connected on this deployment yet (no Jaeger endpoint).
          Traces appear here once services export spans through the collector.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full space-y-4">
      {/* Filter bar — full width, wraps on narrow. */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Trace search</CardTitle>
          <CardDescription className="text-xs">
            Debug latency and errors across services. Pick a service and narrow by operation, time
            window, duration, or errors.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>Service</span>
              <select
                value={service}
                onChange={(e) => setParam({ service: e.target.value, operation: null })}
                aria-label="Service"
                className="h-9 min-w-52 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              >
                <option value="">Select a service…</option>
                {services.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>Operation</span>
              <select
                value={operation}
                onChange={(e) => setParam({ operation: e.target.value || null })}
                aria-label="Operation"
                disabled={!service}
                className="h-9 min-w-52 rounded-md border border-border bg-background px-2 text-sm text-foreground disabled:opacity-50"
              >
                <option value="">All operations</option>
                {operations.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>Time range</span>
              <div className="flex overflow-hidden rounded-md border border-border">
                {TRACE_RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setParam({ range: r })}
                    className={`h-9 px-3 text-xs ${range === r ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-muted/40'}`}
                  >
                    {RANGE_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>Min duration (ms)</span>
              <Input
                type="number"
                min={0}
                value={minDuration}
                placeholder="0"
                onChange={(e) => setParam({ minDuration: e.target.value || null })}
                className="h-9 w-32"
              />
            </label>

            <button
              type="button"
              onClick={() => setParam({ errorOnly: errorOnly ? null : 'true' })}
              className={`h-9 rounded-md border px-3 text-xs ${errorOnly ? 'border-destructive bg-destructive/10 text-destructive' : 'border-border text-muted-foreground hover:bg-muted/40'}`}
            >
              Errors only
            </button>

            {webUrl ? (
              <a
                href={`${webUrl}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto self-center text-xs text-primary hover:underline"
              >
                Open Jaeger UI ↗
              </a>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Results — table fills the width. */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-sm">{service ? `Traces · ${service}` : 'Traces'}</CardTitle>
            <CardDescription className="text-xs">
              {loading ? 'Searching…' : `${traces.length} trace${traces.length === 1 ? '' : 's'}`}
              {errorOnly ? ' · errors only' : ''}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="mb-3 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              Could not reach Jaeger: {error}
            </p>
          ) : null}
          {!service ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Select a service to search its traces.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Root operation</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Spans</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Start</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {traces.map((t) => (
                    <TableRow key={t.traceId} className="cursor-pointer hover:bg-muted/40">
                      <TableCell className="font-medium">
                        <Link href={detailHref(t.traceId)} className="block hover:underline">
                          {t.rootOp}
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {t.traceId.slice(0, 12)}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{t.service}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.spanCount}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtDuration(t.durationMs)}
                      </TableCell>
                      <TableCell>
                        {t.hasError ? (
                          <Badge variant="destructive">error</Badge>
                        ) : (
                          <Badge variant="outline">ok</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {fmtTime(t.startTimeMs)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && traces.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        No traces in this window. Widen the time range or clear filters.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Retention — read-only. Jaeger retention is a storage/deploy flag, not console-writable. */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Retention &amp; storage</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          Trace retention is governed by the deployed Jaeger storage backend (span TTL / index
          rollover), configured at deploy time — not editable from the console. To change how long
          traces are kept, update the Jaeger storage configuration in the deployment and redeploy.
        </CardContent>
      </Card>
    </div>
  );
}
