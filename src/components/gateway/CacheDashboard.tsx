'use client';

import { HardDrives } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { parseRange, SPEND_RANGES, type SpendRange } from '@/lib/litellm-spend';
import type { CacheStatus } from '@/lib/litellm-cache';
import { CacheActions } from './CacheActions';
import { CacheStatsPanel, type CacheStatsPayload } from './CacheStatsPanel';
import { CacheStatusPanel } from './CacheStatusPanel';

// Gateway response-cache control + observability. Status + flush levers are always shown; the
// effectiveness panel is windowed (?range=24h|7d|30d, URL-driven so it's Back-coherent + shareable).
// A cost/latency lever on the gateway — honest about what the deployed LiteLLM actually supports.

const RANGE_LABEL: Record<SpendRange, string> = {
  '24h': 'Last 24h',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

export function CacheDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const range = parseRange(searchParams.get('range'));

  const [status, setStatus] = useState<CacheStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [stats, setStats] = useState<CacheStatsPayload | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set(key, value);
      router.push(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch('/api/v1/admin/gateway/cache', { cache: 'no-store' });
      setStatus((await res.json()) as CacheStatus);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadStats = useCallback(async (r: SpendRange) => {
    setStatsLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/gateway/cache/stats?range=${r}`, { cache: 'no-store' });
      setStats((await res.json()) as CacheStatsPayload);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadStats(range);
  }, [loadStats, range]);

  const refresh = useCallback(() => {
    void loadStatus();
    void loadStats(range);
  }, [loadStatus, loadStats, range]);

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-mono text-lg font-semibold tracking-tight">
            <HardDrives weight="duotone" className="size-5 text-primary" />
            Response cache
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The gateway can serve repeat completions straight from a response cache — cutting latency and
            cost. Watch how well it&apos;s working and flush it when you need a clean slate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            options={SPEND_RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
            active={range}
            onSelect={(v) => setParam('range', v)}
          />
          <Button variant="outline" size="sm" onClick={refresh} disabled={statusLoading || statsLoading}>
            Refresh
          </Button>
        </div>
      </header>

      <CacheStatsPanel payload={stats} loading={statsLoading} />

      <div className="grid gap-6 lg:grid-cols-2">
        <CacheStatusPanel status={status} loading={statusLoading} />
        <CacheActions status={status} onFlushed={refresh} />
      </div>
    </div>
  );
}

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
