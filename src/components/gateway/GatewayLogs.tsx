'use client';

import { CaretDown, CaretUp, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { CallDetail, type Call } from '@/components/gateway/GatewayTraffic';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface LogsResponse {
  available: boolean;
  total: number;
  size: number;
  from: number;
  hits: Call[];
}

type SortKey = 'ts' | 'ms' | 'tokens';
type SortDir = 'asc' | 'desc';

const time = (ts: number) => new Date(ts).toLocaleTimeString();

const RANGE_OPTIONS: { label: string; ms: number }[] = [
  { label: '15m', ms: 900000 },
  { label: '1h', ms: 3600000 },
  { label: '24h', ms: 86400000 },
  { label: 'all', ms: 0 },
];

const selectCls =
  'h-9 rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';

// Gateway LOGS explorer — searchable/filterable history over the durable OpenSearch sink
// (/api/v1/gateway/logs). Mirrors the live-tail table but adds full-text search, structured
// filters, smart presets (slow / tool calls), client-side sort, and paging. Degrades to an
// "unavailable" state when OpenSearch is offline (available:false).
// eslint-disable-next-line complexity
export function GatewayLogs() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [gateway, setGateway] = useState('');
  const [model, setModel] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [rangeMs, setRangeMs] = useState(900000);
  const [slow, setSlow] = useState(false);
  const [tools, setTools] = useState(false);
  const [from, setFrom] = useState(0);
  const size = 50;

  const [data, setData] = useState<LogsResponse | null>(null);
  const [hits, setHits] = useState<Call[]>([]);
  const [loading, setLoading] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('ts');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Debounce the search box (~400ms) so keystrokes don't hammer the endpoint.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 400);
    return () => clearTimeout(id);
  }, [q]);

  // Any filter change resets paging back to page 0.
  useEffect(() => {
    setFrom(0);
  }, [debouncedQ, gateway, model, kind, status, rangeMs, slow, tools]);

  // eslint-disable-next-line complexity
  const params = useMemo(() => {
    const sp = new URLSearchParams();
    if (debouncedQ) sp.set('q', debouncedQ);
    if (gateway) sp.set('gateway', gateway);
    if (model) sp.set('model', model);
    if (kind) sp.set('kind', kind);
    if (status) sp.set('status', status);
    if (rangeMs) sp.set('sinceMs', String(rangeMs));
    if (slow) sp.set('slowMs', '10000');
    if (tools) sp.set('tools', '1');
    sp.set('size', String(size));
    sp.set('from', String(from));
    return sp.toString();
  }, [debouncedQ, gateway, model, kind, status, rangeMs, slow, tools, from]);

  const firstLoad = useRef(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/v1/gateway/logs?${params}`, { cache: 'no-store' });
        const d = (await r.json()) as LogsResponse;
        if (!alive) return;
        setData(d);
        // Append when paging (from > 0), replace on a fresh filter set.
        setHits((prev) => (d.from > 0 ? [...prev, ...(d.hits ?? [])] : d.hits ?? []));
      } catch {
        if (alive) setData({ available: false, total: 0, size, from: 0, hits: [] });
      } finally {
        if (alive) setLoading(false);
        firstLoad.current = false;
      }
    })();
    return () => {
      alive = false;
    };
  }, [params]);

  const sorted = useMemo(() => {
    const arr = [...hits];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [hits, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (
      sortDir === 'asc' ? (
        <CaretUp className="inline size-3" />
      ) : (
        <CaretDown className="inline size-3" />
      )
    ) : null;

  const available = data?.available !== false;
  const total = data?.total ?? 0;
  const hasMore = hits.length < total;

  return (
    <Card className="shadow-sm">
      <CardHeader className="space-y-3">
        <CardTitle className="text-sm">Logs</CardTitle>
        <div className="relative">
          <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search prompts, completions, callers…"
            className="pl-8 font-mono text-xs"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={gateway}
            onChange={(e) => setGateway(e.target.value)}
            placeholder="gateway"
            className="h-9 w-28 font-mono text-xs"
          />
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model"
            className="h-9 w-32 font-mono text-xs"
          />
          <select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">any kind</option>
            <option value="text">text</option>
            <option value="image">image</option>
            <option value="embedding">embedding</option>
          </select>
          <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">any status</option>
            <option value="2xx">2xx</option>
            <option value="4xx">4xx</option>
            <option value="5xx">5xx</option>
          </select>
          <select
            className={selectCls}
            value={String(rangeMs)}
            onChange={(e) => setRangeMs(Number(e.target.value))}
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.label} value={String(o.ms)}>
                {o.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant={slow ? 'default' : 'outline'}
            onClick={() => setSlow((v) => !v)}
          >
            Slow (&gt;10s)
          </Button>
          <Button
            size="sm"
            variant={tools ? 'default' : 'outline'}
            onClick={() => setTools((v) => !v)}
          >
            Tool calls
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!available ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Logs unavailable — the OpenSearch history sink is offline.
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {total} match{total === 1 ? '' : 'es'}
                {loading ? ' · loading…' : ''}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('ts')}>
                    Time {sortIcon('ts')}
                  </TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">TTFB</TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort('ms')}
                  >
                    Latency {sortIcon('ms')}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort('tokens')}
                  >
                    Tokens {sortIcon('tokens')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.length ? (
                  sorted.map((c, i) => {
                    const key = `${c.ts}-${c.gateway}-${i}`;
                    const open = openKey === key;
                    return (
                      <Fragment key={key}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setOpenKey(open ? null : key)}
                          title="Click to see prompt + completion"
                        >
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {open ? '▾ ' : '▸ '}
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
                          <TableCell className="text-right font-mono text-xs">
                            {c.ttfb != null ? `${c.ttfb} ms` : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">{c.ms} ms</TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {c.tokens || '—'}
                          </TableCell>
                        </TableRow>
                        {open ? (
                          <TableRow>
                            <TableCell colSpan={8} className="bg-muted/40">
                              <CallDetail c={c} />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                      {loading ? 'Searching…' : 'No results — adjust filters or widen the time range.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {hasMore ? (
              <div className="mt-3 flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading}
                  onClick={() => setFrom((f) => f + size)}
                >
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
