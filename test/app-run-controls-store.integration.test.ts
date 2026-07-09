import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the app-run-controls store — REAL Postgres CRUD (self-creating table via
// ensureAppRunControlsSchema) + the live usage counters (runs-today from app_runs). Skips (green)
// when no DB is up. All rows under a dedicated org so real data is never touched.

const ORG = 'test-int-controls';
const APP = 'app_ctrl_int';

const dbUp = await dbReachable();

test('app-run-controls store: CRUD + usage counting against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    ensureAppRunControlsSchema,
    getControls,
    upsertControls,
    deleteControls,
    usageFor,
  } = await import('@/lib/app-run-controls-store');
  const { db } = await import('@/db');
  const { appRuns, appRunControls } = await import('@/db/schema');
  const { and, eq } = await import('drizzle-orm');

  await ensureAppRunControlsSchema();

  t.after(async () => {
    await deleteControls(APP, ORG);
    await db.delete(appRuns).where(and(eq(appRuns.appId, APP), eq(appRuns.orgId, ORG)));
    await db.delete(appRunControls).where(eq(appRunControls.orgId, ORG));
  });

  // ── absent row → DEFAULT_CONTROLS (permissive) ──
  const def = await getControls(APP, ORG);
  assert.equal(def.enabled, true);
  assert.equal(def.maxRunsPerDay, null);
  assert.equal(def.spendCapUsd, null);
  assert.equal(def.shadowDefault, false);

  // ── upsert (create) ──
  const set = await upsertControls(APP, ORG, {
    enabled: false,
    shadowDefault: true,
    maxRunsPerDay: 5,
    spendCapUsd: 10,
    spendCapScope: 'run',
  });
  assert.equal(set.enabled, false);
  assert.equal(set.shadowDefault, true);
  assert.equal(set.maxRunsPerDay, 5);
  assert.equal(set.spendCapUsd, 10);
  assert.equal(set.spendCapScope, 'run');

  // ── read back ──
  const got = await getControls(APP, ORG);
  assert.deepEqual(got, set);

  // ── patch (partial merge keeps untouched dials) ──
  const patched = await upsertControls(APP, ORG, { enabled: true });
  assert.equal(patched.enabled, true);
  assert.equal(patched.maxRunsPerDay, 5, 'untouched cap preserved through a partial patch');
  assert.equal(patched.shadowDefault, true);

  // ── org scoping: another org sees defaults, not this row ──
  const other = await getControls(APP, 'test-int-controls-other');
  assert.equal(other.maxRunsPerDay, null);

  // ── usage counting: insert two app_runs today, count them ──
  const today = new Date();
  for (const id of ['ru_a', 'ru_b']) {
    await db.insert(appRuns).values({ id, orgId: ORG, appId: APP, status: 'done', startedAt: today }).onConflictDoNothing();
  }
  const usage = await usageFor(APP, ORG, 0);
  assert.ok(usage.runsToday >= 2, `runsToday counts today's runs (got ${usage.runsToday})`);
  assert.equal(typeof usage.spentTodayUsd, 'number');
  assert.equal(usage.incomingRunCostUsd, 0);

  // ── delete → reverts to defaults ──
  await deleteControls(APP, ORG);
  const afterDelete = await getControls(APP, ORG);
  assert.equal(afterDelete.enabled, true);
  assert.equal(afterDelete.maxRunsPerDay, null);
});
