'use client';

import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { NativeChartData, NativeSupersetDashboard } from '@/lib/superset-data';

// Native BI panel — Superset stays the query/semantic engine BEHIND the scenes; the console pulls
// each chart's data via Superset's REST chart-data API and renders it with OUR recharts components.
// No iframe, no framed Superset UI. Power users get a single "Open in Superset" link-out for
// authoring. Honest empty states throughout — never fabricated numbers, never a blank iframe.
//
// `dashboard` is the shaped read-back (superset-data.ts). Colours + axis/tooltip tokens follow the
// existing chart cards (emerald leads).
const EMERALD = '#10b981';
const AXIS = { stroke: 'var(--og-text-muted)', fontSize: 11 };
const TOOLTIP = {
  contentStyle: {
    background: 'var(--og-surface)',
    border: '1px solid var(--og-border)',
    borderRadius: 8,
    fontSize: 12,
  },
};

function EmptyChart({ note }: Readonly<{ note: string }>) {
  return (
    <div
      data-testid="native-chart-empty"
      className="flex h-[180px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-center"
    >
      <span className="text-xs font-medium text-muted-foreground">No data yet</span>
      <span className="max-w-xs px-4 text-[11px] text-muted-foreground/70">{note}</span>
    </div>
  );
}

function NativeChartCard({ chart }: Readonly<{ chart: NativeChartData }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{chart.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {chart.error ? (
          <p className="py-8 text-center text-xs text-destructive">Query error: {chart.error}</p>
        ) : chart.kind === 'number' ? (
          <div className="text-3xl font-semibold text-foreground">
            {chart.scalar != null ? chart.scalar.toLocaleString() : '—'}
          </div>
        ) : !chart.hasData ? (
          <EmptyChart note="Awaiting governed data — provision the dashboard or send gateway traffic to populate it." />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            {chart.kind === 'bar' ? (
              <BarChart data={chart.rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--og-border)" vertical={false} />
                <XAxis dataKey={chart.xKey} {...AXIS} />
                <YAxis {...AXIS} />
                <Tooltip {...TOOLTIP} cursor={{ fill: 'var(--og-surface-light)' }} />
                {chart.valueKeys.map((k) => (
                  <Bar key={k} dataKey={k} fill={EMERALD} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            ) : (
              <LineChart data={chart.rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--og-border)" vertical={false} />
                <XAxis dataKey={chart.xKey} {...AXIS} />
                <YAxis {...AXIS} />
                <Tooltip {...TOOLTIP} />
                {chart.valueKeys.map((k) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={k}
                    stroke={EMERALD}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function NativeSupersetPanel({ dashboard }: Readonly<{ dashboard: NativeSupersetDashboard }>) {
  if (!dashboard.configured) {
    return (
      <p data-testid="superset-not-configured" className="text-xs text-muted-foreground">
        BI engine isn&apos;t connected yet — connect it in Settings to surface native dashboards
        here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Rendered natively from the governed warehouse — Superset runs the queries, the console draws
          the charts. No embedded UI.
        </p>
        {dashboard.supersetBase ? (
          <a
            href={dashboard.supersetBase}
            target="_blank"
            rel="noreferrer"
            data-testid="open-in-superset"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ArrowSquareOut className="size-4" />
            Open in Superset
          </a>
        ) : null}
      </div>

      {dashboard.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          BI engine unreachable: {dashboard.error} — showing empty charts.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {dashboard.charts.map((c) => (
          <NativeChartCard key={c.id} chart={c} />
        ))}
      </div>
    </div>
  );
}
