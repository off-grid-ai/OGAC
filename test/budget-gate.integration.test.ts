import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
// @ts-expect-error — shared JS reachability helper intentionally has no declaration file
import { dbAvailable } from './helpers/db-available.mjs';

// Console-native budget ENFORCEMENT, end-to-end against a real Postgres. The pure decision
// (checkBudget) is unit-tested elsewhere; THIS proves the DB-backed gate the agent-run path calls:
// projectBudget reads the project's real virtual-key budget, prices the incoming call, and — when
// enforcement is on — DENIES a run that would exceed it. A cloud ($>0) cost over a $0 budget is the
// canonical block; a local ($0) cost is always admitted; the per-org enforce toggle is honored.
const { ok, reason } = await dbAvailable();
const skip = ok ? undefined : reason;

describe('console-native budget enforcement gate (real Postgres)', { skip }, () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const org = `budorg_${suffix}`;
  const project = `budproj_${suffix}`;
  const keyId = `budkey_${suffix}`;
  let db: typeof import('../src/db/index.ts').db;
  let apiKeys: typeof import('../src/db/schema.ts').apiKeys;
  let projectBudget: typeof import('../src/lib/chat-governance.ts').projectBudget;
  const prevEnv = process.env.OFFGRID_BUDGET_ENFORCE;

  before(async () => {
    ({ db } = await import('../src/db/index.ts'));
    ({ apiKeys } = await import('../src/db/schema.ts'));
    ({ projectBudget } = await import('../src/lib/chat-governance.ts'));
    // A project virtual key with a ZERO-USD budget → any real (cloud) cost exceeds it.
    await db
      .insert(apiKeys)
      .values({
        id: keyId,
        orgId: org,
        name: 'budget-gate-test',
        prefix: 'ogak_test',
        subjectType: 'project',
        subject: project,
        budgetUsd: 0,
      })
      .onConflictDoNothing();
  });

  after(async () => {
    await db.execute(sql`DELETE FROM api_keys WHERE id = ${keyId}`);
    if (prevEnv === undefined) delete process.env.OFFGRID_BUDGET_ENFORCE;
    else process.env.OFFGRID_BUDGET_ENFORCE = prevEnv;
  });

  test('enforced + cloud ($0.50) cost over a $0 budget → DENIED', async () => {
    process.env.OFFGRID_BUDGET_ENFORCE = 'on';
    const g = await projectBudget(project, 0.5, org);
    assert.equal(g.enforced, true);
    assert.equal(g.ok, false, 'run must be blocked when it would exceed budget');
    assert.equal(g.reason, 'over-budget');
    assert.equal(g.limit, 0);
  });

  test('enforced + local ($0) cost → ADMITTED (on-prem is free, never blocked)', async () => {
    process.env.OFFGRID_BUDGET_ENFORCE = 'on';
    const g = await projectBudget(project, 0, org);
    assert.equal(g.ok, true);
    assert.equal(g.reason, 'zero-cost');
  });

  test('enforcement OFF → same over-budget call is ADMITTED (toggle honored, still reported)', async () => {
    process.env.OFFGRID_BUDGET_ENFORCE = 'off';
    const g = await projectBudget(project, 0.5, org);
    assert.equal(g.enforced, false);
    assert.equal(g.ok, true, 'off ⇒ never blocks (cannot surprise the demo)');
    assert.equal(g.reason, 'over-budget'); // the underlying decision is still surfaced for logging
  });

  test('no budget key for the project → ADMITTED (unlimited)', async () => {
    process.env.OFFGRID_BUDGET_ENFORCE = 'on';
    const g = await projectBudget(`no_such_project_${suffix}`, 5, org);
    assert.equal(g.ok, true);
    assert.equal(g.reason, 'no-key');
  });
});
