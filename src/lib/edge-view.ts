// ─── Edge (network gateway) view helpers — PURE, zero-IO ──────────────────────────────────────────
//
// Small presentation rules for the Services → Gateway (Caddy edge) panel, isolated from the React
// component so they're unit-testable. No imports, no I/O.

// The kind-filter facets the edge "Recent blocks" toolbar can offer. 'all' is always available; the
// 'waf' / 'rate-limit' facets are event-kinds emitted by the edge.
export type KindFilter = 'all' | 'waf' | 'rate-limit';
export type EdgeSortField = 'ts' | 'count' | 'ip' | 'host';
export type EdgeSortDirection = 'asc' | 'desc';

export interface EdgeViewEvent {
  ts: string;
  status: number;
  kind: 'waf' | 'rate-limit';
  ip: string;
  host: string;
  method: string;
  uri: string;
}

export interface GroupedEdgeEvent extends EdgeViewEvent {
  key: string;
  count: number;
}

/**
 * Which kind-filter chips to render, driven by the ACTUAL events present. Always includes 'all';
 * includes 'waf' only when ≥1 waf event exists and 'rate-limit' only when ≥1 rate-limit event
 * exists. This keeps the toolbar honest — a "429" (rate-limit) chip must not appear when the edge is
 * quiet (0 events), which would contradict the "0 blocks / 0 requests" stat band.
 *
 * Order is stable: all, waf, rate-limit.
 */
export function availableKindFilters(
  events: readonly { kind: 'waf' | 'rate-limit' }[],
): KindFilter[] {
  const hasWaf = events.some((e) => e.kind === 'waf');
  const hasRateLimit = events.some((e) => e.kind === 'rate-limit');
  const kinds: KindFilter[] = ['all'];
  if (hasWaf) kinds.push('waf');
  if (hasRateLimit) kinds.push('rate-limit');
  return kinds;
}

export function normalizeKindFilter(value: string | null | undefined): KindFilter {
  return value === 'waf' || value === 'rate-limit' ? value : 'all';
}

export function normalizeEdgeSortField(value: string | null | undefined): EdgeSortField {
  return value === 'count' || value === 'ip' || value === 'host' ? value : 'ts';
}

export function normalizeEdgeSortDirection(value: string | null | undefined): EdgeSortDirection {
  return value === 'asc' ? 'asc' : 'desc';
}

export function groupEdgeEvents(events: readonly EdgeViewEvent[]): GroupedEdgeEvent[] {
  const grouped = new Map<string, GroupedEdgeEvent>();
  for (const event of events) {
    const bucket = Math.floor(new Date(event.ts).getTime() / 10_000);
    const key = `${bucket}|${event.kind}|${event.ip}|${event.host}|${event.method}|${event.uri}`;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else grouped.set(key, { key, ...event, count: 1 });
  }
  return [...grouped.values()];
}

export function filterAndSortEdgeEvents(
  events: readonly GroupedEdgeEvent[],
  options: Readonly<{
    kind: KindFilter;
    query: string;
    sort: EdgeSortField;
    direction: EdgeSortDirection;
  }>,
): GroupedEdgeEvent[] {
  const query = options.query.trim().toLowerCase();
  const filtered = events.filter((event) => {
    if (options.kind !== 'all' && event.kind !== options.kind) return false;
    if (!query) return true;
    return [event.ip, event.host, event.uri, event.method].some((value) =>
      value.toLowerCase().includes(query),
    );
  });

  return filtered.sort((a, b) => {
    let comparison = 0;
    if (options.sort === 'ts') {
      comparison = new Date(a.ts).getTime() - new Date(b.ts).getTime();
    } else if (options.sort === 'count') comparison = a.count - b.count;
    else comparison = a[options.sort].localeCompare(b[options.sort]);
    return options.direction === 'asc' ? comparison : -comparison;
  });
}
