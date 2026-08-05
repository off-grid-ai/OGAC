// Impure ADAPTER that resolves the current request's scope over Airbyte replication connections,
// then feeds it into the pure ownership rules in etl-tenancy.ts (zero-IO, unit-tested). SoC: the
// ownership DECISION lives there; the org resolution + the Airbyte/store I/O needed to make it lives
// here — mirrors warehouse-scope.ts (currentWarehouseDatabase) exactly, same shape, same convention.
//
// Fixes the cross-tenant leak found live 2026-08-05 (docs/audit/2026-08-05-viewer/data.md):
// `/data/flows/replication` rendered byte-identical content on both demo tenants because
// `airbyteEtl.listConnections()` was called with no scoping at all, anywhere.

import { airbyteEtl } from '@/lib/adapters/airbyte';
import { filterConnectionsForScope, ownedResourceKeys, sourceDatabaseKey } from '@/lib/etl-tenancy';
import type { EtlConnection } from '@/lib/etl-model';
import { listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

/**
 * The Airbyte replication connections the CURRENT viewer may see. Reads the effective org from
 * currentOrgId() (which already hard-binds a subdomain admin and never widens a non-member's scope —
 * see bindTenantOrg). DEFAULT_ORG stays UNSCOPED — the same backwards-compatible convention
 * currentWarehouseDatabase() uses for the single-tenant/platform-operator case. Every other org sees
 * only the connections attributable to a connector it has already registered; an unattributable
 * connection (no org's connectors match its source database) is invisible to every tenant org.
 */
export async function currentEtlConnections(): Promise<EtlConnection[]> {
  const org = await currentOrgId();
  const connections = await airbyteEtl.listConnections();
  if (org === DEFAULT_ORG || connections.length === 0) return connections;

  const orgConnectors = await listConnectors(org);
  const scope = ownedResourceKeys(orgConnectors.map((c) => c.endpoint));
  // An org with no registered connectors at all owns no resource keys — every connection is
  // unattributable to it. Skip the per-connection source lookups; filterConnectionsForScope would
  // reach the same [] regardless, but this avoids N wasted Airbyte round-trips.
  if (scope.size === 0) return [];

  const sourceDatabaseOf = new Map<string, string | null>();
  await Promise.all(
    connections.map(async (c) => {
      if (!c.sourceId) {
        sourceDatabaseOf.set(c.connectionId, null);
        return;
      }
      const raw = await airbyteEtl.getSourceRaw(c.sourceId);
      sourceDatabaseOf.set(c.connectionId, sourceDatabaseKey(raw));
    }),
  );

  return filterConnectionsForScope(connections, sourceDatabaseOf, scope);
}

/**
 * Whether `connectionId` is visible to the CURRENT viewer — used by the connection DETAIL page/route
 * and every per-connection mutation route (sync, schedule, reset, sync-mode) so a guessed/enumerated
 * id belonging to another org's connection 404s exactly like an unknown one (never a 403, which would
 * confirm it exists — same rule as the audit/warehouse fixes). Reuses currentEtlConnections() so the
 * list and detail surfaces can never disagree about what's visible (one scoping decision, not two).
 */
export async function isEtlConnectionVisible(connectionId: string): Promise<boolean> {
  if (!connectionId) return false;
  const connections = await currentEtlConnections();
  return connections.some((c) => c.connectionId === connectionId);
}
