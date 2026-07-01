'use client';

import { Pulse } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
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

interface Stat {
  gateway: string;
  model: string;
  requests: number;
  errors: number;
  avgMs: number;
  tokens: number;
}
interface Call {
  ts: number;
  gateway: string;
  model: string;
  kind: string;
  status: number;
  ms: number;
  tokens: number;
  bytes: number;
}
interface Traffic {
  available: boolean;
  since?: string;
  stats?: Stat[];
  recent?: Call[];
}

const time = (ts: number) => new Date(ts).toLocaleTimeString();

// Live gateway traffic — polls the aggregator feed (via /api/v1/gateway/traffic) every 3s and
// shows per-gateway counters plus the most recent calls: which node served each request, its
// latency, tokens, and status. Hidden entirely when the gateway has no traffic feed.
export function GatewayTraffic() {
  const [data, setData] = useState<Traffic | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/v1/gateway/traffic', { cache: 'no-store' });
        const d = (await r.json()) as Traffic;
        if (alive) setData(d);
      } catch {
        /* keep last snapshot */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!data?.available) return null;
  const stats = data.stats ?? [];
  const recent = data.recent ?? [];

  return (
    <>
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm">Traffic by gateway</CardTitle>
          <span className="flex items-center gap-1.5 text-xs text-primary">
            <Pulse className="size-3.5 animate-pulse" />
            live
          </span>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {stats.map((s) => (
            <div key={s.gateway} className="rounded-md border border-border px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-primary">{s.gateway}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{s.model}</span>
              </div>
              <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <dt>requests</dt>
                  <dd className="text-foreground">{s.requests}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>errors</dt>
                  <dd className={s.errors ? 'text-destructive' : 'text-foreground'}>{s.errors}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>avg latency</dt>
                  <dd className="text-foreground">{s.avgMs} ms</dd>
                </div>
                <div className="flex justify-between">
                  <dt>tokens</dt>
                  <dd className="text-foreground">{s.tokens}</dd>
                </div>
              </dl>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Recent calls</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Gateway</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.length ? (
                recent.map((c, i) => (
                  <TableRow key={`${c.ts}-${i}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {time(c.ts)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="bg-primary/10 font-mono text-primary">
                        {c.gateway}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.model}</TableCell>
                    <TableCell className="text-xs">{c.kind}</TableCell>
                    <TableCell
                      className={`font-mono text-xs ${
                        !c.status || c.status >= 400 ? 'text-destructive' : 'text-foreground'
                      }`}
                    >
                      {c.status}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{c.ms} ms</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {c.tokens || '—'}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                    No traffic yet — calls made through the gateway will appear here.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
