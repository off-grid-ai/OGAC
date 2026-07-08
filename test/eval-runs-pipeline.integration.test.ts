import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// PA-12 INTEGRATION test — the REAL eval_runs pipeline-tagging write/read path against a REAL
// Postgres. Exercises src/lib/evals.ts (recordEvalRun → listEvalRuns/getEvalRun) with no mocks:
//   • an eval run in a pipeline's context persists eval_runs.pipeline_id;
//   • a no-pipeline (library) run leaves pipeline_id NULL (unchanged behaviour);
//   • listEvalRuns(limit, org, pipelineId) isolates ONE pipeline's history (per-pipeline Drift);
//   • cross-pipeline isolation on read — pipeline A never sees pipeline B's runs.
// ensureEvalsSchema() self-migrates the pipeline_id column, so a real DB with the console schema is
// all that's needed. Skips (green) when no DB is up. Tracks + deletes only the ids it creates.

const dbUp = await dbReachable();

test('eval_runs pipeline tagging + per-pipeline isolation (real Postgres)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { ensureEvalsSchema, recordEvalRun, listEvalRuns, getEvalRun } = await import('@/lib/evals');
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');

  await ensureEvalsSchema();

  // Unique org + pipeline ids so this suite never collides with real rows or other tenants.
  const marker = `pa12-${Date.now()}`;
  const orgId = `org-${marker}`;
  const plA = `pl_${marker}_a`;
  const plB = `pl_${marker}_b`;
  const ids: string[] = [];

  const record = async (pipelineId: string | null | undefined) => {
    const id = `ed_run_${marker}_${ids.length}`;
    ids.push(id);
    await recordEvalRun({ id, engine: 'faithfulness:heuristic', score: 80, total: 5, passed: 4, pipelineId }, orgId);
    return id;
  };

  t.after(async () => {
    for (const id of ids) await db.execute(sql`DELETE FROM eval_runs WHERE id = ${id};`).catch(() => {});
  });

  // ── CREATE: two pipeline-scoped runs + one library (no-pipeline) run ─────────────────────────
  const aId = await record(plA);
  await record(plA);
  const bId = await record(plB);
  const libId = await record(null);

  // ── the pipeline-scoped run persisted its pipeline_id ────────────────────────────────────────
  const a = await getEvalRun(aId, orgId);
  assert.ok(a, 'pipeline-A run exists');
  assert.equal(a.pipelineId, plA, 'run in pipeline A context carries pipeline_id = plA');

  // ── the library run left pipeline_id NULL (unchanged behaviour for un-piped runs) ────────────
  const lib = await getEvalRun(libId, orgId);
  assert.ok(lib);
  assert.equal(lib.pipelineId, null, 'a no-pipeline run has NULL pipeline_id');

  // ── per-pipeline history: only pipeline A's runs ─────────────────────────────────────────────
  const aRuns = await listEvalRuns(50, orgId, plA);
  assert.equal(aRuns.length, 2, 'pipeline A has exactly its two runs');
  assert.ok(aRuns.every((r) => r.pipelineId === plA), 'every A-scoped run is tagged plA');
  assert.ok(!aRuns.some((r) => r.id === bId), 'cross-pipeline isolation: A never sees B');
  assert.ok(!aRuns.some((r) => r.id === libId), 'A never sees the library run');

  // ── null filter returns ONLY the library run for this org ────────────────────────────────────
  const libRuns = await listEvalRuns(50, orgId, null);
  assert.deepEqual(libRuns.map((r) => r.id), [libId], 'null filter = only the org-wide/library run');

  // ── omitting the filter returns ALL of the org's runs (global roll-up, unchanged) ────────────
  const allRuns = await listEvalRuns(50, orgId);
  assert.equal(allRuns.length, 4, 'no pipeline filter = all four org runs');
});
