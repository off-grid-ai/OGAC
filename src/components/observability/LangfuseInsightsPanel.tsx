'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { LangfuseCostSummary, ScoreTrendSeries } from '@/lib/langfuse';
import { modelLabel } from '@/lib/model-catalog';

// Distinct colors so multiple score series read apart. Emerald leads (brand accent).
const SERIES_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4', '#a3a3a3'];
const AXIS = { stroke: 'var(--og-text-muted)', fontSize: 11 };
const TOOLTIP = {
  contentStyle: {
    background: 'var(--og-surface)',
    border: '1px solid var(--og-border)',
    borderRadius: 8,
    fontSize: 12,
  },
};

const RANGES = ['24h', '7d', '30d', '90d'] as const;

// URL-driven range selector — the active range lives in ?lfRange so the view is deep-linkable and
// Back-coherent (a distinct param from any FinOps range, since this is the Langfuse-sourced view).
function RangeSelector({ active }: Readonly<{ active: string }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = useCallback(
    (r: string) => {
      const next = new URLSearchParams(params.toString());
      next.set('lfRange', r);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );
  return (
    <div className="flex items-center gap-1 text-xs">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => set(r)}
          className={`rounded-md border px-2 py-1 ${
            active === r ? 'border-primary text-primary' : 'border-border text-muted-foreground'
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

// Merge per-series points into one row-per-timestamp dataset for a multi-line recharts chart.
function mergeTrendData(trends: ScoreTrendSeries[]): {
  rows: Array<Record<string, string | number>>;
  names: string[];
} {
  const byTs = new Map<string, Record<string, string | number>>();
  for (const s of trends) {
    for (const p of s.points) {
      const label = p.ts.slice(0, 10);
      const row = byTs.get(p.ts) ?? { ts: label };
      row[s.name] = p.value;
      byTs.set(p.ts, row);
    }
  }
  const rows = [...byTs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, r]) => r);
  return { rows, names: trends.map((t) => t.name) };
}

function fmtUsd(n: number): string {
  // More decimals for smaller amounts: ≥$100 whole, ≥$1 cents, else 4 dp for sub-dollar costs.
  let decimals: number;
  if (n >= 100) decimals = 0;
  else if (n >= 1) decimals = 2;
  else decimals = 4;
  return `$${n.toFixed(decimals)}`;
}
function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

export function LangfuseInsightsPanel({
  configured,
  cost,
  trends,
  error,
  range,
}: Readonly<{
  configured: boolean;
  cost: LangfuseCostSummary;
  trends: ScoreTrendSeries[];
  error?: string;
  range: string;
}>) {
  const { rows, names } = mergeTrendData(trends);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Tracing store read-back — cost &amp; eval scores
          </h2>
          <p className="text-xs text-muted-foreground">
            Sourced directly from the tracing store (daily metrics + scores) over the selected window.
            Distinct from the audit-log-derived FinOps figures.
          </p>
        </div>
        <RangeSelector active={range} />
      </div>

      {!configured ? (
        <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          Tracing store read-back not configured — set the tracing-store URL + project keys to pull
          cost and eval-score history back. Showing zeros.
        </p>
      ) : error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Tracing store unreachable: {error} — showing zeros.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Traced cost (window)', value: fmtUsd(cost.totalCost) },
          { label: 'Traced tokens', value: fmtNum(cost.totalTokens) },
          { label: 'Traces', value: fmtNum(cost.totalTraces) },
          { label: 'Scored metrics', value: String(trends.length) },
        ].map((s) => (
          <Card key={s.label} className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
                {s.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-foreground">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Eval score trend</CardTitle>
            <p className="text-xs text-muted-foreground">
              Numeric eval scores from the tracing store, one line per metric.
            </p>
          </CardHeader>
          <CardContent>
            {rows.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--og-border)" vertical={false} />
                  <XAxis dataKey="ts" tickFormatter={(d: string) => d.slice(5)} {...AXIS} />
                  <YAxis {...AXIS} />
                  <Tooltip {...TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {names.map((name, i) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No eval scores in this window.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Cost by model</CardTitle>
            <p className="text-xs text-muted-foreground">
              Per-model cost + token usage aggregated from the tracing store&apos;s daily metrics.
            </p>
          </CardHeader>
          <CardContent>
            {cost.byModel.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cost.byModel.map((m) => (
                    <TableRow key={m.model}>
                      <TableCell className="text-xs text-foreground">{modelLabel(m.model)}</TableCell>
                      <TableCell className="text-right text-foreground">{fmtUsd(m.cost)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {fmtNum(m.tokens)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No cost data in this window.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
