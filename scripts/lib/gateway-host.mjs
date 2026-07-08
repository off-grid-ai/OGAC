// PURE per-tenant gateway HOST resolver (PA-15) — dependency-free ESM mirror of the canonical
// `gatewayFromHost` in src/lib/route-access.ts, so the aggregator (a plain .mjs Node process that
// cannot import the TS console modules) can attribute an inbound request to a tenant gateway.
//
// A per-tenant PROVISIONED gateway host is "<slug5><rand5>-gateway.<apex>" (see tenantGatewayHost in
// src/lib/tenant-domain.ts): a 10-char label = 5 chars of the tenant slug + a 5-char unguessable
// random suffix, then the fixed "-gateway" group. The shared gateway ("gateway.<apex>") and any
// non-matching host return null — only a provisioned per-tenant host matches.
//
// DRY NOTE: the regex + shape are duplicated from route-access.ts (TS) intentionally — the aggregator
// runtime can't import TS. Both are covered by tests; keep them in lock-step if the host shape ever
// changes. The single SOURCE OF TRUTH for the host SHAPE is tenantGatewayHost (tenant-domain.ts).
const GATEWAY_HOST_RE = /^([a-z0-9]{5})([a-z0-9]{5})-gateway\./;

export function gatewayFromHost(host) {
  if (!host) return null;
  const m = GATEWAY_HOST_RE.exec(String(host).toLowerCase());
  if (!m) return null;
  return { label: m[1] + m[2], slugPrefix: m[1], randSuffix: m[2] };
}
