'use client';

import { ArrowUpRight, TrendUp, Users, Target, CurrencyInr } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CockpitMetrics, TrendPoint } from '@/lib/cockpit-metrics';
import { formatInr, formatPct } from '@/lib/cockpit-metrics';

const STAGE_COLOR: Record<string, string> = {
  lead: '#a3a3a3',
  qualified: '#6366f1',
  proposed: '#f59e0b',
  won: '#10b981',
};
const CHART_AXIS = { stroke: 'var(--og-text-muted)', fontSize: 11 };
const CHART_TOOLTIP = {
  contentStyle: {
    background: 'var(--og-surface)',
    border: '1px solid var(--og-border)',
    borderRadius: 8,
    fontSize: 12,
  },
};

export function CockpitDashboard({
  metrics,
  trend,
  live,
  customerHrefBase,
}: Readonly<{
  metrics: CockpitMetrics;
  trend: TrendPoint[];
  live: boolean;
  customerHrefBase: string;
}>) {
  const { kpi, funnel, productMix, topOpportunities } = metrics;
  const kpis = [
    { label: 'Assets under management', value: formatInr(kpi.totalAumInr), icon: CurrencyInr, tone: 'text-foreground' },
    { label: 'Customers in book', value: kpi.customerCount.toLocaleString('en-IN'), icon: Users, tone: 'text-foreground' },
    { label: 'Open pipeline', value: formatInr(kpi.pipelineValueInr), icon: Target, tone: 'text-primary' },
    { label: 'Conversion rate', value: formatPct(kpi.conversionRate), icon: TrendUp, tone: 'text-primary' },
  ];

  return (
    <div className="space-y-5">
      {/* KPI band — the headline the RM reads first */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label} className="gap-3 py-5 shadow-sm">
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
                    {k.label}
                  </CardTitle>
                  <Icon className="size-4 text-primary/70" weight="duotone" />
                </div>
              </CardHeader>
              <CardContent className={`text-2xl font-semibold tabular-nums ${k.tone}`}>{k.value}</CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts row — funnel + pipeline trend */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Cross-sell funnel</CardTitle>
            <p className="text-xs text-muted-foreground">Opportunities by stage — value in ₹</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={funnel} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--og-border)" vertical={false} />
                <XAxis dataKey="stage" {...CHART_AXIS} tickFormatter={(s: string) => s[0].toUpperCase() + s.slice(1)} />
                <YAxis {...CHART_AXIS} width={44} tickFormatter={(v: number) => `${Math.round(v / 1e5)}L`} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v) => formatInr(Number(v))} />
                <Bar dataKey="valueInr" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                  {funnel.map((f) => (
                    <Cell key={f.stage} fill={STAGE_COLOR[f.stage]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Pipeline trend</CardTitle>
            <p className="text-xs text-muted-foreground">Open pipeline value, last 6 months</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="cockpit-trend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--og-border)" vertical={false} />
                <XAxis dataKey="month" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} width={44} tickFormatter={(v: number) => `${Math.round(v / 1e5)}L`} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v) => formatInr(Number(v))} />
                <Area type="monotone" dataKey="pipelineInr" stroke="#10b981" strokeWidth={2} fill="url(#cockpit-trend)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top opportunities + product mix */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>Top cross-sell opportunities</span>
              <Badge variant="secondary" className="bg-primary/10 text-[10px] text-primary">
                call these first
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-6 py-2 font-normal">Customer</th>
                    <th className="px-3 py-2 font-normal">Next best</th>
                    <th className="px-3 py-2 font-normal">Stage</th>
                    <th className="px-3 py-2 text-right font-normal">Expected</th>
                    <th className="px-6 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {topOpportunities.map((o) => (
                    <tr key={o.customerId} className="border-b border-border/50 transition-colors hover:bg-muted/40">
                      <td className="px-6 py-2.5">
                        <div className="font-medium text-foreground">{o.customer}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {o.segment} · {o.region}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-foreground">{o.nextBestProduct}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-flex items-center gap-1.5 text-xs capitalize text-muted-foreground"
                        >
                          <span className="size-2 rounded-full" style={{ background: STAGE_COLOR[o.stage] }} />
                          {o.stage}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-foreground">
                        {formatInr(o.expectedValueInr)}
                      </td>
                      <td className="px-6 py-2.5 text-right">
                        <Link
                          href={`${customerHrefBase}${o.customerId}`}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          View <ArrowUpRight className="size-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Product mix</CardTitle>
            <p className="text-xs text-muted-foreground">Holders per product</p>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {productMix.slice(0, 7).map((p) => {
              const max = productMix[0]?.holders || 1;
              return (
                <div key={p.product} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground">{p.product}</span>
                    <span className="tabular-nums text-muted-foreground">{p.holders}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${(p.holders / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
