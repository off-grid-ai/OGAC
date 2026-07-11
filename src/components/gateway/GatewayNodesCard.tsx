'use client';

import { ArrowClockwise } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { toDisplayHost } from '@/lib/display-host';

interface Node {
  name: string;
  host: string;
  model: string;
  vision?: boolean;
  health?: string;
}

const REFRESH_MS = 5000;

export function GatewayNodesCard({ initial }: Readonly<{ initial: Node[] }>) {
  const [nodes, setNodes] = useState<Node[]>(initial);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/v1/gateway/nodes', { cache: 'no-store' });
      if (r.ok) {
        const d = (await r.json()) as { nodes?: Node[] };
        if (d.nodes) setNodes(d.nodes);
        setUpdatedAt(new Date());
      }
    } catch {
      /* keep last-known */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (!nodes.length) return null;
  const up = nodes.filter((g) => g.health === 'up').length;

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Nodes</CardTitle>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">
            {up}/{nodes.length} up
            {updatedAt && <span className="ml-2 opacity-60">· {updatedAt.toLocaleTimeString()}</span>}
          </span>
          <button
            onClick={() => void refresh()}
            title="Refresh now"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {loading ? <Spinner className="size-4" /> : <ArrowClockwise className="size-4" />}
          </button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {nodes.map((g) => {
          const isUp = g.health === 'up';
          const degraded = g.health === 'degraded';
          let dotCls = 'bg-red-500';
          if (isUp) dotCls = 'bg-emerald-500';
          else if (degraded) dotCls = 'bg-amber-500';
          let textCls = 'text-red-500';
          if (isUp) textCls = 'text-primary';
          else if (degraded) textCls = 'text-amber-600';
          return (
            <div key={g.name} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-foreground">{g.name}</span>
                  {g.vision ? <Badge variant="secondary" className="px-1 py-0 text-[10px]">vision</Badge> : null}
                </div>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{g.model} · {toDisplayHost(g.host)}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-xs">
                <span className={`size-2 rounded-full ${dotCls}`} />
                <span className={textCls}>{g.health ?? 'unknown'}</span>
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
