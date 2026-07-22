'use client';

import type { HistogramSeries } from '@/lib/victorialogs-query';

// Presentational log-volume histogram — one bar per time bucket, height scaled to the busiest
// bucket. Full-width; bars flex to fill. Purely driven by the shaped series the adapter returns.
export function LogsHistogram({
  series,
  loading,
}: Readonly<{ series: HistogramSeries; loading?: boolean }>) {
  const { buckets, max, total } = series;
  const fmt = (t: string) => {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? t : d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
  };
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>Log volume over the selected range</span>
        <span className="tabular-nums">{total.toLocaleString()} matches</span>
      </div>
      {buckets.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
          {loading ? 'Loading histogram…' : 'No matching log volume in this window.'}
        </div>
      ) : (
        <div className="flex h-24 items-end gap-px" role="img" aria-label={`Histogram of ${total} log entries across ${buckets.length} buckets`}>
          {buckets.map((b) => {
            const pct = max > 0 ? Math.max((b.count / max) * 100, b.count > 0 ? 4 : 0) : 0;
            return (
              <div
                key={b.time}
                className="flex-1 rounded-sm bg-primary/70 transition-all hover:bg-primary"
                style={{ height: `${pct}%` }}
                title={`${fmt(b.time)} · ${b.count.toLocaleString()}`}
              />
            );
          })}
        </div>
      )}
      {buckets.length > 0 ? (
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{fmt(buckets[0].time)}</span>
          <span>{fmt(buckets[buckets.length - 1].time)}</span>
        </div>
      ) : null}
    </div>
  );
}
