'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DayPoint, ModelStat } from '@/lib/analytics';

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

export function EventsChart({ data }: Readonly<{ data: DayPoint[] }>) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          <linearGradient id="ev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={EMERALD} stopOpacity={0.3} />
            <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--og-border)" vertical={false} />
        <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} {...AXIS} />
        <YAxis {...AXIS} />
        <Tooltip {...TOOLTIP} />
        <Area type="monotone" dataKey="events" stroke={EMERALD} strokeWidth={2} fill="url(#ev)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LatencyChart({ data }: Readonly<{ data: DayPoint[] }>) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--og-border)" vertical={false} />
        <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} {...AXIS} />
        <YAxis {...AXIS} />
        <Tooltip {...TOOLTIP} />
        <Area
          type="monotone"
          dataKey="avgLatency"
          stroke={EMERALD}
          strokeWidth={2}
          fillOpacity={0}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Eval-score history (0–100). `data` is oldest→newest so the line reads left-to-right in time.
export function ScoreTrendChart({ data }: Readonly<{ data: { label: string; score: number }[] }>) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          <linearGradient id="sc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={EMERALD} stopOpacity={0.3} />
            <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--og-border)" vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis domain={[0, 100]} {...AXIS} />
        <Tooltip {...TOOLTIP} />
        <Area type="monotone" dataKey="score" stroke={EMERALD} strokeWidth={2} fill="url(#sc)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ModelTokensChart({ data }: Readonly<{ data: ModelStat[] }>) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--og-border)" vertical={false} />
        <XAxis dataKey="model" {...AXIS} />
        <YAxis {...AXIS} />
        <Tooltip {...TOOLTIP} cursor={{ fill: 'var(--og-surface-light)' }} />
        <Bar dataKey="tokens" fill={EMERALD} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
