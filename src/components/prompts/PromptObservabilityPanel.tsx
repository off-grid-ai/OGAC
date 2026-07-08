'use client';

import { ChartLineUp, ArrowClockwise } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { relativeTime } from '@/lib/workspace-grid';

interface VersionStat {
  version: string;
  runs: number;
  tokens: number;
  p50: number;
  p95: number;
  blockRate: number;
}
interface Observability {
  runs: number;
  tokens: number;
  p50: number;
  p95: number;
  blockRate: number;
  byVersion: VersionStat[];
  series: { day: string; runs: number }[];
  windowDays: number;
}

function fmtMs(ms: number): string {
  if (!ms) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
function fmtNum(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}
function fmtPct(r: number): string {
  return `${Math.round(r * 100)}%`;
}
// The prompt's "version" is its updatedAt ISO timestamp (single living version per edit). Show it as
// the current version relative to the prompt's own updatedAt, else a readable timestamp.
function versionLabel(version: string, currentVersion?: string): string {
  if (!version) return 'unknown';
  if (currentVersion && version === currentVersion) return 'current';
  const d = new Date(version);
  return Number.isNaN(d.getTime()) ? version : relativeTime(version);
}

/** Bind the panel to a `refreshKey`: bump it (e.g. after a Playground run) to re-pull metrics. */
export function PromptObservabilityPanel({
  promptId,
  currentVersion,
  refreshKey = 0,
}: {
  promptId: string;
  currentVersion?: string;
  refreshKey?: number;
}) {
  const [data, setData] = useState<Observability | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/v1/prompts/${promptId}/observability`, { cache: 'no-store' });
      setData(r.ok ? ((await r.json()) as Observability) : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [promptId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const maxDay = data?.series.reduce((m, p) => Math.max(m, p.runs), 0) ?? 0;

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ChartLineUp className="size-4 text-primary" /> Performance
        </CardTitle>
        <div className="flex items-center gap-2">
          {data && data.runs > 0 ? (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              last {data.windowDays} days
            </span>
          ) : null}
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            title="Refresh metrics"
          >
            <ArrowClockwise className="size-3.5" /> refresh
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-muted-foreground">
          How this prompt is performing when you run it from the Playground — measured from real
          governed runs. Each edit starts a new version, so you can see whether a change made the
          prompt faster, cheaper, or more reliable.
        </p>

        {loading && !data ? (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Spinner className="size-4" /> Loading metrics…
          </div>
        ) : !data || data.runs === 0 ? (
          // Honest empty state — nothing invented before a single run exists.
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
            No runs yet. Run this prompt in the Playground above and its performance — run count,
            latency, token usage, and failure rate — will appear here, broken down by version.
          </div>
        ) : (
          <>
            {/* Overall stat band — full width, multi-column. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Runs" value={fmtNum(data.runs)} />
              <Stat label="Latency p50" value={fmtMs(data.p50)} />
              <Stat label="Latency p95" value={fmtMs(data.p95)} />
              <Stat label="Tokens" value={fmtNum(data.tokens)} />
              <Stat
                label="Failure rate"
                value={fmtPct(data.blockRate)}
                tone={data.blockRate > 0.1 ? 'warn' : undefined}
              />
            </div>

            {/* Daily run sparkline (simple bars — no external chart lib, CSP-safe). */}
            {data.series.length > 0 ? (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  Runs per day
                </div>
                <div className="flex h-16 items-end gap-0.5 overflow-x-auto">
                  {data.series.map((p) => (
                    <div
                      key={p.day}
                      className="min-w-[6px] flex-1 rounded-sm bg-primary/70"
                      style={{ height: `${maxDay ? Math.max(6, (p.runs / maxDay) * 100) : 6}%` }}
                      title={`${p.day}: ${p.runs} run${p.runs === 1 ? '' : 's'}`}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {/* Per-version breakdown — the core of the ask. */}
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                By version
              </div>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Version</th>
                      <th className="px-3 py-2 text-right font-medium">Runs</th>
                      <th className="px-3 py-2 text-right font-medium">p50</th>
                      <th className="px-3 py-2 text-right font-medium">p95</th>
                      <th className="px-3 py-2 text-right font-medium">Tokens</th>
                      <th className="px-3 py-2 text-right font-medium">Fail rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byVersion.map((v) => (
                      <tr key={v.version} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-foreground">
                          {versionLabel(v.version, currentVersion)}
                        </td>
                        <td className="px-3 py-2 text-right">{fmtNum(v.runs)}</td>
                        <td className="px-3 py-2 text-right">{fmtMs(v.p50)}</td>
                        <td className="px-3 py-2 text-right">{fmtMs(v.p95)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(v.tokens)}</td>
                        <td
                          className={`px-3 py-2 text-right ${v.blockRate > 0.1 ? 'text-amber-600 dark:text-amber-500' : ''}`}
                        >
                          {fmtPct(v.blockRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Failure rate counts runs the gateway rejected or errored (guardrail input blocks are
                stopped before the model and reported live in the Playground).
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn';
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <div
        className={`mt-0.5 font-mono text-base font-semibold ${tone === 'warn' ? 'text-amber-600 dark:text-amber-500' : 'text-foreground'}`}
      >
        {value}
      </div>
    </div>
  );
}
