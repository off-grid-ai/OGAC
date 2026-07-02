'use client';

import { Prohibit, ShieldCheck, Gauge, GlobeSimple } from '@phosphor-icons/react/dist/ssr';
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

interface EdgeEvent {
  ts: string;
  status: number;
  kind: 'waf' | 'rate-limit';
  ip: string;
  host: string;
  method: string;
  uri: string;
}
interface Snapshot {
  configured: boolean;
  policy: {
    rateLimit: { events: number; window: string; zone: string } | null;
    wafEnabled: boolean;
    wafRules: string[];
    hosts: string[];
  };
  summary: { total: number; waf: number; rateLimited: number; uniqueIps: number };
  recent: EdgeEvent[];
}

function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof ShieldCheck }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-1">
        <Icon className="size-4 text-primary" />
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold text-foreground">{value}</CardContent>
    </Card>
  );
}

// eslint-disable-next-line complexity
export function EdgePanel() {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/v1/edge', { cache: 'no-store' });
        if (r.ok && alive) setSnap(await r.json());
      } catch { /* keep last */ }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const p = snap?.policy;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Gateway</h1>
        <p className="text-sm text-muted-foreground">
          The network gateway — the public HTTP edge (reverse proxy, WAF, rate limiting) where the internet meets your fleet. Distinct from the AI Gateway, which routes LLM traffic.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Blocks (recent)" value={snap?.summary.total ?? '—'} icon={Prohibit} />
        <Stat label="WAF blocks" value={snap?.summary.waf ?? '—'} icon={ShieldCheck} />
        <Stat label="Rate-limited" value={snap?.summary.rateLimited ?? '—'} icon={Gauge} />
        <Stat label="Unique IPs" value={snap?.summary.uniqueIps ?? '—'} icon={GlobeSimple} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Gauge className="size-4 text-primary" /> Rate limit
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {p?.rateLimit ? (
              <p>
                <span className="font-mono text-foreground">{p.rateLimit.events}</span> requests /{' '}
                <span className="font-mono text-foreground">{p.rateLimit.window}</span> per client IP
                <span className="text-muted-foreground"> · zone {p.rateLimit.zone}</span>
              </p>
            ) : (
              <p className="text-muted-foreground">No rate limit configured.</p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-primary" /> WAF{' '}
              <Badge variant={p?.wafEnabled ? 'default' : 'outline'} className="text-[10px]">
                {p?.wafEnabled ? 'on' : 'off'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1">
            {p?.wafRules.length
              ? p.wafRules.map((r) => (
                  <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                ))
              : <span className="text-sm text-muted-foreground">No rules.</span>}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent blocks</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {snap && snap.recent.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No blocked requests. The edge is quiet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Client IP</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Request</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(snap?.recent ?? []).slice(0, 100).map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {e.ts ? new Date(e.ts).toLocaleTimeString() : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={e.kind === 'waf' ? 'destructive' : 'outline'} className="text-[10px]">
                          {e.kind === 'waf' ? `WAF ${e.status}` : `429`}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.ip}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{e.host}</TableCell>
                      <TableCell className="max-w-[24rem] truncate font-mono text-xs text-muted-foreground">
                        {e.method} {e.uri}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
