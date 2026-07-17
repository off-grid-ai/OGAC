// ─── Data-domain store — I/O for the connector rule engine's declarations (Builder Epic 1B) ──
//
// CRUD over the `data_domains` table: an org's declarations of WHERE its data lives ("reimbursement
// quota → connector con_hr, table employee_quota"). Org-scoped. The pure resolver lives in
// data-domains.ts; this file is the thin persistence seam that feeds it real rows.
//
// SOLID: no matching logic here — just read/write and map rows → the pure `DataDomain` view.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { dataDomains } from '@/db/schema';
import type { DataDomain as DataDomainRow } from '@/db/schema';
import type { DataDomain } from '@/lib/data-domains';

const DEFAULT_ORG = 'default';

let schemaReady: Promise<void> | null = null;

/** Idempotent live-upgrade path for fleets where drizzle-kit migrations cannot run over SSH. */
export function ensureDataDomainsSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = db
    .execute(
      sql`
      CREATE TABLE IF NOT EXISTS data_domains (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        label text NOT NULL,
        aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
        connector_id text NOT NULL,
        resource text NOT NULL,
        op_hints jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `,
    )
    .then(() => undefined)
    .catch((error) => {
      schemaReady = null;
      throw error;
    });
  return schemaReady;
}

// Map a DB row → the pure view the resolver consumes. Aliases/opHints default defensively.
export function toDataDomain(r: DataDomainRow): DataDomain {
  return {
    id: r.id,
    orgId: r.orgId,
    label: r.label,
    aliases: Array.isArray(r.aliases) ? r.aliases : [],
    connectorId: r.connectorId,
    resource: r.resource,
    opHints: r.opHints ?? undefined,
  };
}

export interface CreateDomainInput {
  label: string;
  connectorId: string;
  resource: string;
  aliases?: string[];
  opHints?: Record<string, unknown>;
}

export interface UpdateDomainInput {
  label?: string;
  connectorId?: string;
  resource?: string;
  aliases?: string[];
  opHints?: Record<string, unknown> | null;
}

// List every declared domain for an org, stable order (label asc) for deterministic resolution.
export async function listDomains(orgId: string = DEFAULT_ORG): Promise<DataDomain[]> {
  await ensureDataDomainsSchema();
  const rows = await db
    .select()
    .from(dataDomains)
    .where(eq(dataDomains.orgId, orgId))
    .orderBy(asc(dataDomains.label), asc(dataDomains.id));
  return rows.map(toDataDomain);
}

// One domain by id, org-scoped (never leak another tenant's binding). Null if absent.
export async function getDomain(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<DataDomain | null> {
  await ensureDataDomainsSchema();
  const rows = await db
    .select()
    .from(dataDomains)
    .where(and(eq(dataDomains.id, id), eq(dataDomains.orgId, orgId)))
    .limit(1);
  return rows[0] ? toDataDomain(rows[0]) : null;
}

export async function createDomain(
  input: CreateDomainInput,
  orgId: string = DEFAULT_ORG,
): Promise<DataDomain> {
  await ensureDataDomainsSchema();
  const id = `dom_${randomUUID().slice(0, 12)}`;
  const now = new Date();
  const [row] = await db
    .insert(dataDomains)
    .values({
      id,
      orgId,
      label: input.label,
      aliases: input.aliases ?? [],
      connectorId: input.connectorId,
      resource: input.resource,
      opHints: input.opHints,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toDataDomain(row);
}

// Partial update, org-scoped. Returns the updated row, or null if it didn't exist for this org.
export async function updateDomain(
  id: string,
  patch: UpdateDomainInput,
  orgId: string = DEFAULT_ORG,
): Promise<DataDomain | null> {
  await ensureDataDomainsSchema();
  const set: Partial<DataDomainRow> = { updatedAt: new Date() };
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.connectorId !== undefined) set.connectorId = patch.connectorId;
  if (patch.resource !== undefined) set.resource = patch.resource;
  if (patch.aliases !== undefined) set.aliases = patch.aliases;
  if (patch.opHints !== undefined) set.opHints = patch.opHints ?? undefined;

  const [row] = await db
    .update(dataDomains)
    .set(set)
    .where(and(eq(dataDomains.id, id), eq(dataDomains.orgId, orgId)))
    .returning();
  return row ? toDataDomain(row) : null;
}

// Delete, org-scoped. Returns true if a row was removed.
export async function deleteDomain(id: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensureDataDomainsSchema();
  const rows = await db
    .delete(dataDomains)
    .where(and(eq(dataDomains.id, id), eq(dataDomains.orgId, orgId)))
    .returning({ id: dataDomains.id });
  return rows.length > 0;
}
