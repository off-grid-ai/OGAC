import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the app→pipeline RE-POINT of evals + golden cases (PIPELINES_AND_GATEWAYS_PLAN
// "corrected model"). Exercises the REAL write/read paths of src/lib/eval-defs.ts + src/lib/evals.ts
// against a REAL Postgres:
//   • create stamps pipeline_id (new path) and app_id (legacy) independently.
//   • listEvalDefs / listGoldenCases filter by { pipelineId } and by { pipelineId: null } (library).
//   • cross-pipeline isolation: pipeline A's evals/golden never leak into pipeline B's list.
//   • back-compat: the legacy positional appId arg still filters by app_id.
// Skips (green) when no DB is up. Tracks + deletes only the ids it creates.

const dbUp = await dbReachable();

test('eval-defs + golden cases associate + filter by pipeline_id', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    ensureEvalDefsSchema,
    addEvalDef,
    listEvalDefs,
    deleteEvalDef,
  } = await import('@/lib/eval-defs');
  const {
    ensureEvalsSchema,
    addGoldenCase,
    listGoldenCases,
    deleteGoldenCase,
  } = await import('@/lib/evals');
  const { validateEvalDef } = await import('@/lib/eval-defs-policy');
  const { validateGoldenCase } = await import('@/lib/evals-golden');

  await ensureEvalDefsSchema();
  await ensureEvalsSchema();

  const marker = `plq-${Date.now()}`;
  const pipeA = `pl_${marker}_A`;
  const pipeB = `pl_${marker}_B`;
  const appLegacy = `app_${marker}`;

  const evalIds: string[] = [];
  const goldenIds: string[] = [];
  t.after(async () => {
    for (const id of evalIds) await deleteEvalDef(id).catch(() => {});
    for (const id of goldenIds) await deleteGoldenCase(id).catch(() => {});
  });

  const mkEval = (name: string) => {
    const v = validateEvalDef({ name, templateId: 'faithfulness' });
    assert.ok(v.ok);
    return v.value;
  };
  const mkGolden = (q: string) => {
    const v = validateGoldenCase({ name: q.slice(0, 40), query: q, expected: marker, suite: 'golden' });
    assert.ok(v.ok);
    return v.value;
  };

  // ── CREATE: pipeline-scoped, app-scoped (legacy), and org-library (unattached) ─────────────────
  const eA = await addEvalDef(mkEval(`evalA ${marker}`), '', { pipelineId: pipeA });
  const eB = await addEvalDef(mkEval(`evalB ${marker}`), '', { pipelineId: pipeB });
  const eApp = await addEvalDef(mkEval(`evalApp ${marker}`), '', { appId: appLegacy });
  const eLib = await addEvalDef(mkEval(`evalLib ${marker}`), '', null); // org library
  evalIds.push(eA.id, eB.id, eApp.id, eLib.id);

  assert.equal(eA.pipelineId, pipeA, 'create stamps pipeline_id');
  assert.equal(eA.appId, null, 'pipeline eval has no app_id');
  assert.equal(eApp.appId, appLegacy, 'legacy app_id path still works');
  assert.equal(eApp.pipelineId, null);
  assert.equal(eLib.pipelineId, null);
  assert.equal(eLib.appId, null);

  const gA = await addGoldenCase(mkGolden(`goldenA ${marker}`), { pipelineId: pipeA });
  const gB = await addGoldenCase(mkGolden(`goldenB ${marker}`), { pipelineId: pipeB });
  const gLib = await addGoldenCase(mkGolden(`goldenLib ${marker}`), null);
  goldenIds.push(gA.id, gB.id, gLib.id);
  assert.equal(gA.pipelineId, pipeA, 'golden create stamps pipeline_id');
  assert.equal(gLib.pipelineId, null);

  // ── FILTER by pipeline_id: only that pipeline's rows, cross-pipeline isolation ─────────────────
  const evalsA = await listEvalDefs({ pipelineId: pipeA });
  assert.ok(evalsA.some((e) => e.id === eA.id), 'A sees its own eval');
  assert.ok(!evalsA.some((e) => e.id === eB.id), 'A does not see B (cross-pipeline isolation)');
  assert.ok(!evalsA.some((e) => e.id === eApp.id), 'A does not see the legacy app eval');
  assert.ok(!evalsA.some((e) => e.id === eLib.id), 'A does not see the org-library eval');

  const goldenA = await listGoldenCases({ pipelineId: pipeA });
  assert.ok(goldenA.some((g) => g.id === gA.id));
  assert.ok(!goldenA.some((g) => g.id === gB.id), 'golden cross-pipeline isolation');

  // ── FILTER library ({ pipelineId: null }): unattached only (neither app nor pipeline) ──────────
  const libEvals = await listEvalDefs({ pipelineId: null });
  assert.ok(libEvals.some((e) => e.id === eLib.id), 'library sees the unattached eval');
  assert.ok(!libEvals.some((e) => e.id === eA.id), 'library excludes pipeline-scoped');
  assert.ok(!libEvals.some((e) => e.id === eApp.id), 'library excludes app-scoped');

  const libGolden = await listGoldenCases({ pipelineId: null });
  assert.ok(libGolden.some((g) => g.id === gLib.id));
  assert.ok(!libGolden.some((g) => g.id === gA.id));

  // ── BACK-COMPAT: the legacy positional appId arg still filters by app_id ────────────────────────
  const appEvals = await listEvalDefs(appLegacy);
  assert.ok(appEvals.some((e) => e.id === eApp.id), 'legacy appId filter works');
  assert.ok(!appEvals.some((e) => e.id === eA.id), 'legacy filter does not leak pipeline rows');
});
