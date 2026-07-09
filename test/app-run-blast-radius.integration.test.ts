import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the RUN-START blast-radius gate — the EXACT seam the run route chains:
//   getControls(appId, org) → usageFor(appId, org) → evaluateBlastRadius(controls, usage)
// against a REAL Postgres. Proves: a disabled app is denied at run start; an over-cap app is denied;
// an under-cap / enabled app is allowed. We drive the seams the route composes (importing the Next
// route pulls `next/server`, unresolvable under `node --test`), so this proves the real behaviour the
// handler produces. Skips green when no DB is up.

const ORG = 'test-int-blast';
const APP = 'app_blast_int';

const dbUp = await dbReachable();

test('run-start blast-radius: disabled / over-cap deny, under-cap allows (real DB)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { getControls, upsertControls, deleteControls, usageFor, ensureAppRunControlsSchema } =
    await import('@/lib/app-run-controls-store');
  const { evaluateBlastRadius } = await import('@/lib/app-run-controls');
  const { db } = await import('@/db');
  const { appRuns, appRunControls } = await import('@/db/schema');
  const { and, eq } = await import('drizzle-orm');

  await ensureAppRunControlsSchema();

  t.after(async () => {
    await deleteControls(APP, ORG);
    await db.delete(appRuns).where(and(eq(appRuns.appId, APP), eq(appRuns.orgId, ORG)));
    await db.delete(appRunControls).where(eq(appRunControls.orgId, ORG));
  });

  // The route's exact composition — a tiny helper mirroring the handler's gate.
  async function gate(incomingCostUsd = 0) {
    const controls = await getControls(APP, ORG);
    const usage = await usageFor(APP, ORG, incomingCostUsd);
    return evaluateBlastRadius(controls, usage);
  }

  // ── no controls set → allow (additive default) ──
  assert.equal((await gate()).allow, true);

  // ── kill-switch: disabled → deny ──
  await upsertControls(APP, ORG, { enabled: false });
  const disabled = await gate();
  assert.equal(disabled.allow, false);
  assert.equal(disabled.code, 'disabled');

  // ── re-enable + a daily run cap of 2; insert 2 runs today → over cap → deny ──
  await upsertControls(APP, ORG, { enabled: true, maxRunsPerDay: 2 });
  const today = new Date();
  for (const id of ['blast_a', 'blast_b']) {
    await db.insert(appRuns).values({ id, orgId: ORG, appId: APP, status: 'done', startedAt: today }).onConflictDoNothing();
  }
  const overRuns = await gate();
  assert.equal(overRuns.allow, false);
  assert.equal(overRuns.code, 'runs-cap');

  // ── lift the runs cap, set a per-run spend cap of $1; a $5 run → deny ──
  await upsertControls(APP, ORG, { maxRunsPerDay: null, spendCapUsd: 1, spendCapScope: 'run' });
  const overSpend = await gate(5);
  assert.equal(overSpend.allow, false);
  assert.equal(overSpend.code, 'spend-cap');

  // ── a $0 (local) run under the same spend cap → allow (the on-prem dividend) ──
  const localOk = await gate(0);
  assert.equal(localOk.allow, true);

  // ── clear all caps → allow again ──
  await upsertControls(APP, ORG, { spendCapUsd: null });
  assert.equal((await gate(5)).allow, true);
});
