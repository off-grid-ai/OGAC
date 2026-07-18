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
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { WafControls } from '@/components/edge/WafControls';
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
import type { EdgeSnapshot } from '@/lib/edge-log';
import {
  type EdgeSortDirection,
  type EdgeSortField,
  type GroupedEdgeEvent,
  type KindFilter,
  availableKindFilters,
  filterAndSortEdgeEvents,
  groupEdgeEvents,
  normalizeEdgeSortDirection,
  normalizeEdgeSortField,
  normalizeKindFilter,
} from '@/lib/edge-view';
import type { EdgeDestinationId } from '@/lib/operations-destinations';

const KIND_LABELS: Record<KindFilter, string> = { all: 'All', waf: 'WAF', 'rate-limit': '429' };

function countBadgeVariant(count: number): 'destructive' | 'outline' | 'secondary' {
  if (count >= 50) return 'destructive';
  if (count >= 10) return 'outline';
  return 'secondary';
}

function SortIcon({
  field,
  sortField,
  direction,
}: Readonly<{
  field: EdgeSortField;
  sortField: EdgeSortField;
  direction: EdgeSortDirection;
}>) {
  if (field !== sortField) return <ArrowsDownUp className="size-3 opacity-30" />;
  return direction === 'desc' ? (
    <ArrowDown className="size-3 text-primary" />
  ) : (
    <ArrowUp className="size-3 text-primary" />
  );
}

function useEdgeSnapshot() {
  const [snapshot, setSnapshot] = useState<EdgeSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch('/api/v1/edge', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (alive) {
          setSnapshot((await response.json()) as EdgeSnapshot);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return { snapshot, failed };
}

export function EdgePanel({ destination }: Readonly<{ destination: EdgeDestinationId }>) {
  const { snapshot, failed } = useEdgeSnapshot();

  if (!snapshot) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {failed
            ? 'Could not reach the edge status API. Retry after the edge is available.'
            : 'Loading edge status...'}
        </CardContent>
      </Card>
    );
  }

  if (destination === 'overview') return <OverviewDestination snapshot={snapshot} />;
  if (destination === 'waf') return <WafDestination snapshot={snapshot} />;
  if (destination === 'traffic') return <TrafficDestination snapshot={snapshot} />;
  return <BlockedRequestsDestination snapshot={snapshot} />;
}

function StatusBand({ snapshot }: Readonly<{ snapshot: EdgeSnapshot }>) {
  return (
    <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-5">
      <Status icon={GlobeSimple} value={snapshot.traffic.total} label="requests" />
      <Status icon={ShieldCheck} value={snapshot.traffic.allowed} label="allowed" />
      <Status icon={Prohibit} value={snapshot.summary.total} label="blocked" />
      <Status icon={ShieldCheck} value={snapshot.summary.waf} label="WAF blocks" />
      <Status icon={Gauge} value={snapshot.summary.rateLimited} label="rate-limited" />
    </div>
  );
}

function Status({
  icon: Icon,
  value,
  label,
}: Readonly<{
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
}>) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function OverviewDestination({ snapshot }: Readonly<{ snapshot: EdgeSnapshot }>) {
  const policy = snapshot.policy;
  return (
    <div className="space-y-4">
      <StatusBand snapshot={snapshot} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Protection posture</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">WAF</span>
              <Badge variant={policy.wafEnabled ? 'default' : 'outline'}>
                {policy.wafEnabled ? 'on' : 'off'}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Rate limit</span>
              <span className="font-mono text-xs text-foreground">
                {policy.rateLimit
                  ? `${policy.rateLimit.events} req / ${policy.rateLimit.window}`
                  : 'not configured'}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Rules</span>
              <span className="flex flex-wrap justify-end gap-1">
                {policy.wafRules.length ? (
                  policy.wafRules.map((rule) => (
                    <Badge key={rule} variant="secondary">
                      {rule}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">none</span>
                )}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Public hosts</CardTitle>
          </CardHeader>
          <CardContent>
            {policy.hosts.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {policy.hosts.map((host) => (
                  <code key={host} className="rounded-md border border-border px-3 py-2 text-xs">
                    {host}
                  </code>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No public hosts were found in the active Caddy configuration.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function WafDestination({ snapshot }: Readonly<{ snapshot: EdgeSnapshot }>) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
        <ShieldCheck className="size-4 text-primary" />
        <span>Live WAF</span>
        <Badge variant={snapshot.policy.wafEnabled ? 'default' : 'outline'}>
          {snapshot.policy.wafEnabled ? 'on' : 'off'}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {snapshot.policy.wafRules.length} active rule
          {snapshot.policy.wafRules.length === 1 ? '' : 's'}
        </span>
      </div>
      <WafControls
        liveWafEnabled={snapshot.policy.wafEnabled}
        liveRuleNames={snapshot.policy.wafRules}
      />
    </div>
  );
}

function TrafficDestination({ snapshot }: Readonly<{ snapshot: EdgeSnapshot }>) {
  return (
    <div className="space-y-4">
      <StatusBand snapshot={snapshot} />
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Recent requests</CardTitle>
          <p className="text-xs text-muted-foreground">
            The newest allowed and blocked requests in the edge access log.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <TrafficTable rows={snapshot.traffic.recent} />
        </CardContent>
      </Card>
    </div>
  );
}

function TrafficTable({ rows }: Readonly<{ rows: EdgeSnapshot['traffic']['recent'] }>) {
  if (!rows.length) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">No requests logged yet.</p>
    );
  }
  return (
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
        {rows.map((row, index) => (
          <TableRow key={`${row.ts}-${row.ip}-${index}`}>
            <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
              {row.ts ? new Date(row.ts).toLocaleTimeString() : '-'}
            </TableCell>
            <TableCell>
              <Badge variant={row.status >= 400 ? 'destructive' : 'secondary'}>{row.status}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs">{row.ip}</TableCell>
            <TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">
              {row.host}
            </TableCell>
            <TableCell className="max-w-80 truncate font-mono text-xs text-muted-foreground">
              {row.method} {row.uri}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BlockedRequestsDestination({ snapshot }: Readonly<{ snapshot: EdgeSnapshot }>) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const query = params.get('q') ?? '';
  const kind = normalizeKindFilter(params.get('kind'));
  const sort = normalizeEdgeSortField(params.get('sort'));
  const direction = normalizeEdgeSortDirection(params.get('direction'));
  const grouped = useMemo(() => groupEdgeEvents(snapshot.recent), [snapshot.recent]);
  const kinds = useMemo(() => availableKindFilters(grouped), [grouped]);
  const safeKind = kinds.includes(kind) ? kind : 'all';
  const rows = useMemo(
    () => filterAndSortEdgeEvents(grouped, { kind: safeKind, query, sort, direction }),
    [direction, grouped, query, safeKind, sort],
  );

  const href = (changes: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const suffix = next.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
  };

  const toggleSort = (field: EdgeSortField) => {
    const nextDirection = sort === field && direction === 'desc' ? 'asc' : 'desc';
    router.push(
      href({
        sort: field === 'ts' ? null : field,
        direction: nextDirection === 'desc' ? null : nextDirection,
      }),
      {
        scroll: false,
      },
    );
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-1 text-sm">Recent blocks</CardTitle>
          <nav
            className="flex items-center rounded-md border border-border bg-muted/40 p-0.5"
            aria-label="Blocked request type"
          >
            {kinds.map((candidate) => (
              <Link
                key={candidate}
                href={href({ kind: candidate === 'all' ? null : candidate })}
                scroll={false}
                aria-current={safeKind === candidate ? 'page' : undefined}
                className={
                  safeKind === candidate
                    ? 'rounded-sm bg-background px-2 py-1 text-xs font-medium text-foreground'
                    : 'rounded-sm px-2 py-1 text-xs text-muted-foreground hover:text-foreground'
                }
              >
                {KIND_LABELS[candidate]}
              </Link>
            ))}
          </nav>
          <form
            className="relative min-w-48 flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem('q') as HTMLInputElement | null;
              router.push(href({ q: input?.value.trim() || null }), { scroll: false });
            }}
          >
            <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Filter by IP, host, method, or path"
              className="h-8 pl-8 text-xs"
            />
          </form>
          {safeKind !== 'all' || query || sort !== 'ts' || direction !== 'desc' ? (
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1 text-xs">
              <Link href={pathname} scroll={false}>
                <Funnel className="size-3" /> Clear
              </Link>
            </Button>
          ) : null}
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {rows.length} group{rows.length === 1 ? '' : 's'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <BlockedTable rows={rows} sort={sort} direction={direction} onSort={toggleSort} />
      </CardContent>
    </Card>
  );
}

function BlockedTable({
  rows,
  sort,
  direction,
  onSort,
}: Readonly<{
  rows: GroupedEdgeEvent[];
  sort: EdgeSortField;
  direction: EdgeSortDirection;
  onSort: (field: EdgeSortField) => void;
}>) {
  if (!rows.length) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No blocked requests match these filters.
      </p>
    );
  }
  const SortHead = ({ field, children }: Readonly<{ field: EdgeSortField; children: string }>) => (
    <TableHead>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children} <SortIcon field={field} sortField={sort} direction={direction} />
      </button>
    </TableHead>
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHead field="ts">When</SortHead>
          <TableHead>Type</TableHead>
          <SortHead field="ip">Client IP</SortHead>
          <SortHead field="host">Host</SortHead>
          <TableHead>Request</TableHead>
          <SortHead field="count">Count</SortHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
              {row.ts ? new Date(row.ts).toLocaleTimeString() : '-'}
            </TableCell>
            <TableCell>
              <Badge variant={row.kind === 'waf' ? 'destructive' : 'outline'}>
                {row.kind === 'waf' ? `WAF ${row.status}` : '429'}
              </Badge>
            </TableCell>
            <TableCell className="font-mono text-xs">{row.ip}</TableCell>
            <TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">
              {row.host}
            </TableCell>
            <TableCell className="max-w-80 truncate font-mono text-xs text-muted-foreground">
              {row.method} {row.uri}
            </TableCell>
            <TableCell className="text-right">
              {row.count > 1 ? (
                <Badge variant={countBadgeVariant(row.count)} className="font-mono">
                  x{row.count}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">1</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
