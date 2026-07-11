'use client';

import { ChartBar, Pulse } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { modelLabel } from '@/lib/model-catalog';

interface Totals {
  requests: number;
  errors: number;
  errorRate: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  avgMs: number;
  avgTps: number;
}
interface GroupRow {
  model: string;
  requests: number;
  tokens: number;
  avgMs: number;
  errorRate: number;
}
interface TimeBucket {
  t: number;
  requests: number;
  tokens: number;
  errors: number;
  avgMs: number;
}
interface Usage {
  available: boolean;
  totals?: Totals;
  byModel?: GroupRow[];
  byCaller?: GroupRow[];
  byGateway?: GroupRow[];
  timeseries?: TimeBucket[];
}

const num = (n: number) => n.toLocaleString();

function Kpi({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

// Inline-SVG throughput bars from the hourly timeseries — no chart libs. Height scales to the
// busiest bucket; errors tint a bar amber.
function Throughput({ series }: Readonly<{ series: TimeBucket[] }>) {
  if (!series.length) {
    return <div className="py-6 text-center text-xs text-muted-foreground">No throughput yet.</div>;
  }
  const w = 640;
  const h = 96;
  const max = Math.max(1, ...series.map((b) => b.requests));
  const bw = w / series.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full" preserveAspectRatio="none">
      {series.map((b, i) => {
        const bh = (b.requests / max) * (h - 4);
        return (
          <rect
            key={b.t}
            x={i * bw + 1}
            y={h - bh}
            width={Math.max(1, bw - 2)}
            height={bh}
            className={b.errors ? 'fill-amber-500' : 'fill-primary'}
          >
            <title>
              {new Date(b.t).toLocaleTimeString()} · {b.requests} req · {b.tokens} tok
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

// Gateway usage analytics — polls /api/v1/gateway/analytics (10s), which replays the last 24h of
// OpenSearch gateway logs through @offgrid/analytics. KPI chips + by-model table + throughput SVG.
// eslint-disable-next-line complexity
export function GatewayUsage() {
  const [data, setData] = useState<Usage | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/v1/gateway/analytics', { cache: 'no-store' });
        const d = (await r.json()) as Usage;
        if (alive) setData(d);
      } catch {
        /* keep last snapshot */
      }
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (data && !data.available) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Gateway usage</CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center text-xs text-muted-foreground">
          OpenSearch is unreachable — gateway usage analytics are unavailable.
        </CardContent>
      </Card>
    );
  }

  const t = data?.totals;
  const byModel = data?.byModel ?? [];
  const series = data?.timeseries ?? [];

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <ChartBar className="size-4 text-primary" />
          Gateway usage · last 24h
        </CardTitle>
        <span className="flex items-center gap-1.5 text-xs text-primary">
          <Pulse className="size-3.5 animate-pulse" />
          live
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="requests" value={t ? num(t.requests) : '—'} />
          <Kpi
            label="tokens in→out"
            value={t ? `${num(t.promptTokens)} → ${num(t.completionTokens)}` : '—'}
          />
          <Kpi label="error rate" value={t ? `${(t.errorRate * 100).toFixed(1)}%` : '—'} />
          <Kpi label="avg latency" value={t ? `${Math.round(t.avgMs)} ms` : '—'} />
          <Kpi label="avg tok/s" value={t ? t.avgTps.toFixed(1) : '—'} />
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Throughput (req/hr)
          </div>
          <Throughput series={series} />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Avg latency</TableHead>
              <TableHead className="text-right">Error rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byModel.length ? (
              byModel.map((m) => (
                <TableRow key={m.model}>
                  <TableCell className="text-xs text-foreground">{modelLabel(m.model)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{num(m.requests)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{num(m.tokens)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {Math.round(m.avgMs)} ms
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono text-xs ${
                      m.errorRate ? 'text-destructive' : 'text-foreground'
                    }`}
                  >
                    {(m.errorRate * 100).toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                  No gateway usage in the last 24h.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
