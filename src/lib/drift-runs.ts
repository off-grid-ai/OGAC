import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { DriftAttribution } from '@/lib/drift-run';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Retained drift-run store. Drift analysis used to be computed on-demand and thrown away, so an
// operator could never tell a genuine Evidently execution from the first-party PSI fallback after
// the fact. This persists each run with its engine attribution (engine + version, method, drift
// share, real-vs-fallback) so the drift history is auditable. Self-migrating (ADD COLUMN IF NOT
// EXISTS / CREATE TABLE IF NOT EXISTS) so it deploys over SSH with no migration step — same pattern
// as eval_runs (src/lib/evals.ts).

export interface DriftRun {
  id: string;
  orgId: string;
  engine: string;
  status: string;
  driftShare: number | null;
  baseline: number;
  current: number;
  startedAt: string;
  attribution: DriftAttribution | Record<string, unknown> | null;
}

let ensurePromise: Promise<void> | null = null;
export async function ensureDriftSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS drift_runs (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        engine text NOT NULL DEFAULT 'native',
        status text NOT NULL DEFAULT 'stable',
        drift_share double precision,
        baseline integer NOT NULL DEFAULT 0,
        current integer NOT NULL DEFAULT 0,
        attribution jsonb,
        started_at timestamptz NOT NULL DEFAULT now()
      );`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS drift_runs_org_idx ON drift_runs (org_id);`);
  })();
  return ensurePromise;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

interface DriftRunRow {
  id: string;
  org_id: string;
  engine: string;
  status: string;
  drift_share: number | null;
  baseline: number;
  current: number;
  started_at: Date | string;
  attribution: Record<string, unknown> | null;
  [k: string]: unknown;
}

function toDriftRun(r: DriftRunRow): DriftRun {
  return {
    id: r.id,
    orgId: r.org_id,
    engine: r.engine,
    status: r.status,
    driftShare: r.drift_share === null ? null : Number(r.drift_share),
    baseline: Number(r.baseline),
    current: Number(r.current),
    startedAt: iso(r.started_at),
    attribution: r.attribution ?? null,
  };
}

export async function recordDriftRun(
  run: {
    id: string;
    engine: string;
    status: string;
    driftShare: number | null;
    baseline: number;
    current: number;
    attribution: DriftAttribution | Record<string, unknown> | null;
  },
  orgId: string = DEFAULT_ORG,
): Promise<void> {
  await ensureDriftSchema();
  const attribution = run.attribution ? JSON.stringify(run.attribution) : null;
  await db.execute(
    sql`INSERT INTO drift_runs (id, org_id, engine, status, drift_share, baseline, current, attribution)
        VALUES (${run.id}, ${orgId}, ${run.engine}, ${run.status}, ${run.driftShare}, ${run.baseline}, ${run.current}, ${attribution}::jsonb);`,
  );
}

export async function listDriftRuns(limit = 20, orgId: string = DEFAULT_ORG): Promise<DriftRun[]> {
  await ensureDriftSchema();
  const { rows } = await db.execute<DriftRunRow>(
    sql`SELECT id, org_id, engine, status, drift_share, baseline, current, started_at, attribution
        FROM drift_runs WHERE org_id = ${orgId} ORDER BY started_at DESC LIMIT ${limit};`,
  );
  return rows.map(toDriftRun);
}

export async function getDriftRun(id: string, orgId: string = DEFAULT_ORG): Promise<DriftRun | null> {
  await ensureDriftSchema();
  const { rows } = await db.execute<DriftRunRow>(
    sql`SELECT id, org_id, engine, status, drift_share, baseline, current, started_at, attribution
        FROM drift_runs WHERE id = ${id} AND org_id = ${orgId} LIMIT 1;`,
  );
  return rows[0] ? toDriftRun(rows[0]) : null;
}

export async function deleteDriftRun(id: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensureDriftSchema();
  const { rowCount } = await db.execute(
    sql`DELETE FROM drift_runs WHERE id = ${id} AND org_id = ${orgId};`,
  );
  return (rowCount ?? 0) > 0;
}
