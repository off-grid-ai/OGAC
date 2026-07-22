// Saved metric queries — the console-owned CRUD entity that gives the metric-explorer its management
// depth. A named PromQL query + default range window + description, scoped to the caller's org.
//
// This is the thin I/O ADAPTER over a self-migrating table (`vm_saved_queries`); the PURE validation
// (validateSavedQuery) lives in victoriametrics-query.ts and is unit-tested. Same memoized-ensure /
// CREATE TABLE IF NOT EXISTS pattern as analytics-rules.ts / etl-jobs-store.ts, so it deploys over
// SSH with no migration step and deliberately does NOT touch src/db/schema.ts. Every function is
// TENANT-scoped by orgId: reads filter, writes stamp, update/delete match (id AND org_id) so a
// tenant can never read/edit/delete another tenant's saved query with a guessed id.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import type { SavedQueryInput } from '@/lib/victoriametrics-query';

export const vmSavedQueries = pgTable('vm_saved_queries', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  name: text('name').notNull(),
  query: text('query').notNull(),
  range: text('range').notNull().default('1h'),
  description: text('description').notNull().default(''),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type VmSavedQuery = typeof vmSavedQueries.$inferSelect;

let ensurePromise: Promise<void> | null = null;
export async function ensureVmSavedQueriesSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vm_saved_queries (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        name text NOT NULL,
        query text NOT NULL,
        range text NOT NULL DEFAULT '1h',
        description text NOT NULL DEFAULT '',
        created_by text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS vm_saved_queries_org_idx ON vm_saved_queries (org_id);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

export async function listSavedQueries(orgId: string = DEFAULT_ORG): Promise<VmSavedQuery[]> {
  await ensureVmSavedQueriesSchema();
  return db
    .select()
    .from(vmSavedQueries)
    .where(eq(vmSavedQueries.orgId, orgId))
    .orderBy(desc(vmSavedQueries.createdAt));
}

export async function getSavedQuery(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<VmSavedQuery | null> {
  await ensureVmSavedQueriesSchema();
  const [row] = await db
    .select()
    .from(vmSavedQueries)
    .where(and(eq(vmSavedQueries.id, id), eq(vmSavedQueries.orgId, orgId)));
  return row ?? null;
}

export async function createSavedQuery(
  input: SavedQueryInput,
  createdBy: string,
  orgId: string = DEFAULT_ORG,
): Promise<VmSavedQuery> {
  await ensureVmSavedQueriesSchema();
  const row = { id: randomUUID(), orgId, ...input, createdBy };
  await db.insert(vmSavedQueries).values(row);
  const [created] = await db.select().from(vmSavedQueries).where(eq(vmSavedQueries.id, row.id));
  return created;
}

export async function updateSavedQuery(
  id: string,
  input: SavedQueryInput,
  orgId: string = DEFAULT_ORG,
): Promise<VmSavedQuery | null> {
  await ensureVmSavedQueriesSchema();
  await db
    .update(vmSavedQueries)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(vmSavedQueries.id, id), eq(vmSavedQueries.orgId, orgId)));
  return getSavedQuery(id, orgId);
}

export async function deleteSavedQuery(id: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensureVmSavedQueriesSchema();
  const existing = await getSavedQuery(id, orgId);
  if (!existing) return false;
  await db
    .delete(vmSavedQueries)
    .where(and(eq(vmSavedQueries.id, id), eq(vmSavedQueries.orgId, orgId)));
  return true;
}
