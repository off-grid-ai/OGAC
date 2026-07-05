import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the canonical audit persistence path in src/lib/store.ts — exercises the REAL
// persistAuditEvent write against a REAL Postgres (creates audit_events_v2 idempotently, inserts,
// reads back), through the @/* resolver hook. Proves attributed audit events actually land in the
// source-of-truth table with actor + org + action + derived cost.
//
// Runs against the app's DATABASE_URL. Skips green if the DB is down. Rows are written under a
// dedicated org id so real data is never touched.

const ORG = 'test-int-audit';

const dbUp = await dbReachable();

test('persistAuditEvent writes a canonical, attributed row to audit_events_v2', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { persistAuditEvent } = await import('@/lib/store');
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');

  t.after(async () => {
    await db.execute(sql`DELETE FROM audit_events_v2 WHERE org = ${ORG}`);
  });

  // ── WRITE — a chat.send by a real user, with tokens (cost derived by the builder) ──
  const ev = await persistAuditEvent({
    actor: { type: 'user', id: 'int-tester@example.com', label: 'Int Tester' },
    org: ORG,
    project: 'proj-int',
    action: 'chat.send',
    resource: 'conv:int-1',
    model: 'gpt-4o',
    tokens: { prompt: 1000, completion: 1000 },
    outcome: 'ok',
  });
  assert.equal(ev.actor.id, 'int-tester@example.com');
  assert.equal(ev.costUsd, 0.01); // 2000/1000 * 0.005

  // ── READ BACK — the row is really in Postgres, attributed ──
  const res = await db.execute(sql`
    SELECT actor_type, actor_id, org, project, action, resource, model,
           prompt_tokens, completion_tokens, total_tokens, cost_usd, outcome
    FROM audit_events_v2 WHERE org = ${ORG} AND action = 'chat.send' LIMIT 1`);
  const rows = (res as unknown as { rows?: Record<string, unknown>[] }).rows ??
    (res as unknown as Record<string, unknown>[]);
  const row = rows[0];
  assert.ok(row, 'a chat.send row was persisted');
  assert.equal(row.actor_type, 'user');
  assert.equal(row.actor_id, 'int-tester@example.com');
  assert.equal(row.org, ORG);
  assert.equal(row.project, 'proj-int');
  assert.equal(row.action, 'chat.send');
  assert.equal(row.model, 'gpt-4o');
  assert.equal(Number(row.total_tokens), 2000);
  assert.equal(Number(row.cost_usd), 0.01);
  assert.equal(row.outcome, 'ok');

  // ── A governance write with no tokens persists cleanly (nullable token/cost cols) ──
  await persistAuditEvent({
    actor: { type: 'machine', id: 'svc-runner', label: 'Runner' },
    org: ORG,
    action: 'policy.change',
    resource: 'policy:v3',
    outcome: 'ok',
  });
  const res2 = await db.execute(sql`
    SELECT actor_type, total_tokens, cost_usd FROM audit_events_v2
    WHERE org = ${ORG} AND action = 'policy.change' LIMIT 1`);
  const rows2 = (res2 as unknown as { rows?: Record<string, unknown>[] }).rows ??
    (res2 as unknown as Record<string, unknown>[]);
  assert.equal(rows2[0]?.actor_type, 'machine');
  assert.equal(rows2[0]?.total_tokens, null, 'no tokens → null, not 0');
  assert.equal(rows2[0]?.cost_usd, null, 'no cost without tokens');
});
