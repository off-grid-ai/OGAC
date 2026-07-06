'use client';

import { Lightning } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Stats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

// Response-cache stats (GET /admin/cache) — size, hit rate, hits vs misses. The cache cuts cost +
// latency on repeated/near-duplicate prompts before they reach a model.
export function CachePanel() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch('/api/v1/admin/cache')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const cells = [
    { label: 'Entries', value: stats ? stats.size.toLocaleString() : '—' },
    { label: 'Hit rate', value: stats ? `${stats.hitRate}%` : '—' },
    { label: 'Hits', value: stats ? stats.hits.toLocaleString() : '—' },
    { label: 'Misses', value: stats ? stats.misses.toLocaleString() : '—' },
  ];

  return (
    <Card className="h-full shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lightning className="size-4 text-primary" />
          Response cache
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Exact + semantic cache in front of the gateway. Higher hit rate → lower cost and latency.
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {c.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {c.value}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
