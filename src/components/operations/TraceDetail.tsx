'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TraceHeadline, WaterfallSpan } from '@/lib/jaeger-trace';

// Trace detail — a real, deep-linkable route (`/operations/health/traces/[traceId]`), not a modal.
// Shows the trace headline + a span waterfall (operation, service, start offset, duration, depth),
// with errored spans highlighted and per-span tags on demand.
const fmtDuration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);

interface DetailResponse {
  configured?: boolean;
  headline?: TraceHeadline | null;
  spans?: WaterfallSpan[];
  webUrl?: string | null;
  error?: string;
}

export function TraceDetail({ traceId, backHref }: Readonly<{ traceId: string; backHref: string }>) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [openSpan, setOpenSpan] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(
        `/api/v1/admin/operations/traces/${encodeURIComponent(traceId)}`,
        { cache: 'no-store' },
      );
      setData((await res.json()) as DetailResponse);
    })();
  }, [traceId]);

  const headline = data?.headline ?? null;
  const spans = data?.spans ?? [];

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center gap-3">
        <Link href={backHref} className="text-sm text-primary hover:underline">
          ← Back to search
        </Link>
        {data?.webUrl ? (
          <a
            href={data.webUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-primary hover:underline"
          >
            Open in Jaeger UI ↗
          </a>
        ) : null}
      </div>

      {data?.configured === false ? (
        <Card className="shadow-sm">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Distributed tracing isn&apos;t connected on this deployment yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle className="text-sm">{headline?.rootOp ?? 'Trace'}</CardTitle>
                {headline?.hasError ? (
                  <Badge variant="destructive">error</Badge>
                ) : headline ? (
                  <Badge variant="outline">ok</Badge>
                ) : null}
              </div>
              <CardDescription className="font-mono text-xs">{traceId}</CardDescription>
            </CardHeader>
            <CardContent>
              {data?.error ? (
                <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
                  Could not reach Jaeger: {data.error}
                </p>
              ) : (
                <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Service</div>
                    <div className="font-medium">{headline?.service ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Total duration</div>
                    <div className="font-medium tabular-nums">
                      {headline ? fmtDuration(headline.durationMs) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Spans</div>
                    <div className="font-medium tabular-nums">{headline?.spanCount ?? 0}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Span waterfall</CardTitle>
              <CardDescription className="text-xs">
                Each bar is a span, positioned by its start offset and sized by duration. Click a row
                for its tags.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {spans.length === 0 && !data?.error ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {data ? 'No spans in this trace.' : 'Loading…'}
                </p>
              ) : (
                <div className="space-y-1">
                  {spans.map((s) => (
                    <div key={s.spanId} className="rounded-md border border-border">
                      <button
                        type="button"
                        onClick={() => setOpenSpan(openSpan === s.spanId ? null : s.spanId)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40"
                      >
                        <div
                          className="min-w-0 shrink-0 truncate text-xs"
                          style={{ paddingLeft: `${s.depth * 14}px`, width: '30%' }}
                          title={`${s.operation} · ${s.service}`}
                        >
                          <span className={s.hasError ? 'font-medium text-destructive' : 'font-medium'}>
                            {s.operation}
                          </span>
                          <span className="ml-2 text-muted-foreground">{s.service}</span>
                        </div>
                        {/* Timeline lane */}
                        <div className="relative h-4 flex-1 rounded bg-muted/40">
                          <div
                            className={`absolute top-0 h-4 rounded ${s.hasError ? 'bg-destructive' : 'bg-primary'}`}
                            style={{
                              left: `${Math.min(s.offsetPct, 99)}%`,
                              width: `${Math.max(Math.min(s.widthPct, 100 - Math.min(s.offsetPct, 99)), 1)}%`,
                            }}
                          />
                        </div>
                        <div className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {fmtDuration(s.durationMs)}
                        </div>
                      </button>
                      {openSpan === s.spanId ? (
                        <div className="border-t border-border bg-muted/20 px-3 py-2">
                          {s.tags.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No tags on this span.</p>
                          ) : (
                            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                              {s.tags.map((t) => (
                                <div key={t.key} className="flex gap-2">
                                  <dt className="shrink-0 text-muted-foreground">{t.key}</dt>
                                  <dd className="min-w-0 truncate font-mono">{t.value}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
