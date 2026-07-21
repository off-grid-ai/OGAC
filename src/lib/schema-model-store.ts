// ─── Analytical-model store — Postgres persistence for governed warehouse models ──
// The console-owned system of record for analytical models (views / materialized views / tables an
// operator defines over the warehouse) and their VERSION history. ClickHouse holds the live object;
// this store holds the versioned definitions + the exact DDL applied, so an edit is a new version
// and a rollback re-applies an older one — an auditable migration trail ClickHouse itself doesn't
// keep. Org-scoped. Tables are created lazily (raw SQL) matching the store.ts ensure* pattern, so no
// drizzle-kit migration is needed on the fleet.
//
// SOLID: this file is the thin persistence seam. Row→view mapping is pure (mapModelRow/
// mapVersionRow, exported + unit-tested); WHAT DDL runs is decided by the pure src/lib/schema-model.ts.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { ModelDefinition, ModelKind } from '@/lib/schema-model';

const DEFAULT_ORG = 'default';

export interface SchemaModel {
  id: string;
  orgId: string;
  name: string;
  database: string | null;
  kind: ModelKind;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface SchemaModelVersion {
  id: string;
  modelId: string;
  version: number;
  definition: ModelDefinition;
  applyDdl: string[];
  note: string | null;
  createdAt: string;
}

export interface SchemaModelDetail extends SchemaModel {
  versions: SchemaModelVersion[];
}

let schemaReady: Promise<void> | null = null;

export function ensureSchemaModelTables(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS warehouse_models (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        name text NOT NULL,
        database text,
        kind text NOT NULL,
        current_version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS warehouse_model_versions (
        id text PRIMARY KEY,
        model_id text NOT NULL,
        org_id text NOT NULL DEFAULT 'default',
        version integer NOT NULL,
        definition jsonb NOT NULL,
        apply_ddl jsonb NOT NULL,
        note text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS warehouse_models_org_idx ON warehouse_models (org_id);`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS warehouse_model_versions_model_idx ON warehouse_model_versions (model_id);`,
    );
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

// Normalize a drizzle/node-postgres execute() result into a plain row array (mirrors store.ts).
function rowsOf(res: unknown): Record<string, unknown>[] {
  const r = res as { rows?: Record<string, unknown>[] };
  return Array.isArray(r?.rows) ? r.rows : ((res as Record<string, unknown>[]) ?? []);
}

// ─── PURE row → view mappers (unit-tested) ────────────────────────────────────
export function mapModelRow(r: Record<string, unknown>): SchemaModel {
  return {
    id: String(r.id),
    orgId: String(r.org_id ?? DEFAULT_ORG),
    name: String(r.name ?? ''),
    database: r.database == null ? null : String(r.database),
    kind: String(r.kind ?? 'view') as ModelKind,
    currentVersion: Number(r.current_version ?? 1) || 1,
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
  };
}

export function mapVersionRow(r: Record<string, unknown>): SchemaModelVersion {
  return {
    id: String(r.id),
    modelId: String(r.model_id),
    version: Number(r.version ?? 1) || 1,
    definition: (typeof r.definition === 'object' && r.definition
      ? r.definition
      : {}) as ModelDefinition,
    applyDdl: Array.isArray(r.apply_ddl) ? (r.apply_ddl as string[]) : [],
    note: r.note == null ? null : String(r.note),
    createdAt: isoOf(r.created_at),
  };
}

function isoOf(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return '';
}

// ─── CRUD (I/O) ───────────────────────────────────────────────────────────────
export async function listModels(orgId: string = DEFAULT_ORG): Promise<SchemaModel[]> {
  await ensureSchemaModelTables();
  const res = await db.execute(sql`
    SELECT * FROM warehouse_models WHERE org_id = ${orgId} ORDER BY name ASC, id ASC;
  `);
  return rowsOf(res).map(mapModelRow);
}

export async function getModel(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<SchemaModelDetail | null> {
  await ensureSchemaModelTables();
  const modelRes = await db.execute(sql`
    SELECT * FROM warehouse_models WHERE id = ${id} AND org_id = ${orgId} LIMIT 1;
  `);
  const modelRow = rowsOf(modelRes)[0];
  if (!modelRow) return null;
  const verRes = await db.execute(sql`
    SELECT * FROM warehouse_model_versions
    WHERE model_id = ${id} AND org_id = ${orgId} ORDER BY version DESC;
  `);
  return { ...mapModelRow(modelRow), versions: rowsOf(verRes).map(mapVersionRow) };
}

export interface CreateModelInput {
  name: string;
  database?: string | null;
  kind: ModelKind;
  definition: ModelDefinition;
  applyDdl: string[];
  note?: string;
}

export async function createModel(
  input: CreateModelInput,
  orgId: string = DEFAULT_ORG,
): Promise<SchemaModel> {
  await ensureSchemaModelTables();
  const id = `wm_${randomUUID().slice(0, 12)}`;
  const now = new Date();
  await db.execute(sql`
    INSERT INTO warehouse_models (id, org_id, name, database, kind, current_version, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${input.name}, ${input.database ?? null}, ${input.kind}, 1, ${now}, ${now});
  `);
  await db.execute(sql`
    INSERT INTO warehouse_model_versions (id, model_id, org_id, version, definition, apply_ddl, note, created_at)
    VALUES (${`wmv_${randomUUID().slice(0, 12)}`}, ${id}, ${orgId}, 1,
      ${JSON.stringify(input.definition)}::jsonb, ${JSON.stringify(input.applyDdl)}::jsonb,
      ${input.note ?? 'initial version'}, ${now});
  `);
  const detail = await getModel(id, orgId);
  return detail!;
}

// Append a new version (an edit): bump current_version and record the version row + its DDL.
export async function addModelVersion(
  id: string,
  version: number,
  definition: ModelDefinition,
  applyDdl: string[],
  note: string | undefined,
  orgId: string = DEFAULT_ORG,
): Promise<SchemaModel | null> {
  await ensureSchemaModelTables();
  const now = new Date();
  const upd = await db.execute(sql`
    UPDATE warehouse_models SET current_version = ${version}, updated_at = ${now}
    WHERE id = ${id} AND org_id = ${orgId} RETURNING id;
  `);
  if (rowsOf(upd).length === 0) return null;
  await db.execute(sql`
    INSERT INTO warehouse_model_versions (id, model_id, org_id, version, definition, apply_ddl, note, created_at)
    VALUES (${`wmv_${randomUUID().slice(0, 12)}`}, ${id}, ${orgId}, ${version},
      ${JSON.stringify(definition)}::jsonb, ${JSON.stringify(applyDdl)}::jsonb, ${note ?? null}, ${now});
  `);
  const detail = await getModel(id, orgId);
  return detail;
}

// Move the current-version pointer (rollback re-applies an older version's DDL, then points here).
export async function setCurrentVersion(
  id: string,
  version: number,
  orgId: string = DEFAULT_ORG,
): Promise<SchemaModel | null> {
  await ensureSchemaModelTables();
  const upd = await db.execute(sql`
    UPDATE warehouse_models SET current_version = ${version}, updated_at = ${new Date()}
    WHERE id = ${id} AND org_id = ${orgId} RETURNING id;
  `);
  if (rowsOf(upd).length === 0) return null;
  return (await getModel(id, orgId)) as SchemaModel | null;
}

export async function deleteModel(id: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensureSchemaModelTables();
  await db.execute(sql`
    DELETE FROM warehouse_model_versions WHERE model_id = ${id} AND org_id = ${orgId};
  `);
  const res = await db.execute(sql`
    DELETE FROM warehouse_models WHERE id = ${id} AND org_id = ${orgId} RETURNING id;
  `);
  return rowsOf(res).length > 0;
}
