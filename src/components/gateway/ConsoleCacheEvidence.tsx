import { Database, Info, Warning } from '@phosphor-icons/react/dist/ssr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CacheCounters, CacheEvidence, CacheSelection } from '@/lib/cache-evidence';

// ─── What the console's OWN answer cache is doing ───────────────────────────────────────────────────
//
// This is NOT the gateway's cache (the panels above it). Two different caches sit in the answer path and
// conflating them is worse than showing neither: this one is the console's exact + near-duplicate answer
// cache, and it is the one that can silently stop being shared.
//
// The counters record WHICH BACKEND ANSWERED. A cache that has fallen back to per-process memory still
// serves every request and still posts a fine hit rate — so a hit-rate number cannot show the failure,
// and that is exactly why this panel leads with the state and not the rate.

const STATE_STYLE: Record<CacheEvidence['state'], { label: string; className: string }> = {
  shared: { label: 'SHARED', className: 'text-emerald-700 dark:text-emerald-400 border-emerald-600/40' },
  degraded: { label: 'DEGRADED', className: 'text-amber-700 dark:text-amber-500 border-amber-600/40' },
  'local-only': { label: 'IN-PROCESS', className: 'text-muted-foreground border-border' },
  idle: { label: 'UNEXERCISED', className: 'text-muted-foreground border-border' },
};

/** Reads and writes split by which backend answered — the split is the point, so it is never summed away. */
function tallies(c: CacheCounters): { label: string; value: number; hint: string }[] {
  return [
    { label: 'Reads served by the shared store', value: c.sharedHits, hint: 'Any process could have written these.' },
    { label: 'Reads served by this process only', value: c.fallbackHits, hint: 'The shared store did not have what it should have.' },
    { label: 'Reads that found nothing', value: c.misses, hint: 'A genuine miss — the answer had to be computed.' },
    { label: 'Reads past their lifetime', value: c.expired, hint: 'Found, but too old to use. Not a miss.' },
    { label: 'Writes that reached the shared store', value: c.sharedWrites, hint: 'These outlive this process.' },
    { label: 'Writes that stayed in this process', value: c.fallbackWrites, hint: 'Lost when this process restarts.' },
    { label: 'Entries explicitly removed', value: c.invalidations, hint: 'Neither a hit nor a miss.' },
  ];
}

export function ConsoleCacheEvidence({
  counters,
  evidence,
  selection,
}: Readonly<{ counters: CacheCounters; evidence: CacheEvidence; selection: CacheSelection }>) {
  const style = STATE_STYLE[evidence.state];
  const rate = evidence.hitRate === null ? null : Math.round(evidence.hitRate * 100);
  const fallback = evidence.fallbackShare === null ? null : Math.round(evidence.fallbackShare * 100);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Database className="size-4 text-primary" weight="duotone" />
            The console’s own answer cache
          </CardTitle>
          <span
            className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] tracking-wider ${style.className}`}
          >
            {style.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Separate from the gateway cache above — this is the layer that answers repeated and near-duplicate
          questions before any model is asked.
        </p>
      </CardHeader>

      <CardContent className="space-y-3 text-xs">
        {/* The misconfiguration case first: its counters are indistinguishable from an outage, so if we do
            not name it here the reader goes looking for a server that was never configured. */}
        {selection.misconfigured ? (
          <p className="flex items-start gap-1.5 rounded-md border border-amber-600/40 bg-amber-500/5 p-2.5 text-[11px] text-amber-800 dark:text-amber-400">
            <Warning className="mt-0.5 size-3.5 shrink-0" weight="duotone" />
            <span>{selection.sentence}</span>
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">{selection.sentence}</p>
        )}

        <p className="text-[11px] leading-relaxed text-foreground">{evidence.sentence}</p>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-md border border-border bg-muted/25 p-2.5">
            <p className="font-mono text-lg text-foreground">{rate === null ? '—' : `${rate}%`}</p>
            <p className="text-[11px] text-muted-foreground">
              {rate === null ? 'Nothing read back yet' : 'of reads were answered from cache'}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 p-2.5">
            <p className="font-mono text-lg text-foreground">{fallback === null ? '—' : `${fallback}%`}</p>
            <p className="text-[11px] text-muted-foreground">
              {fallback === null
                ? 'No reads served yet'
                : 'of answered reads came from this process, not the shared store'}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 p-2.5">
            <p className="font-mono text-lg text-foreground">
              {counters.sharedWrites + counters.fallbackWrites}
            </p>
            <p className="text-[11px] text-muted-foreground">answers stored since this process started</p>
          </div>
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {tallies(counters).map((t) => (
            <div
              key={t.label}
              className="flex items-baseline justify-between gap-2 rounded-md border border-border/60 px-2.5 py-2"
            >
              <span className="text-[11px] text-muted-foreground">
                {t.label}
                <span className="block text-[10px] text-muted-foreground/70">{t.hint}</span>
              </span>
              <span className="shrink-0 font-mono text-sm text-foreground">{t.value}</span>
            </div>
          ))}
        </div>

        {/* Scope, stated rather than implied. These are one process's tallies — and when the state is
            DEGRADED that is not a footnote about the numbers, it IS the finding. */}
        <p className="flex items-start gap-1.5 border-t border-border pt-2 text-[11px] text-muted-foreground/80">
          <Info className="mt-0.5 size-3 shrink-0" />
          <span>
            Counted by this console process since it last restarted. Work that runs in the background
            workers is tallied separately there, so these are not platform-wide totals — and if the shared
            cache is doing its job, that is the only thing about this cache that stays per-process.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
