'use client';

import { Gauge, Lightning } from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CacheStats } from '@/lib/litellm-cache';

// Cache observability — hit-rate + tokens/cost saved, derived from LiteLLM's own cache_hit marker on
// /spend/logs. HONEST: when the deployment doesn't stamp cache_hit (markerUnavailable), we lead with
// request volume and say the hit-rate isn't reported, rather than showing a fabricated 0%/100%.

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtUsd = (n: number) => `$${n.toFixed(n >= 1 ? 2 : 4)}`;

export interface CacheStatsPayload {
  configured: boolean;
  live: boolean;
  error?: string;
  stats: CacheStats;
}

export function CacheStatsPanel({
  payload,
  loading,
}: Readonly<{ payload: CacheStatsPayload | null; loading: boolean }>) {
  const stats = payload?.stats;
  const unavailable = !stats || stats.markerUnavailable;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <Gauge weight="duotone" className="size-4 text-primary" />
          Cache effectiveness
        </CardTitle>
        <Badge variant="outline" className="font-mono text-[11px]">
          {stats ? `${fmtInt(stats.requests)} req` : '…'}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !payload ? (
          <p className="text-sm text-muted-foreground">Computing hit-rate…</p>
        ) : !payload.configured ? (
          <p className="text-sm text-muted-foreground">
            Gateway not configured — no spend ledger to derive cache stats from.
          </p>
        ) : !payload.live ? (
          <p className="text-sm text-muted-foreground">
            Could not read the spend ledger{payload.error ? `: ${payload.error}` : ''}.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile
                label="Hit rate"
                value={unavailable ? 'n/a' : fmtPct(stats!.hitRate)}
                hint={unavailable ? 'not reported' : `${fmtInt(stats!.hits)} / ${fmtInt(stats!.decided)} decided`}
                accent={!unavailable}
              />
              <Tile label="Cache hits" value={unavailable ? '—' : fmtInt(stats!.hits)} hint="served from cache" />
              <Tile
                label="Tokens saved"
                value={unavailable ? '—' : fmtInt(stats!.tokensSaved)}
                hint="compute avoided"
              />
              <Tile
                label="Cost saved"
                value={unavailable ? '—' : fmtUsd(stats!.costSaved)}
                hint={stats!.costSaved === 0 ? 'free on-prem · $0' : 'billed cost avoided'}
              />
            </div>
            {unavailable ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] text-muted-foreground">
                <Lightning weight="duotone" className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <p>
                  This gateway does not stamp a <code className="font-mono">cache_hit</code> marker on its
                  request logs, so a hit-rate cannot be computed honestly. Request volume is shown instead.
                  Hit-rate becomes available once response caching is enabled and the proxy records cache
                  hits in its spend logs.
                </p>
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Hit-rate is measured over the <span className="text-foreground">{fmtInt(stats!.decided)}</span>{' '}
                requests the gateway marked as a cache hit or miss. Tokens/cost saved sum over the hit
                requests — the compute the cache spared you.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({
  label,
  value,
  hint,
  accent,
}: Readonly<{ label: string; value: string; hint: string; accent?: boolean }>) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={
          accent
            ? 'mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400'
            : 'mt-1 font-mono text-2xl font-semibold tabular-nums'
        }
      >
        {value}
      </div>
      <div className="truncate text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}
