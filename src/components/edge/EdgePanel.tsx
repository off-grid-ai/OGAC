'use client';

import {
  ArrowDown,
  ArrowUp,
  ArrowsDownUp,
  Funnel,
  Gauge,
  GlobeSimple,
  MagnifyingGlass,
  Prohibit,
  ShieldCheck,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { useEffect, useMemo, useState } from 'react';
import { WafControls } from '@/components/edge/WafControls';
import { type KindFilter, availableKindFilters } from '@/lib/edge-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
interface TrafficRow {
  ts: string;
  status: number;
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
  traffic?: { total: number; allowed: number; blocked: number; recent: TrafficRow[] };
}

// Group identical (ip, host, method, uri, kind) within a 10-second bucket
interface GroupedEvent {
  key: string;
  ts: string;
  status: number;
  kind: 'waf' | 'rate-limit';
  ip: string;
  host: string;
  method: string;
  uri: string;
  count: number;
}

function groupEvents(events: EdgeEvent[]): GroupedEvent[] {
  const map = new Map<string, GroupedEvent>();
  for (const e of events) {
    // bucket by 10-second windows
    const bucket = Math.floor(new Date(e.ts).getTime() / 10_000);
    const key = `${bucket}|${e.kind}|${e.ip}|${e.host}|${e.method}|${e.uri}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, { key, ...e, count: 1 });
    }
  }
  return [...map.values()];
}

type SortField = 'ts' | 'count' | 'ip' | 'host';
type SortDir = 'asc' | 'desc';

// Sort-direction indicator for a column header. Lifted to module scope (was defined inside EdgePanel)
// so it isn't re-created each render; the sort state it needs is passed as props. Render-identical:
// inactive → faint up/down glyph, active → emerald arrow matching the current direction.
function SortIcon({
  field,
  sortField,
  sortDir,
}: Readonly<{ field: SortField; sortField: SortField; sortDir: SortDir }>) {
  if (sortField !== field) return <ArrowsDownUp className="size-3 opacity-30" />;
  return sortDir === 'desc' ? (
    <ArrowDown className="size-3 text-primary" />
  ) : (
    <ArrowUp className="size-3 text-primary" />
  );
}

const KIND_LABELS: Record<KindFilter, string> = { all: 'All', waf: 'WAF', 'rate-limit': '429' };

// Repeat-count badge severity: ≥50 hits is loud (destructive), ≥10 notable (outline), else muted.
function countBadgeVariant(count: number): 'destructive' | 'outline' | 'secondary' {
  if (count >= 50) return 'destructive';
  if (count >= 10) return 'outline';
  return 'secondary';
}

export function EdgePanel() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [sortField, setSortField] = useState<SortField>('ts');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/v1/edge', { cache: 'no-store' });
        if (r.ok && alive) setSnap(await r.json());
      } catch {
        /* keep last */
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const p = snap?.policy;

  const grouped = useMemo(() => groupEvents(snap?.recent ?? []), [snap]);

  // Which kind-filter chips to offer — driven by the ACTUAL events, so a "429"/WAF chip never shows
  // when the edge is quiet (0 events), which would contradict the "0 blocks / 0 requests" stat band.
  const kinds = useMemo(() => availableKindFilters(grouped), [grouped]);

  // If the selected filter is no longer available (e.g. 429 was picked, then a refresh emptied the
  // rate-limit events), fall back to 'all' so the filtered view stays coherent.
  useEffect(() => {
    if (!kinds.includes(kindFilter)) setKindFilter('all');
  }, [kinds, kindFilter]);

  const filtered = useMemo(() => {
    let rows = grouped;
    if (kindFilter !== 'all') rows = rows.filter((e) => e.kind === kindFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (e) =>
          e.ip.includes(q) ||
          e.host.toLowerCase().includes(q) ||
          e.uri.toLowerCase().includes(q) ||
          e.method.toLowerCase().includes(q),
      );
    }
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'ts') cmp = new Date(a.ts).getTime() - new Date(b.ts).getTime();
      else if (sortField === 'count') cmp = a.count - b.count;
      else if (sortField === 'ip') cmp = a.ip.localeCompare(b.ip);
      else if (sortField === 'host') cmp = a.host.localeCompare(b.host);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [grouped, kindFilter, search, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const totalBlocked = snap?.summary.total ?? 0;
  const uniqueIps = snap?.summary.uniqueIps ?? 0;
  const wafBlocks = snap?.summary.waf ?? 0;
  const rateLimited = snap?.summary.rateLimited ?? 0;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div>
        <h1 className="text-lg font-semibold text-foreground">Gateway</h1>
        <p className="text-sm text-muted-foreground">
          The network gateway — the public HTTP edge (reverse proxy, WAF, rate limiting) where the
          internet meets your fleet. Distinct from the AI Gateway, which routes LLM traffic.
        </p>
      </div>

      {/* ── Unified status bar ── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
        {/* Stats inline */}
        <div className="flex items-center gap-1.5">
          <Prohibit className="size-3.5 text-destructive" />
          <span className="font-semibold text-foreground">{totalBlocked}</span>
          <span className="text-muted-foreground">blocks</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-primary" />
          <span className="font-semibold text-foreground">{wafBlocks}</span>
          <span className="text-muted-foreground">WAF</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Gauge className="size-3.5 text-amber-500" />
          <span className="font-semibold text-foreground">{rateLimited}</span>
          <span className="text-muted-foreground">rate-limited</span>
        </div>
        <div className="flex items-center gap-1.5">
          <GlobeSimple className="size-3.5 text-muted-foreground" />
          <span className="font-semibold text-foreground">{uniqueIps}</span>
          <span className="text-muted-foreground">unique IPs</span>
        </div>
        {snap?.traffic ? (
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-foreground">{snap.traffic.total}</span>
            <span className="text-muted-foreground">requests</span>
            <span className="text-emerald-600 dark:text-emerald-400">
              · {snap.traffic.allowed} allowed
            </span>
          </div>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {/* Rate limit policy */}
          {p?.rateLimit && (
            <span className="flex items-center gap-1">
              <Gauge className="size-3" />
              <span className="font-mono text-foreground">{p.rateLimit.events}</span>
              {' req / '}
              <span className="font-mono text-foreground">{p.rateLimit.window}</span>
              {' · '}zone {p.rateLimit.zone}
            </span>
          )}
          {/* WAF status */}
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3" />
            WAF
            <Badge
              variant={p?.wafEnabled ? 'default' : 'outline'}
              className="text-[10px] px-1 py-0"
            >
              {p?.wafEnabled ? 'on' : 'off'}
            </Badge>
            {p?.wafRules.map((r) => (
              <Badge key={r} variant="secondary" className="text-[10px] px-1 py-0">
                {r}
              </Badge>
            ))}
          </span>
        </div>
      </div>

      {/* ── WAF control (toggle + rule CRUD) ── */}
      <WafControls liveWafEnabled={p?.wafEnabled ?? false} liveRuleNames={p?.wafRules ?? []} />

      {/* ── Blocks table ── */}
      <div className="rounded-lg border border-border bg-card shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="mr-1 text-sm font-medium text-foreground">Recent blocks</span>

          {/* Kind filter */}
          <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5">
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  kindFilter === k
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter by IP, host, path…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 pl-7 text-xs"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          {/* Filter pill */}
          {(kindFilter !== 'all' || search) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => {
                setKindFilter('all');
                setSearch('');
              }}
            >
              <Funnel className="size-3" /> Clear
            </Button>
          )}

          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {filtered.length} group{filtered.length !== 1 ? 's' : ''}
            {grouped.length !== (snap?.recent ?? []).length && (
              <span> · {(snap?.recent ?? []).length} raw</span>
            )}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {!snap ? (
            <p className="py-12 text-center text-xs text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            grouped.length === 0 && snap.traffic?.recent.length ? (
              <div>
                <p className="px-4 py-2 text-xs text-muted-foreground">
                  No blocked requests — the edge is quiet. Showing recent allowed traffic:
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Client IP</TableHead>
                      <TableHead>Host</TableHead>
                      <TableHead>Request</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snap.traffic.recent.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {e.ts ? new Date(e.ts).toLocaleTimeString() : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={e.status >= 400 ? 'destructive' : 'secondary'}
                            className="text-[10px]"
                          >
                            {e.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{e.ip}</TableCell>
                        <TableCell className="max-w-[14rem] truncate font-mono text-xs text-muted-foreground">
                          {e.host}
                        </TableCell>
                        <TableCell className="max-w-[20rem] truncate font-mono text-xs text-muted-foreground">
                          {e.method} {e.uri}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="py-12 text-center text-xs text-muted-foreground">
                {grouped.length === 0
                  ? 'No requests logged yet. The edge is quiet.'
                  : 'No results match your filter.'}
              </p>
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer select-none whitespace-nowrap"
                    onClick={() => toggleSort('ts')}
                  >
                    <span className="flex items-center gap-1">
                      When <SortIcon field="ts" sortField={sortField} sortDir={sortDir} />
                    </span>
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort('ip')}
                  >
                    <span className="flex items-center gap-1">
                      Client IP <SortIcon field="ip" sortField={sortField} sortDir={sortDir} />
                    </span>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort('host')}
                  >
                    <span className="flex items-center gap-1">
                      Host <SortIcon field="host" sortField={sortField} sortDir={sortDir} />
                    </span>
                  </TableHead>
                  <TableHead>Request</TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort('count')}
                  >
                    <span className="flex items-center justify-end gap-1">
                      Count <SortIcon field="count" sortField={sortField} sortDir={sortDir} />
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.key} className={e.count >= 10 ? 'bg-destructive/5' : undefined}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {e.ts ? new Date(e.ts).toLocaleTimeString() : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={e.kind === 'waf' ? 'destructive' : 'outline'}
                        className="text-[10px]"
                      >
                        {e.kind === 'waf' ? `WAF ${e.status}` : '429'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.ip}</TableCell>
                    <TableCell className="max-w-[14rem] truncate font-mono text-xs text-muted-foreground">
                      {e.host}
                    </TableCell>
                    <TableCell className="max-w-[20rem] truncate font-mono text-xs text-muted-foreground">
                      {e.method} {e.uri}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.count > 1 ? (
                        <Badge
                          variant={countBadgeVariant(e.count)}
                          className="text-[10px] font-mono"
                        >
                          ×{e.count}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">1</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
