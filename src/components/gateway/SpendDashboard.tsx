'use client';

import { ChartBar, Coins, Cube, Key, Stack } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  parseGroupBy,
  parseRange,
  SPEND_GROUP_BYS,
  SPEND_RANGES,
  type SpendFinOpsView,
  type SpendGroupBy,
  type SpendLogRow,
  type SpendRange,
} from '@/lib/litellm-spend';

// Gateway FinOps — cost/token/request attribution over LiteLLM's DB-backed spend store. URL-driven
// (?range=24h|7d|30d, ?groupBy=model|key). Leads with TOKENS + REQUEST VOLUME because the on-prem
// models are free ($0 per call): dollar-spend is surfaced but labelled a $0 no-op when it is one, so
// the surface never implies dollar-budgets bite on free routes.

const RANGE_LABEL: Record<SpendRange, string> = { '24h': 'Last 24h', '7d': 'Last 7 days', '30d': 'Last 30 days' };
const GROUP_LABEL: Record<SpendGroupBy, string> = { model: 'By model', key: 'By virtual key' };

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtUsd = (n: number) => `$${n.toFixed(n >= 1 ? 2 : 4)}`;
const fmtAvg = (n: number) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '0');

interface LogsPayload {
  configured: boolean;
  live: boolean;
  error?: string;
  data: SpendLogRow[];
}

export function SpendDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const range = parseRange(searchParams.get('range'));
  const groupBy = parseGroupBy(searchParams.get('groupBy'));

  const [view, setView] = useState<SpendFinOpsView | null>(null);
  const [logs, setLogs] = useState<LogsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set(key, value);
      router.push(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/v1/admin/gateway/spend?range=${range}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/v1/admin/gateway/spend/logs?range=${range}&limit=100`, { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([v, l]) => {
        if (cancelled) return;
        setView(v as SpendFinOpsView);
        setLogs(l as LogsPayload);
      })
      .catch(() => {
        if (cancelled) return;
        setView(null);
        setLogs(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-mono text-lg font-semibold tracking-tight">
            <Coins weight="duotone" className="size-5 text-primary" />
            Gateway spend &amp; FinOps
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Cost, token, and request attribution across every routed model and virtual key — read
            live from the gateway&apos;s own spend ledger.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented
            options={SPEND_RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
            active={range}
            onSelect={(v) => setParam('range', v)}
          />
        </div>
      </header>

      <ConfigBanner view={view} loading={loading} />

      <SummaryBand view={view} />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2 font-mono text-sm">
              <ChartBar weight="duotone" className="size-4 text-primary" />
              Volume over time · {RANGE_LABEL[range]}
            </CardTitle>
            <Badge variant="outline" className="font-mono text-[11px]">
              tokens
            </Badge>
          </CardHeader>
          <CardContent>
            <TimeSeries view={view} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-sm">Spend reality</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <SpendReality view={view} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2 font-mono text-sm">
            {groupBy === 'model' ? (
              <Cube weight="duotone" className="size-4 text-primary" />
            ) : (
              <Key weight="duotone" className="size-4 text-primary" />
            )}
            Attribution — {GROUP_LABEL[groupBy]}
          </CardTitle>
          <Segmented
            options={SPEND_GROUP_BYS.map((g) => ({ value: g, label: GROUP_LABEL[g] }))}
            active={groupBy}
            onSelect={(v) => setParam('groupBy', v)}
          />
        </CardHeader>
        <CardContent>
          {groupBy === 'model' ? <ByModelTable view={view} /> : <ByKeyTable view={view} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2 font-mono text-sm">
            <Stack weight="duotone" className="size-4 text-primary" />
            Recent requests
          </CardTitle>
          <Badge variant="outline" className="font-mono text-[11px]">
            {logs?.data.length ?? 0} rows
          </Badge>
        </CardHeader>
        <CardContent>
          <LogsTable logs={logs} />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── selectors ────────────────────────────────────────────────────────────────────────────────

function Segmented<T extends string>({
  options,
  active,
  onSelect,
}: Readonly<{ options: { value: T; label: string }[]; active: T; onSelect: (v: T) => void }>) {
  return (
    <div className="inline-flex rounded-md border border-border bg-card p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onSelect(opt.value)}
          aria-pressed={opt.value === active}
          className={cn(
            'rounded px-3 py-1 font-mono text-xs transition-colors',
            opt.value === active
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── banners + summary ──────────────────────────────────────────────────────────────────────────

function ConfigBanner({ view, loading }: Readonly<{ view: SpendFinOpsView | null; loading: boolean }>) {
  if (loading || !view) return null;
  if (!view.configured) {
    return (
      <Banner tone="muted">
        The gateway spend ledger is not configured (<code className="font-mono">OFFGRID_LITELLM_URL</code>{' '}
        unset). Point the console at the proxy to see live cost attribution.
      </Banner>
    );
  }
  if (!view.live) {
    return (
      <Banner tone="warn">
        Could not read the spend ledger{view.error ? `: ${view.error}` : ''}. Showing an empty window.
      </Banner>
    );
  }
  return null;
}

function Banner({ tone, children }: Readonly<{ tone: 'muted' | 'warn'; children: React.ReactNode }>) {
  return (
    <div
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'warn'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-border bg-muted/40 text-muted-foreground',
      )}
    >
      {children}
    </div>
  );
}

function SummaryBand({ view }: Readonly<{ view: SpendFinOpsView | null }>) {
  const s = view?.summary;
  const tiles = [
    { label: 'Requests', value: s ? fmtInt(s.requests) : '—', hint: 'in window' },
    { label: 'Total tokens', value: s ? fmtInt(s.tokens) : '—', hint: `${s ? fmtInt(s.promptTokens) : '—'} in / ${s ? fmtInt(s.completionTokens) : '—'} out` },
    { label: 'Avg tokens / req', value: s ? fmtAvg(s.avgTokensPerRequest) : '—', hint: 'throughput' },
    {
      label: 'Total spend',
      value: s ? fmtUsd(s.spend) : '—',
      hint: s?.allFree ? 'free on-prem models · $0' : 'billed cost',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent className="space-y-1 p-4">
            <div className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{t.label}</div>
            <div className="font-mono text-2xl font-semibold tabular-nums">{t.value}</div>
            <div className="truncate text-[11px] text-muted-foreground">{t.hint}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SpendReality({ view }: Readonly<{ view: SpendFinOpsView | null }>) {
  if (!view) return <span className="text-muted-foreground">Loading…</span>;
  const s = view.summary;
  return (
    <>
      {s.allFree ? (
        <p className="text-muted-foreground">
          Every request in this window ran on a <span className="text-foreground">free on-prem model</span>,
          so computed dollar-spend is <span className="font-mono text-foreground">$0</span>. Dollar
          budgets do not bite here — <span className="text-foreground">tokens and request volume</span>{' '}
          are the real control signal. Dollar-spend binds only on cost-bearing (cloud) routes.
        </p>
      ) : (
        <p className="text-muted-foreground">
          Billed spend this window: <span className="font-mono text-foreground">{fmtUsd(s.spend)}</span>{' '}
          across <span className="text-foreground">{fmtInt(s.requests)}</span> requests
          (<span className="font-mono">{fmtUsd(s.avgCostPerRequest)}</span>/req avg). Cost-bearing
          routes are metered by the gateway&apos;s price table.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-[11px]">
        <div>
          <dt className="text-muted-foreground">Aggregate: /global/spend/keys</dt>
          <dd className="font-mono">{view.aggregates.globalSpendKeys.available ? 'available' : 'unavailable'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Aggregate: /global/spend/models</dt>
          <dd className="font-mono">{view.aggregates.globalSpendModels.available ? 'available' : 'unavailable'}</dd>
        </div>
      </dl>
    </>
  );
}

// ─── time series (inline SVG bars — no chart libs) ───────────────────────────────────────────────

function TimeSeries({ view }: Readonly<{ view: SpendFinOpsView | null }>) {
  const buckets = view?.timeSeries ?? [];
  if (!buckets.length || buckets.every((b) => b.tokens === 0)) {
    return <div className="py-10 text-center text-xs text-muted-foreground">No traffic in this window.</div>;
  }
  const w = 720;
  const h = 120;
  const max = Math.max(1, ...buckets.map((b) => b.tokens));
  const bw = w / buckets.length;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full min-w-[480px]" preserveAspectRatio="none">
        {buckets.map((b, i) => {
          const bh = (b.tokens / max) * (h - 6);
          return (
            <rect
              key={b.bucketStart}
              x={i * bw + 1}
              y={h - bh}
              width={Math.max(1, bw - 2)}
              height={bh}
              className="fill-primary/80"
            >
              <title>
                {new Date(b.bucketStart).toLocaleString()} · {fmtInt(b.tokens)} tokens · {b.requests} req
              </title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

// ─── attribution tables ───────────────────────────────────────────────────────────────────────

function EmptyRow({ colSpan, text }: Readonly<{ colSpan: number; text: string }>) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-xs text-muted-foreground">
        {text}
      </TableCell>
    </TableRow>
  );
}

function ByModelTable({ view }: Readonly<{ view: SpendFinOpsView | null }>) {
  const rows = view?.byModel ?? [];
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">In / Out</TableHead>
            <TableHead className="text-right">Spend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={5} text="No spend attributed in this window." />
          ) : (
            rows.map((m) => (
              <TableRow key={m.model}>
                <TableCell className="font-mono">{m.model}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(m.requests)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(m.tokens)}</TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  {fmtInt(m.promptTokens)} / {fmtInt(m.completionTokens)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.spend === 0 ? <span className="text-muted-foreground">$0</span> : fmtUsd(m.spend)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function ByKeyTable({ view }: Readonly<{ view: SpendFinOpsView | null }>) {
  const rows = view?.byKey ?? [];
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Virtual key</TableHead>
            <TableHead>Token</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Spend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={5} text="No spend attributed in this window." />
          ) : (
            rows.map((k) => (
              <TableRow key={k.key}>
                <TableCell className="font-mono">{k.keyAlias ?? k.key}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{k.keyMasked ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(k.requests)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(k.tokens)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {k.spend === 0 ? <span className="text-muted-foreground">$0</span> : fmtUsd(k.spend)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function LogsTable({ logs }: Readonly<{ logs: LogsPayload | null }>) {
  const rows = logs?.data ?? [];
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>User</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={6} text="No requests in this window." />
          ) : (
            rows.map((r, i) => (
              <TableRow key={r.requestId ?? `${r.ts}-${i}`}>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {r.ts ? new Date(r.ts).toLocaleString() : '—'}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.model}</TableCell>
                <TableCell className="font-mono text-xs">{r.keyAlias ?? r.keyMasked ?? '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.endUser ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(r.tokens)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.spend === 0 ? <span className="text-muted-foreground">$0</span> : fmtUsd(r.spend)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
