import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { goldenCases } from '@/db/schema';
import { searchDocuments } from '@/lib/brain';
import { type GoldenCaseDraft } from '@/lib/evals-golden';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Evals over the Brain — a golden set of {query → expected source} run against retrieval,
// scored as recall (did the expected doc surface in top-k). Decoupled: reads the Brain only
// through searchDocuments(), writes its own run records.
//
// NOTE on the schema: golden_cases (name, suite, updated_at) and eval_runs (engine) are widened
// post-hoc by ensureEvalsSchema() below (ALTER TABLE ... ADD COLUMN IF NOT EXISTS), NOT in
// src/db/schema.ts — so the typed Drizzle builder doesn't know those columns. Reads/writes that
// touch them go through raw SQL (db.execute) rather than the typed query builder.
export interface GoldenCase {
  id: string;
  name: string;
  query: string;
  expected: string;
  suite: string;
  // The pipeline (app) this golden case belongs to. null = an org-wide/shared case (library).
  // BOTH columns during the app→pipeline re-point: `appId` = legacy (app Quality tab, back-compat);
  // `pipelineId` = corrected association (pipeline Quality tab). Neither ⇒ an org-wide library case.
  appId: string | null;
  pipelineId: string | null;
}

export interface EvalResult {
  query: string;
  expected: string;
  pass: boolean;
  top: string;
  score: number;
}

export interface EvalRun {
  id: string;
  engine: string;
  score: number;
  total: number;
  passed: number;
  startedAt: string;
  results?: EvalResult[];
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

// Idempotent schema widening (added post-hoc, mirrors ensureChatSchema / ensureFileSchema) so the
// module deploys over SSH with no migration step. golden_cases/eval_runs already exist in
// src/db/schema.ts; here we ADD the columns the CRUD + per-engine rollup need.
let ensurePromise: Promise<void> | null = null;
export async function ensureEvalsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(
      sql`ALTER TABLE golden_cases ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';`,
    );
    await db.execute(
      sql`ALTER TABLE golden_cases ADD COLUMN IF NOT EXISTS suite text NOT NULL DEFAULT 'golden';`,
    );
    await db.execute(
      sql`ALTER TABLE golden_cases ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();`,
    );
    // Backfill name from query for pre-existing rows so every case is labelled.
    await db.execute(sql`UPDATE golden_cases SET name = query WHERE name = '';`);
    await db.execute(
      sql`ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT 'golden';`,
    );
    // T2 multi-tenant org-scoping: self-migrate org_id (same idempotent pattern) so the raw
    // INSERT/SELECT here never references a missing column, even before the migration SQL is applied.
    await db.execute(
      sql`ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';`,
    );
    await db.execute(sql`CREATE INDEX IF NOT EXISTS eval_runs_org_idx ON eval_runs (org_id);`);
    // Pipeline-owns-governance: a golden case belongs to a pipeline (app). Self-migrate app_id/org_id
    // (same idempotent pattern) so the raw INSERT/SELECT never references a missing column.
    await db.execute(sql`ALTER TABLE golden_cases ADD COLUMN IF NOT EXISTS app_id text;`);
    await db.execute(sql`ALTER TABLE golden_cases ADD COLUMN IF NOT EXISTS pipeline_id text;`);
    await db.execute(
      sql`ALTER TABLE golden_cases ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';`,
    );
    await db.execute(sql`CREATE INDEX IF NOT EXISTS golden_cases_app_idx ON golden_cases (app_id);`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS golden_cases_pipeline_idx ON golden_cases (pipeline_id);`,
    );
  })();
  return ensurePromise;
}

interface GoldenRow {
  id: string;
  name: string | null;
  query: string;
  expected: string;
  suite: string | null;
  app_id: string | null;
  pipeline_id: string | null;
  [k: string]: unknown;
}

function toGoldenCase(r: GoldenRow): GoldenCase {
  return {
    id: r.id,
    name: r.name || r.query,
    query: r.query,
    expected: r.expected,
    suite: r.suite ?? 'golden',
    appId: r.app_id ?? null,
    pipelineId: r.pipeline_id ?? null,
  };
}

const GOLDEN_COLS = sql`id, name, query, expected, suite, app_id, pipeline_id`;

// Filter — associate by the CORRECTED pipeline_id OR the legacy app_id (see EvalDefFilter). A bare
// string arg is a legacy appId (back-compat with the shipped app Quality tab).
export interface GoldenFilter {
  appId?: string | null;
  pipelineId?: string | null;
}

function goldenWhere(filter: GoldenFilter) {
  if (filter.pipelineId !== undefined) {
    return filter.pipelineId === null
      ? sql`WHERE pipeline_id IS NULL AND app_id IS NULL`
      : sql`WHERE pipeline_id = ${filter.pipelineId}`;
  }
  if (filter.appId !== undefined) {
    return filter.appId === null ? sql`WHERE app_id IS NULL` : sql`WHERE app_id = ${filter.appId}`;
  }
  return sql``;
}

// List golden cases. Accepts EITHER the legacy `appId` string|null (back-compat) OR a GoldenFilter.
// `{pipelineId}` filters to a pipeline's golden set; `{pipelineId:null}` returns the org-wide library;
// omitting the arg returns ALL (the global view).
export async function listGoldenCases(arg?: string | null | GoldenFilter): Promise<GoldenCase[]> {
  await ensureEvalsSchema();
  const filter: GoldenFilter =
    arg === undefined ? {} : arg === null || typeof arg === 'string' ? { appId: arg } : arg;
  const { rows } = await db.execute<GoldenRow>(
    sql`SELECT ${GOLDEN_COLS} FROM golden_cases ${goldenWhere(filter)} ORDER BY created_at DESC;`,
  );
  return rows.map(toGoldenCase);
}

export async function getGoldenCase(id: string): Promise<GoldenCase | null> {
  await ensureEvalsSchema();
  const { rows } = await db.execute<GoldenRow>(
    sql`SELECT ${GOLDEN_COLS} FROM golden_cases WHERE id = ${id} LIMIT 1;`,
  );
  return rows[0] ? toGoldenCase(rows[0]) : null;
}

// Attach a golden case to a pipeline (`pipelineId`) and/or app (`appId`, legacy). Either/both null ⇒
// an org-wide library case. A bare string arg is a legacy appId (back-compat).
export interface AddGoldenTarget {
  appId?: string | null;
  pipelineId?: string | null;
}

export async function addGoldenCase(
  draft: GoldenCaseDraft,
  target: string | null | AddGoldenTarget = null,
): Promise<GoldenCase> {
  await ensureEvalsSchema();
  const t: AddGoldenTarget =
    target === null || typeof target === 'string' ? { appId: target } : target;
  const appId = t.appId ?? null;
  const pipelineId = t.pipelineId ?? null;
  const id = `gc_${randomUUID().slice(0, 6)}`;
  const { rows } = await db.execute<GoldenRow>(
    sql`INSERT INTO golden_cases (id, name, query, expected, suite, app_id, pipeline_id)
        VALUES (${id}, ${draft.name}, ${draft.query}, ${draft.expected}, ${draft.suite}, ${appId}, ${pipelineId})
        RETURNING ${GOLDEN_COLS};`,
  );
  return toGoldenCase(rows[0]);
}

export async function updateGoldenCase(
  id: string,
  draft: GoldenCaseDraft,
): Promise<GoldenCase | null> {
  await ensureEvalsSchema();
  const { rows } = await db.execute<GoldenRow>(
    sql`UPDATE golden_cases
        SET name = ${draft.name}, query = ${draft.query}, expected = ${draft.expected},
            suite = ${draft.suite}, updated_at = now()
        WHERE id = ${id}
        RETURNING ${GOLDEN_COLS};`,
  );
  return rows[0] ? toGoldenCase(rows[0]) : null;
}

export async function deleteGoldenCase(id: string): Promise<void> {
  await ensureEvalsSchema();
  await db.delete(goldenCases).where(eq(goldenCases.id, id));
}

interface EvalRunRow {
  id: string;
  engine: string | null;
  score: number;
  total: number;
  passed: number;
  started_at: Date | string;
  results: EvalResult[] | null;
  [k: string]: unknown;
}

function toEvalRun(r: EvalRunRow): EvalRun {
  return {
    id: r.id,
    engine: r.engine ?? 'golden',
    score: Number(r.score),
    total: Number(r.total),
    passed: Number(r.passed),
    startedAt: iso(r.started_at),
    results: r.results ?? undefined,
  };
}

// Org-scoped: a tenant's eval history/rollup only ever includes its own runs. org_id lives on
// eval_runs (see src/db/schema.ts) and is filtered here + stamped on insert below.
export async function listEvalRuns(limit = 10, orgId: string = DEFAULT_ORG): Promise<EvalRun[]> {
  await ensureEvalsSchema();
  const { rows } = await db.execute<EvalRunRow>(
    sql`SELECT id, engine, score, total, passed, started_at, results
        FROM eval_runs WHERE org_id = ${orgId} ORDER BY started_at DESC LIMIT ${limit};`,
  );
  return rows.map(toEvalRun);
}

// A single eval run by id — the per-case drilldown (Observability → eval detail). Scoped to the
// caller's org so run ids from another tenant resolve to null.
export async function getEvalRun(id: string, orgId: string = DEFAULT_ORG): Promise<EvalRun | null> {
  await ensureEvalsSchema();
  const { rows } = await db.execute<EvalRunRow>(
    sql`SELECT id, engine, score, total, passed, started_at, results
        FROM eval_runs WHERE id = ${id} AND org_id = ${orgId} LIMIT 1;`,
  );
  return rows[0] ? toEvalRun(rows[0]) : null;
}

// Persist a scored run from any evals adapter (golden persists in-process via runEval below;
// promptfoo/ragas hand their EvalRunResult here so they too land in the per-engine rollup).
export async function recordEvalRun(
  run: {
    id: string;
    engine: string;
    score: number;
    total: number;
    passed: number;
    results?: EvalResult[];
  },
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await ensureEvalsSchema();
  const results = run.results ? JSON.stringify(run.results) : null;
  await db.execute(
    sql`INSERT INTO eval_runs (id, org_id, engine, score, total, passed, results)
        VALUES (${run.id}, ${orgId}, ${run.engine}, ${run.score}, ${run.total}, ${run.passed}, ${results}::jsonb);`,
  );
}

async function evalCase(c: GoldenCase): Promise<EvalResult> {
  const hits = await searchDocuments(c.query, 3);
  const exp = c.expected.toLowerCase();
  const pass = hits.some(
    (h) => h.title.toLowerCase().includes(exp) || h.source.toLowerCase().includes(exp),
  );
  return {
    query: c.query,
    expected: c.expected,
    pass,
    top: hits[0]?.title ?? '—',
    score: hits[0]?.score ?? 0,
  };
}

export async function runEval(orgId: string = DEFAULT_ORG): Promise<EvalRun> {
  await ensureEvalsSchema();
  const cases = await listGoldenCases();
  const results: EvalResult[] = [];
  for (const c of cases) {
    results.push(await evalCase(c));
  }
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const score = total ? Math.round((passed / total) * 100) : 0;
  const id = `eval_${randomUUID().slice(0, 6)}`;
  await recordEvalRun({ id, engine: 'golden', score, total, passed, results }, orgId);
  const run = await getEvalRun(id, orgId);
  return run ?? { id, engine: 'golden', score, total, passed, startedAt: iso(new Date()), results };
}
