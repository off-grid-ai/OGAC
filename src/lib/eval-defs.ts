import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { EvalDefDraft } from '@/lib/eval-defs-policy';
import type { EvalEngine, MetricDirection } from '@/lib/eval-templates';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// EVAL-DEFINITION store — the DB ADAPTER over the pure validation in eval-defs-policy.ts. An eval
// definition is a console-owned, first-class saved evaluator (what a template becomes when applied,
// or an authored-from-scratch one). Its table is created idempotently on first use (same memoized
// ensure pattern as analytics-rules.ts / chat.ts) so the module deploys over SSH with no migration
// step — src/db/schema.ts is intentionally NOT touched.
//
// DDL (noted for SERVER_STATE):
//   CREATE TABLE IF NOT EXISTS eval_definitions (
//     id text PRIMARY KEY, name text NOT NULL, template_id text NOT NULL DEFAULT '',
//     metric text NOT NULL, engine text NOT NULL, direction text NOT NULL DEFAULT 'higher-better',
//     threshold real NOT NULL DEFAULT 0.7, suite text NOT NULL DEFAULT 'golden',
//     description text NOT NULL DEFAULT '', created_by text NOT NULL DEFAULT '',
//     created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

export interface EvalDef {
  id: string;
  name: string;
  templateId: string;
  metric: string;
  engine: EvalEngine;
  direction: MetricDirection;
  threshold: number;
  suite: string;
  description: string;
  // The pipeline (app) this eval belongs to. null = an org-wide/library eval (attachable to any
  // pipeline). A pipeline's evals run in ITS context and can gate its releases.
  //
  // BOTH association columns are carried during the app→pipeline re-point (PIPELINES_AND_GATEWAYS_PLAN
  // "corrected model"): `appId` is the legacy column the app Quality tab still uses (back-compat);
  // `pipelineId` is the corrected association the pipeline Quality tab uses. New pipeline-scoped evals
  // stamp pipelineId; the app tab keeps stamping appId. Neither set ⇒ an org-wide library eval.
  appId: string | null;
  pipelineId: string | null;
  createdAt: string;
  updatedAt: string;
}

let ensurePromise: Promise<void> | null = null;
export async function ensureEvalDefsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS eval_definitions (
        id text PRIMARY KEY,
        name text NOT NULL,
        template_id text NOT NULL DEFAULT '',
        metric text NOT NULL,
        engine text NOT NULL,
        direction text NOT NULL DEFAULT 'higher-better',
        threshold real NOT NULL DEFAULT 0.7,
        suite text NOT NULL DEFAULT 'golden',
        description text NOT NULL DEFAULT '',
        created_by text NOT NULL DEFAULT '',
        app_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    // Self-migrate existing tables (pipeline-owns-governance): the eval belongs to an app/pipeline.
    await db.execute(sql`ALTER TABLE eval_definitions ADD COLUMN IF NOT EXISTS app_id text;`);
    await db.execute(sql`ALTER TABLE eval_definitions ADD COLUMN IF NOT EXISTS pipeline_id text;`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS eval_definitions_pipeline_idx ON eval_definitions (pipeline_id);`,
    );
    // Security Wave 2 multi-tenant org-scoping: self-migrate org_id (same idempotent pattern) so the
    // raw INSERT/SELECT/UPDATE here never references a missing column, even before the migration SQL
    // is applied on the live DB. Reads filter on it, writes stamp the caller's org — before this, an
    // eval def was visible/editable across every tenant.
    await db.execute(
      sql`ALTER TABLE eval_definitions ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS eval_definitions_org_idx ON eval_definitions (org_id);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface Row {
  id: string;
  name: string;
  template_id: string | null;
  metric: string;
  engine: string;
  direction: string | null;
  threshold: number | string;
  suite: string | null;
  description: string | null;
  app_id: string | null;
  pipeline_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  [k: string]: unknown;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function toDef(r: Row): EvalDef {
  return {
    id: r.id,
    name: r.name,
    templateId: r.template_id ?? '',
    metric: r.metric,
    engine: r.engine as EvalEngine,
    direction: (r.direction ?? 'higher-better') as MetricDirection,
    threshold: Number(r.threshold),
    suite: r.suite ?? 'golden',
    description: r.description ?? '',
    appId: r.app_id ?? null,
    pipelineId: r.pipeline_id ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const EVAL_DEF_COLS = sql`id, name, template_id, metric, engine, direction, threshold, suite,
                          description, app_id, pipeline_id, created_at, updated_at`;

// List filter — associate by the CORRECTED pipeline_id OR the legacy app_id. Passing a bare string is
// treated as an appId (back-compat with the shipped app Quality tab). The options object is the new
// path: `{ pipelineId }` → that pipeline's evals; `{ pipelineId: null }` → the org-wide library
// (neither app nor pipeline attached); omitting both filters → ALL (global catalog view). `orgId`,
// when set, is the TENANT scope — ANDed onto every query so one tenant never sees another's evals
// (Security Wave 2 — before this list/get were unscoped and leaked across orgs).
export interface EvalDefFilter {
  appId?: string | null;
  pipelineId?: string | null;
  orgId?: string;
}

// Build the WHERE from the tenant scope + the association filter, ANDed together. `WHERE …` or empty.
function evalDefWhere(filter: EvalDefFilter) {
  const conds: ReturnType<typeof sql>[] = [];
  if (filter.orgId !== undefined) conds.push(sql`org_id = ${filter.orgId}`);
  if (filter.pipelineId !== undefined) {
    conds.push(
      filter.pipelineId === null
        ? sql`pipeline_id IS NULL AND app_id IS NULL`
        : sql`pipeline_id = ${filter.pipelineId}`,
    );
  } else if (filter.appId !== undefined) {
    conds.push(filter.appId === null ? sql`app_id IS NULL` : sql`app_id = ${filter.appId}`);
  }
  return conds.length === 0 ? sql`` : sql`WHERE ${sql.join(conds, sql` AND `)}`;
}

// List eval definitions. Accepts EITHER the legacy `appId` string|null (back-compat) OR an
// EvalDefFilter. `{pipelineId}` filters to a pipeline's evals; `{pipelineId:null}` returns the
// org-wide library (unattached); `{orgId}` scopes to a tenant; omitting all returns ALL (internal).
export async function listEvalDefs(arg?: string | null | EvalDefFilter): Promise<EvalDef[]> {
  await ensureEvalDefsSchema();
  const filter: EvalDefFilter =
    arg === undefined
      ? {}
      : arg === null || typeof arg === 'string'
        ? { appId: arg }
        : arg;
  const { rows } = await db.execute<Row>(
    sql`SELECT ${EVAL_DEF_COLS} FROM eval_definitions ${evalDefWhere(filter)} ORDER BY created_at DESC;`,
  );
  return rows.map(toDef);
}

// Get one eval def. `orgId`, when provided, scopes the lookup so an id from another tenant → null.
export async function getEvalDef(id: string, orgId?: string): Promise<EvalDef | null> {
  await ensureEvalDefsSchema();
  const orgCond = orgId === undefined ? sql`` : sql` AND org_id = ${orgId}`;
  const { rows } = await db.execute<Row>(
    sql`SELECT ${EVAL_DEF_COLS} FROM eval_definitions WHERE id = ${id}${orgCond} LIMIT 1;`,
  );
  return rows[0] ? toDef(rows[0]) : null;
}

// Attach a new eval to a pipeline (`pipelineId`) and/or an app (`appId`, legacy). Either/both null ⇒
// an org-wide library eval. The pipeline Quality tab passes pipelineId; the app tab passes appId.
// `orgId` STAMPS the owning tenant (defaults to the shared 'default' org for internal callers).
export interface AddEvalDefTarget {
  appId?: string | null;
  pipelineId?: string | null;
  orgId?: string;
}

export async function addEvalDef(
  draft: EvalDefDraft,
  createdBy = '',
  target: string | null | AddEvalDefTarget = null,
): Promise<EvalDef> {
  await ensureEvalDefsSchema();
  const t: AddEvalDefTarget =
    target === null || typeof target === 'string' ? { appId: target } : target;
  const appId = t.appId ?? null;
  const pipelineId = t.pipelineId ?? null;
  const orgId = t.orgId ?? DEFAULT_ORG;
  const id = `ed_${randomUUID().slice(0, 8)}`;
  const { rows } = await db.execute<Row>(
    sql`INSERT INTO eval_definitions
          (id, name, template_id, metric, engine, direction, threshold, suite, description, created_by, app_id, pipeline_id, org_id)
        VALUES (${id}, ${draft.name}, ${draft.templateId}, ${draft.metric}, ${draft.engine},
                ${draft.direction}, ${draft.threshold}, ${draft.suite}, ${draft.description}, ${createdBy}, ${appId}, ${pipelineId}, ${orgId})
        RETURNING ${EVAL_DEF_COLS};`,
  );
  return toDef(rows[0]);
}

// Update an eval def. `orgId`, when provided, scopes the UPDATE so a tenant cannot edit another
// tenant's eval even with its id (no row matches → null → route 404s).
export async function updateEvalDef(
  id: string,
  draft: EvalDefDraft,
  orgId?: string,
): Promise<EvalDef | null> {
  await ensureEvalDefsSchema();
  const orgCond = orgId === undefined ? sql`` : sql` AND org_id = ${orgId}`;
  const { rows } = await db.execute<Row>(
    sql`UPDATE eval_definitions
        SET name = ${draft.name}, template_id = ${draft.templateId}, metric = ${draft.metric},
            engine = ${draft.engine}, direction = ${draft.direction}, threshold = ${draft.threshold},
            suite = ${draft.suite}, description = ${draft.description}, updated_at = now()
        WHERE id = ${id}${orgCond}
        RETURNING ${EVAL_DEF_COLS};`,
  );
  return rows[0] ? toDef(rows[0]) : null;
}

export async function deleteEvalDef(id: string, orgId?: string): Promise<void> {
  await ensureEvalDefsSchema();
  if (orgId !== undefined) {
    await db.execute(
      sql`DELETE FROM eval_definitions WHERE id = ${id} AND org_id = ${orgId};`,
    );
    return;
  }
  await db.execute(sql`DELETE FROM eval_definitions WHERE id = ${id};`);
}
