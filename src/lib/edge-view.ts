// ─── Edge (network gateway) view helpers — PURE, zero-IO ──────────────────────────────────────────
//
// Small presentation rules for the Services → Gateway (Caddy edge) panel, isolated from the React
// component so they're unit-testable. No imports, no I/O.

// The kind-filter facets the edge "Recent blocks" toolbar can offer. 'all' is always available; the
// 'waf' / 'rate-limit' facets are event-kinds emitted by the edge.
export type KindFilter = 'all' | 'waf' | 'rate-limit';

/**
 * Which kind-filter chips to render, driven by the ACTUAL events present. Always includes 'all';
 * includes 'waf' only when ≥1 waf event exists and 'rate-limit' only when ≥1 rate-limit event
 * exists. This keeps the toolbar honest — a "429" (rate-limit) chip must not appear when the edge is
 * quiet (0 events), which would contradict the "0 blocks / 0 requests" stat band.
 *
 * Order is stable: all, waf, rate-limit.
 */
export function availableKindFilters(events: readonly { kind: 'waf' | 'rate-limit' }[]): KindFilter[] {
  const hasWaf = events.some((e) => e.kind === 'waf');
  const hasRateLimit = events.some((e) => e.kind === 'rate-limit');
  const kinds: KindFilter[] = ['all'];
  if (hasWaf) kinds.push('waf');
  if (hasRateLimit) kinds.push('rate-limit');
  return kinds;
}
