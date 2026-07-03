import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { goldenCases } from '@/db/schema';
import { searchDocuments } from '@/lib/brain';
import { type GoldenCaseDraft } from '@/lib/evals-golden';

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
  })();
  return ensurePromise;
}

interface GoldenRow {
  id: string;
  name: string | null;
  query: string;
  expected: string;
  suite: string | null;
  [k: string]: unknown;
}

function toGoldenCase(r: GoldenRow): GoldenCase {
  return {
    id: r.id,
    name: r.name || r.query,
    query: r.query,
    expected: r.expected,
    suite: r.suite ?? 'golden',
  };
}

export async function listGoldenCases(): Promise<GoldenCase[]> {
  await ensureEvalsSchema();
  const { rows } = await db.execute<GoldenRow>(
    sql`SELECT id, name, query, expected, suite FROM golden_cases ORDER BY created_at DESC;`,
  );
  return rows.map(toGoldenCase);
}

export async function getGoldenCase(id: string): Promise<GoldenCase | null> {
  await ensureEvalsSchema();
  const { rows } = await db.execute<GoldenRow>(
    sql`SELECT id, name, query, expected, suite FROM golden_cases WHERE id = ${id} LIMIT 1;`,
  );
  return rows[0] ? toGoldenCase(rows[0]) : null;
}

export async function addGoldenCase(draft: GoldenCaseDraft): Promise<GoldenCase> {
  await ensureEvalsSchema();
  const id = `gc_${randomUUID().slice(0, 6)}`;
  const { rows } = await db.execute<GoldenRow>(
    sql`INSERT INTO golden_cases (id, name, query, expected, suite)
        VALUES (${id}, ${draft.name}, ${draft.query}, ${draft.expected}, ${draft.suite})
        RETURNING id, name, query, expected, suite;`,
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
        RETURNING id, name, query, expected, suite;`,
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

export async function listEvalRuns(limit = 10): Promise<EvalRun[]> {
  await ensureEvalsSchema();
  const { rows } = await db.execute<EvalRunRow>(
    sql`SELECT id, engine, score, total, passed, started_at, results
        FROM eval_runs ORDER BY started_at DESC LIMIT ${limit};`,
  );
  return rows.map(toEvalRun);
}

// A single eval run by id — the per-case drilldown (Observability → eval detail).
export async function getEvalRun(id: string): Promise<EvalRun | null> {
  await ensureEvalsSchema();
  const { rows } = await db.execute<EvalRunRow>(
    sql`SELECT id, engine, score, total, passed, started_at, results
        FROM eval_runs WHERE id = ${id} LIMIT 1;`,
  );
  return rows[0] ? toEvalRun(rows[0]) : null;
}

// Persist a scored run from any evals adapter (golden persists in-process via runEval below;
// promptfoo/ragas hand their EvalRunResult here so they too land in the per-engine rollup).
export async function recordEvalRun(run: {
  id: string;
  engine: string;
  score: number;
  total: number;
  passed: number;
  results?: EvalResult[];
}): Promise<void> {
  await ensureEvalsSchema();
  const results = run.results ? JSON.stringify(run.results) : null;
  await db.execute(
    sql`INSERT INTO eval_runs (id, engine, score, total, passed, results)
        VALUES (${run.id}, ${run.engine}, ${run.score}, ${run.total}, ${run.passed}, ${results}::jsonb);`,
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

export async function runEval(): Promise<EvalRun> {
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
  await recordEvalRun({ id, engine: 'golden', score, total, passed, results });
  const run = await getEvalRun(id);
  return run ?? { id, engine: 'golden', score, total, passed, startedAt: iso(new Date()), results };
}
