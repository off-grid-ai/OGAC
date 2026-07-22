import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// drift_projects INTEGRATION — the REAL monitoring-SoR store against a REAL Postgres, no mocks.
// Proves: create/read/update/delete round-trips; strict org-scoping (no cross-org leak/mutation); and
// that the detail composition DERIVES report history + trend from retained drift_runs (recorded via
// the existing drift-run store) and keys breach detection off the project's own threshold. Rows live
// under a dedicated org id so real data is untouched; skips (green) when no DB is up.

const dbUp = await dbReachable();

test('drift_projects CRUD + org-scoping + derived history/trend (real Postgres)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    createDriftProject,
    getDriftProject,
    listDriftProjects,
    listDriftProjectsWithSignal,
    updateDriftProject,
    deleteDriftProject,
    getDriftProjectDetail,
  } = await import('@/lib/evidently-projects-store.ts');
  const { recordDriftRun, deleteDriftRun } = await import('@/lib/drift-runs.ts');

  const marker = `dm-${Date.now()}`;
  const orgId = `org-${marker}`;
  const otherOrg = `org-${marker}-other`;

  const projects: string[] = [];
  const runs: string[] = [];
  t.after(async () => {
    for (const id of projects) await deleteDriftProject(id, orgId).catch(() => {});
    for (const id of runs) await deleteDriftRun(id, orgId).catch(() => {});
  });

  // ── create ──────────────────────────────────────────────────────────────────────────────────
  const p = await createDriftProject(
    { name: 'Fraud scoring drift', description: 'txn model', dataset: 'txns', driftThreshold: 0.3 },
    orgId,
  );
  projects.push(p.id);
  assert.equal(p.name, 'Fraud scoring drift');
  assert.equal(p.dataset, 'txns');
  assert.equal(p.driftThreshold, 0.3);

  // ── read back + list org-scoped ───────────────────────────────────────────────────────────────
  assert.equal((await getDriftProject(p.id, orgId))!.description, 'txn model');
  assert.equal((await listDriftProjects(orgId)).length, 1);
  assert.equal((await listDriftProjects(otherOrg)).length, 0, 'no cross-org leak');
  assert.equal(await getDriftProject(p.id, otherOrg), null, 'cross-org get → null');

  // ── update ────────────────────────────────────────────────────────────────────────────────────
  const updated = await updateDriftProject(p.id, orgId, {
    name: 'Fraud scoring drift v2',
    description: 'txn model',
    dataset: 'txns',
    driftThreshold: 0.5,
  });
  assert.equal(updated!.name, 'Fraud scoring drift v2');
  assert.equal(updated!.driftThreshold, 0.5);
  assert.equal(await updateDriftProject(p.id, otherOrg, {
    name: 'x', description: '', dataset: '', driftThreshold: 0.1,
  }), null, 'cannot update across org');

  // ── detail with NO runs yet → empty history, flat trend ──────────────────────────────────────
  const empty = await getDriftProjectDetail(p.id, orgId);
  assert.equal(empty!.history.length, 0);
  assert.equal(empty!.trend.direction, 'flat');
  assert.equal(empty!.trend.threshold, 0.5, 'trend keys off the project threshold');

  // ── record REAL retained drift runs, then the detail derives history + trend ────────────────────
  const older = randomUUID();
  const newer = randomUUID();
  runs.push(older, newer);
  await recordDriftRun(
    { id: older, engine: 'native', status: 'stable', driftShare: 0.1, baseline: 20, current: 20, attribution: null },
    orgId,
  );
  await recordDriftRun(
    { id: newer, engine: 'evidently', status: 'drift', driftShare: 0.6, baseline: 20, current: 20,
      attribution: { engine: 'evidently', engineProven: true, evidentlyVersion: '0.4.40', driftShare: 0.6,
        status: 'drift', method: 'DataDriftPreset', baseline: 20, current: 20, fallbackReason: null, note: 'ran' } },
    orgId,
  );

  const detail = await getDriftProjectDetail(p.id, orgId);
  assert.equal(detail!.history.length, 2, 'both retained runs surface as report history');
  assert.equal(detail!.history[0].engineProven, true, 'newest is the proven Evidently run');
  assert.equal(detail!.history[0].driftPct, 60);
  // Both runs share today's bucket → one point, mean (0.1+0.6)/2 = 0.35, worst status = drift.
  assert.equal(detail!.trend.points.length, 1);
  assert.equal(detail!.trend.points[0].runs, 2);
  assert.equal(detail!.trend.points[0].driftShare, 0.35);
  assert.equal(detail!.trend.points[0].status, 'drift');
  // threshold 0.5 → mean 0.35 does NOT breach.
  assert.equal(detail!.trend.breaches, 0);

  // ── threshold-driven breach: drop the line to 0.3 → the 0.35 mean now breaches ─────────────────
  await updateDriftProject(p.id, orgId, {
    name: 'Fraud scoring drift v2', description: 'txn model', dataset: 'txns', driftThreshold: 0.3,
  });
  const breached = await getDriftProjectDetail(p.id, orgId);
  assert.equal(breached!.trend.breaches, 1, 'lower threshold flips the same data to a breach');

  // ── list-with-signal composes the same runs per project ────────────────────────────────────────
  const withSignal = await listDriftProjectsWithSignal(orgId);
  assert.equal(withSignal.length, 1);
  assert.equal(withSignal[0].signal.reportCount, 2);
  assert.equal(withSignal[0].signal.breaches, 1);
  assert.equal(await (async () => (await listDriftProjectsWithSignal(otherOrg)).length)(), 0);

  // ── delete (org-scoped) ─────────────────────────────────────────────────────────────────────
  assert.equal(await deleteDriftProject(p.id, otherOrg), false, 'cannot delete across org');
  assert.equal(await deleteDriftProject(p.id, orgId), true);
  assert.equal(await getDriftProject(p.id, orgId), null);
});
