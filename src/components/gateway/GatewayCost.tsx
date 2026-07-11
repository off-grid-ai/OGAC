'use client';

import { Coins, Pulse } from '@phosphor-icons/react/dist/ssr';
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

interface DailySpend {
  day: string;
  usd: number;
  tokens: number;
  requests: number;
}
interface Totals {
  totalUsd: number;
  totalTokens: number;
  requests: number;
}
interface Report {
  available: boolean;
  byModel?: Record<string, number>;
  byCaller?: Record<string, number>;
  daily?: DailySpend[];
  projectedMonthly?: number;
  totals?: Totals;
}

const usd = (n: number) => `$${n.toFixed(4)}`;

// Inline-SVG daily-spend bars — no chart libs. Height scales to the costliest day.
function SpendBars({ daily }: Readonly<{ daily: DailySpend[] }>) {
  if (!daily.length) {
    return <div className="py-6 text-center text-xs text-muted-foreground">No spend yet.</div>;
  }
  const w = 640;
  const h = 96;
  const max = Math.max(0.000001, ...daily.map((d) => d.usd));
  const bw = w / daily.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full" preserveAspectRatio="none">
      {daily.map((d, i) => {
        const bh = (d.usd / max) * (h - 4);
        return (
          <rect
            key={d.day}
            x={i * bw + 1}
            y={h - bh}
            width={Math.max(1, bw - 2)}
            height={bh}
            className="fill-primary"
          >
            <title>
              {d.day} · ${d.usd.toFixed(4)} · {d.requests} req
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

// Gateway cost / FinOps — polls /api/v1/gateway/finops (10s), which prices the last 24h of
// OpenSearch gateway logs through @offgrid/finops. Total + projected monthly spend, spend-by-model
// table, daily-spend SVG bars. Local models are an estimated blended cost (electricity + hardware).
// eslint-disable-next-line complexity
export function GatewayCost() {
  const [data, setData] = useState<Report | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/v1/gateway/finops', { cache: 'no-store' });
        const d = (await r.json()) as Report;
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
          <CardTitle className="text-sm">Gateway cost</CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center text-xs text-muted-foreground">
          OpenSearch is unreachable — gateway cost data is unavailable.
        </CardContent>
      </Card>
    );
  }

  const t = data?.totals;
  const byModel = Object.entries(data?.byModel ?? {}).sort((a, b) => b[1] - a[1]);
  const daily = data?.daily ?? [];

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Coins className="size-4 text-primary" />
          Gateway cost · last 24h
        </CardTitle>
        <span className="flex items-center gap-1.5 text-xs text-primary">
          <Pulse className="size-3.5 animate-pulse" />
          live
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Spend (24h)
            </div>
            <div className="mt-0.5 font-mono text-2xl font-semibold text-foreground">
              {t ? usd(t.totalUsd) : '—'}
            </div>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Projected monthly
            </div>
            <div className="mt-0.5 font-mono text-2xl font-semibold text-primary">
              {data?.projectedMonthly != null ? `$${data.projectedMonthly.toFixed(2)}` : '—'}
            </div>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Local / self-hosted models are priced at an estimated blended rate (electricity +
          hardware amortization), not an API bill.
        </p>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Daily spend
          </div>
          <SpendBars daily={daily} />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byModel.length ? (
              byModel.map(([model, cost]) => (
                <TableRow key={model}>
                  <TableCell className="font-mono text-xs text-foreground">{model}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {usd(cost)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={2} className="py-6 text-center text-xs text-muted-foreground">
                  No gateway spend in the last 24h.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
