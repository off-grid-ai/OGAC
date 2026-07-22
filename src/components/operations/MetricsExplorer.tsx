'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MetricChart } from '@/components/platform-health/MetricChart';
import { MetricsSavedQueries } from '@/components/operations/MetricsSavedQueries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { type ChartData, RANGE_WINDOWS, type RangeWindow } from '@/lib/victoriametrics-query';

const API = '/api/v1/admin/operations/metrics';

interface QueryState {
  loading: boolean;
  configured: boolean;
  chart?: ChartData;
  latest?: number | null;
  error?: string;
}

// The PromQL workbench. Everything the operator can point at is URL-state (?q / ?range) so the view
// is deep-linkable and Back-coherent; the input is uncontrolled + seeded from the URL. Chart data is
// fetched live from the admin routes (VictoriaMetrics read adapter behind them).
export function MetricsExplorer({
  initialQuery,
  initialRange,
}: Readonly<{ initialQuery: string; initialRange: RangeWindow }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const q = (params.get('q') ?? initialQuery).trim();
  const range = (params.get('range') as RangeWindow) || initialRange;

  const [names, setNames] = useState<string[]>([]);
  const [state, setState] = useState<QueryState>({ loading: false, configured: true });

  // Metric-name catalogue for the picker (once).
  useEffect(() => {
    let alive = true;
    fetch(`${API}/metric-names`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { names?: string[] }) => {
        if (alive) setNames(Array.isArray(d.names) ? d.names : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Run the range + instant queries whenever the URL query/range changes.
  useEffect(() => {
    if (!q) {
      setState({ loading: false, configured: true });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const rangeUrl = `${API}/query-range?q=${encodeURIComponent(q)}&range=${range}`;
    const instantUrl = `${API}/query?q=${encodeURIComponent(q)}`;
    Promise.all([
      fetch(rangeUrl, { cache: 'no-store' }).then((r) => r.json()),
      fetch(instantUrl, { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(
        ([rangeRes, instantRes]: [
          { configured?: boolean; chart?: ChartData; error?: string },
          { configured?: boolean; chart?: ChartData; error?: string },
        ]) => {
          if (!alive) return;
          setState({
            loading: false,
            configured: rangeRes.configured !== false,
            chart: rangeRes.chart,
            latest: latestFromChart(instantRes.chart),
            error: rangeRes.error ?? instantRes.error,
          });
        },
      )
      .catch((e) => {
        if (alive) setState({ loading: false, configured: true, error: (e as Error).message });
      });
    return () => {
      alive = false;
    };
  }, [q, range]);

  const setParam = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mut(next);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const submit = (raw: string) =>
    setParam((p) => {
      const v = raw.trim();
      if (v) p.set('q', v);
      else p.delete('q');
    });

  const rangeButtons = useMemo(() => RANGE_WINDOWS, []);

  return (
    <div className="w-full space-y-4">
      {/* Query band — full width */}
      <form
        className="flex flex-col gap-3 rounded-lg border border-border p-4 md:flex-row md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem('q') as HTMLInputElement | null;
          submit(input?.value ?? '');
        }}
      >
        <div className="flex-1 space-y-1">
          <label htmlFor="promql" className="text-xs font-medium text-muted-foreground">
            PromQL / MetricsQL
          </label>
          <Input
            id="promql"
            name="q"
            list="vm-metric-names"
            defaultValue={q}
            key={q}
            placeholder='e.g. sum(rate(otelcol_receiver_accepted_spans_total[5m]))'
            className="font-mono text-sm"
          />
          <datalist id="vm-metric-names">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">Range</span>
          <div className="flex overflow-hidden rounded-md border border-border">
            {rangeButtons.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setParam((p) => p.set('range', w))}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  w === range
                    ? 'bg-emerald-600 text-white'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
        <Button type="submit">Run</Button>
      </form>

      {/* Results + saved queries — side by side on lg+ */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {!state.configured ? (
            <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
              VictoriaMetrics isn&apos;t connected yet. Connect it in Configuration to explore live
              metrics here.
            </p>
          ) : !q ? (
            <div className="flex h-[220px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-center">
              <span className="text-sm font-medium text-muted-foreground">
                Enter a query or load a saved one
              </span>
              <span className="max-w-md px-4 text-xs text-muted-foreground/70">
                Start typing a metric name to autocomplete from the live catalogue, then Run.
              </span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="rounded-md border border-border px-3 py-1.5">
                  Latest:{' '}
                  <span className="font-semibold tabular-nums text-foreground">
                    {state.loading
                      ? '…'
                      : state.latest == null
                        ? 'no value'
                        : formatValue(state.latest)}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">window {range}</span>
              </div>
              {state.error ? (
                <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
                  Query error: {state.error}
                </p>
              ) : state.chart ? (
                <MetricChart chart={{ ...state.chart, title: q, unit: range }} />
              ) : (
                <div className="flex h-[180px] items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                  {state.loading ? 'Running…' : 'No data'}
                </div>
              )}
            </>
          )}
        </div>

        <MetricsSavedQueries currentQuery={q} currentRange={range} />
      </div>
    </div>
  );
}

// Read the newest numeric value across a shaped instant chart's single row (the instant vector).
function latestFromChart(chart: ChartData | undefined): number | null {
  if (!chart || chart.rows.length === 0) return null;
  const row = chart.rows[chart.rows.length - 1];
  for (const key of chart.keys) {
    const v = row[key];
    if (typeof v === 'number') return v;
  }
  return null;
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01)) return v.toExponential(2);
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}
