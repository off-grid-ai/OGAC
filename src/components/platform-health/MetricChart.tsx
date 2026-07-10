'use client';

import {
  Area,
  AreaChart,
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
import type { ChartData } from '@/lib/victoria-metrics-shape';

// Recharts wrapper for one VictoriaMetrics chart. Emerald leads; extra series get distinct colors so
// multi-series (per-service) charts read apart. HONESTY: when `emitting` is false we render a clear
// "not emitting yet" empty state with the spec's one-line hint — never a flat zero line pretending
// to be live data. An error (VM reachable but the query failed) shows the message.
const COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4', '#a3a3a3'];
const AXIS = { stroke: 'var(--og-text-muted)', fontSize: 11 };
const TOOLTIP = {
  contentStyle: {
    background: 'var(--og-surface)',
    border: '1px solid var(--og-border)',
    borderRadius: 8,
    fontSize: 12,
  },
};

function fmtTime(t: number): string {
  const d = new Date(t * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function MetricChart({ chart, hint }: { chart: ChartData; hint?: string }) {
  const single = chart.keys.length <= 1;
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span>{chart.title}</span>
          <span className="text-xs font-normal text-muted-foreground">{chart.unit}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chart.error ? (
          <p className="py-8 text-center text-xs text-destructive">Query error: {chart.error}</p>
        ) : !chart.emitting ? (
          <div className="flex h-[180px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-center">
            <span className="text-xs font-medium text-muted-foreground">Not emitting yet</span>
            {hint ? (
              <span className="max-w-xs px-4 text-[11px] text-muted-foreground/70">{hint}</span>
            ) : null}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            {single ? (
              <AreaChart data={chart.rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id={`g-${chart.title}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS[0]} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={COLORS[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--og-border)" vertical={false} />
                <XAxis dataKey="t" tickFormatter={fmtTime} {...AXIS} />
                <YAxis {...AXIS} width={44} />
                <Tooltip {...TOOLTIP} labelFormatter={(t) => fmtTime(Number(t))} />
                <Area
                  type="monotone"
                  dataKey={chart.keys[0] ?? 'value'}
                  stroke={COLORS[0]}
                  strokeWidth={2}
                  fill={`url(#g-${chart.title})`}
                  connectNulls={false}
                />
              </AreaChart>
            ) : (
              <LineChart data={chart.rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--og-border)" vertical={false} />
                <XAxis dataKey="t" tickFormatter={fmtTime} {...AXIS} />
                <YAxis {...AXIS} width={44} />
                <Tooltip {...TOOLTIP} labelFormatter={(t) => fmtTime(Number(t))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {chart.keys.map((k, i) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={k}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
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
