// ─── ETL / replication CONNECTION ownership — PURE (zero I/O, unit-testable) ───────────────────────
//
// WHY THIS EXISTS. `/data/flows/replication` rendered pixel-identical content on both public demo
// tenants: a connection literally named "CoreBank to Off Grid Warehouse" appeared on the insurer's own
// screen (found live 2026-08-05, see docs/audit/2026-08-05-viewer/data.md). Root cause:
// `airbyteEtl.listConnections()` returns ONLY `connectionId / name / status / sourceId / destinationId
// / schedule` (see `summarizeConnection` in etl-model.ts) — Airbyte has no concept of the console's
// tenants, so there is NO org field anywhere in that shape, and the connection's `name` is an
// operator-chosen label, not a boundary (rule established by the first leak — see the
// AuditSearchParams.org comment in siem.ts).
//
// THE REAL BOUNDARY. Airbyte's connections carry no ownership marker, but the console's OWN
// connectors registry (`connectors`, already org-scoped — see listConnectors(orgId) in store.ts) is
// populated with the SAME backing systems a connection's SOURCE names. Verified live: org_bharat owns
// a connector (`bhcon_corebank`) whose endpoint is `postgres://corebank@127.0.0.1:5433/corebank`; the
// one real Airbyte connection's source config names database `corebank` on that same host. So a
// connection is owned by whichever org has ALREADY registered a connector against the same backing
// database — a real boundary, not the connection's display name. A connection whose source names no
// database, or whose database matches no org's registered connector, is UNATTRIBUTABLE and belongs to
// NOBODY — there is deliberately no "unmarked means shared" fallback (the same rule as
// langfuse-tenancy.ts / siem.ts: that fallback IS how one tenant sees another's data).

/** Sentinel: no scoping applied — every connection is visible. Mirrors ALL_DATABASES in
 * warehouse-tenancy.ts (the DEFAULT_ORG / single-tenant convention lives in the impure adapter, not
 * here — this module only understands "unscoped" vs. "scoped to this set of resource keys"). */
export const ALL_CONNECTIONS = null;

// Read a string property from an unknown value without trusting its shape — Airbyte's
// connectionConfiguration is free-form per source type (Postgres/MySQL/MSSQL carry `database`;
// REST/Kafka/S3 sources may carry none at all, which is the honest "unattributable" case).
function stringProp(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim().toLowerCase() : null;
}

/** The backing database a replication CONNECTION'S SOURCE reads from — from the raw Airbyte
 * `sources/get` response's `connectionConfiguration.database`. Null when the source carries no
 * database field (unattributable), never thrown on a malformed/unexpected shape. */
export function sourceDatabaseKey(sourceRaw: unknown): string | null {
  if (typeof sourceRaw !== 'object' || sourceRaw === null) return null;
  const cfg = (sourceRaw as Record<string, unknown>).connectionConfiguration;
  return stringProp(cfg, 'database');
}

/** The resource a console CONNECTOR targets, from its connection-string `endpoint` — the trailing
 * path segment (`postgres://corebank@127.0.0.1:5433/corebank` → `corebank`). Null for an endpoint
 * with no path (bare host:port, e.g. Kafka) or that doesn't parse as a URL at all. */
export function connectorResourceKey(endpoint: string | null | undefined): string | null {
  if (typeof endpoint !== 'string' || !endpoint.trim()) return null;
  try {
    const withScheme = endpoint.includes('://') ? endpoint : `resource://${endpoint}`;
    const path = new URL(withScheme).pathname.replace(/^\/+/, '').trim().toLowerCase();
    return path ? path : null;
  } catch {
    return null;
  }
}

/** The set of resource keys an org's OWN registered connectors target — the ownership scope a
 * connection's source database is checked against. */
export function ownedResourceKeys(connectorEndpoints: readonly (string | null | undefined)[]): Set<string> {
  const keys = new Set<string>();
  for (const endpoint of connectorEndpoints) {
    const key = connectorResourceKey(endpoint);
    if (key) keys.add(key);
  }
  return keys;
}

/** Does a connection whose source reads `sourceDb` belong to an org whose registered connectors
 * target `ownedKeys`? A null `sourceDb` (unattributable) is never owned — matches nobody, not "shared".
 */
export function isConnectionOwned(sourceDb: string | null, ownedKeys: ReadonlySet<string>): boolean {
  if (sourceDb === null) return false;
  return ownedKeys.has(sourceDb);
}

/** Keep only the connections owned by `scope` (a resolved org's resource-key set), or every
 * connection when `scope` is ALL_CONNECTIONS (the unscoped / platform-operator case, resolved by the
 * impure caller — see currentEtlConnections in etl-scope.ts). `sourceDatabaseOf` maps connectionId →
 * its source's database (from sourceDatabaseKey), pre-resolved by the caller so this stays pure. */
export function filterConnectionsForScope<T extends { connectionId: string }>(
  connections: readonly T[],
  sourceDatabaseOf: ReadonlyMap<string, string | null>,
  scope: ReadonlySet<string> | typeof ALL_CONNECTIONS,
): T[] {
  if (scope === ALL_CONNECTIONS) return [...connections];
  return connections.filter((c) => isConnectionOwned(sourceDatabaseOf.get(c.connectionId) ?? null, scope));
}
