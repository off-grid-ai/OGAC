// ─── Connector detail — read-by-id + sub-resource getters for the connector DETAIL view ──
//
// The connectors LIST (src/app/(console)/(data)/data) renders a flat table; this file supplies the
// deep view behind a single connector at /data/connectors/[id]: its config, the live query dialect
// it resolves to, its sync/ingest history, and the data-domains bound to it. All read-only.
//
// SOLID: this is a thin persistence + assembly seam. The matching/dialect LOGIC lives in
// connector-exec.ts (detectDialect) and data-domains.ts; we only read rows and compose the view.
// We intentionally do NOT edit store.ts — these are additive getters over the same tables.
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { connectors, ingestJobs } from '@/db/schema';
import { detectDialect } from '@/lib/connector-exec';
import { listDomains } from '@/lib/data-domains-store';
import type { Connector, IngestJob } from '@/lib/store';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

export interface ConnectorBoundDomain {
  id: string;
  label: string;
  aliases: string[];
  resource: string;
}

export interface ConnectorDetail {
  connector: Connector;
  // The live-query strategy the rule engine resolves for this (type, endpoint) pair, or null when
  // no strategy matches (non-DB / scheme mismatch). Purely derived — no connection is opened here.
  dialect: 'postgres' | 'mysql' | 'mssql' | 'rest' | null;
  // Most-recent-first ingest/sync runs for THIS connector.
  syncHistory: IngestJob[];
  // Data-domain rules that route to this connector (label + aliases → resource).
  boundDomains: ConnectorBoundDomain[];
}

// One connector by id, org-scoped (never leak another tenant's connector). Null if absent.
export async function getConnector(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<Connector | null> {
  const [r] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, id), eq(connectors.orgId, orgId)))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    status: r.status,
    lastSync: r.lastSync ? iso(r.lastSync) : null,
    endpoint: r.endpoint ?? '',
    auth: r.auth ?? 'none',
    description: r.description ?? '',
    custom: r.custom ?? false,
  };
}

// Sync/ingest runs for a single connector, most recent first.
export async function listSyncHistory(connectorId: string, limit = 25): Promise<IngestJob[]> {
  const rows = await db
    .select()
    .from(ingestJobs)
    .where(eq(ingestJobs.connectorId, connectorId))
    .orderBy(desc(ingestJobs.startedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    connectorId: r.connectorId,
    connectorName: r.connectorName,
    status: r.status,
    records: r.records,
    startedAt: iso(r.startedAt),
  }));
}

// Assemble the full detail view for one connector, or null if the connector doesn't exist for org.
export async function getConnectorDetail(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<ConnectorDetail | null> {
  const connector = await getConnector(id, orgId);
  if (!connector) return null;
  const [syncHistory, domains] = await Promise.all([
    listSyncHistory(id),
    listDomains(orgId),
  ]);
  const boundDomains: ConnectorBoundDomain[] = domains
    .filter((d) => d.connectorId === id)
    .map((d) => ({ id: d.id, label: d.label, aliases: d.aliases, resource: d.resource }));
  return {
    connector,
    dialect: detectDialect(connector.type, connector.endpoint),
    syncHistory,
    boundDomains,
  };
}
