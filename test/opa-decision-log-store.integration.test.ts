import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the OPA decision-log ledger store — REAL Postgres against the self-migrating
// opa_decision_logs table. Exercises: persist (insert), idempotent re-delivery (upsert, no dupe),
// list with the pure query filters, get-by-id detail, aggregate, and governed delete. Skips (green)
// when no DB is up. All rows under a dedicated org so real data is never touched.

const ORG = 'test-int-opa-audit';

const dbUp = await dbReachable();

test('opa decision-log store: ingest → list/filter → detail → aggregate → delete', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async (t) => {
  const {
    ensureOpaDecisionLogSchema,
    persistDecisions,
    listDecisions,
    getDecision,
    aggregateForOrg,
    deleteDecision,
  } = await import('@/lib/opa-decision-log-store');
  const { validateDecisionQuery, normalizeDecisionEvents } = await import('@/lib/opa-audit');
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');

  await ensureOpaDecisionLogSchema();
  t.after(async () => {
    await db.execute(sql`DELETE FROM opa_decision_logs WHERE org_id = ${ORG};`);
  });
  // clean slate in case a prior run left rows
  await db.execute(sql`DELETE FROM opa_decision_logs WHERE org_id = ${ORG};`);

  // ── ingest a real OPA-shaped upload (the sink path) ──
  const upload = [
    {
      decision_id: 'dec-allow-1',
      path: 'offgrid/authz',
      input: { role: 'admin', resource: 'secrets' },
      result: { allow: true },
      reason: 'OPA decision (offgrid/authz): true',
      requested_by: '10.0.0.5',
      timestamp: '2026-07-10T10:00:00Z',
      labels: { id: 'node-1', version: '0.70.0' },
    },
    {
      decision_id: 'dec-deny-1',
      path: 'offgrid/authz',
      input: { role: 'viewer', resource: 'secrets' },
      result: { allow: false },
      reason: 'OPA decision (offgrid/authz): false',
      timestamp: '2026-07-11T10:00:00Z',
      labels: { id: 'node-1', version: '0.70.0' },
    },
  ];
  const events = normalizeDecisionEvents(upload);
  const written = await persistDecisions(events, ORG);
  assert.equal(written, 2);

  // ── idempotent re-delivery: same decision_ids upsert, count stays 2 ──
  await persistDecisions(events, ORG);
  const all = await listDecisions(validateDecisionQuery({}), ORG);
  assert.equal(all.length, 2, 'no duplicate rows after re-delivery');

  // ── list filters (the pure query, over real rows) ──
  const allows = await listDecisions(validateDecisionQuery({ decision: 'allow' }), ORG);
  assert.equal(allows.length, 1);
  assert.equal(allows[0].decisionId, 'dec-allow-1');
  const denies = await listDecisions(validateDecisionQuery({ decision: 'deny' }), ORG);
  assert.equal(denies.length, 1);
  assert.equal(denies[0].decisionId, 'dec-deny-1');

  // ── detail: full input/result round-trips through jsonb ──
  const detail = await getDecision('dec-allow-1', ORG);
  assert.ok(detail);
  assert.equal(detail.allow, true);
  assert.deepEqual(detail.input, { role: 'admin', resource: 'secrets' });
  assert.deepEqual(detail.result, { allow: true });
  assert.equal(detail.actor, '10.0.0.5');
  assert.equal(detail.timestamp, '2026-07-10T10:00:00.000Z');
  assert.deepEqual(detail.labels, { id: 'node-1', version: '0.70.0' });
  // unknown id → null
  assert.equal(await getDecision('nope', ORG), null);

  // ── aggregate over the org ──
  const agg = await aggregateForOrg(ORG);
  assert.equal(agg.total, 2);
  assert.equal(agg.allow, 1);
  assert.equal(agg.deny, 1);
  assert.equal(agg.byPath['offgrid/authz'], 2);

  // ── governed delete ──
  assert.equal(await deleteDecision('dec-allow-1', ORG), true);
  assert.equal(await deleteDecision('dec-allow-1', ORG), false); // already gone
  const afterDelete = await listDecisions(validateDecisionQuery({}), ORG);
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].decisionId, 'dec-deny-1');

  // ── bare event: no input/result/timestamp → the null-write branches ──
  const bare = normalizeDecisionEvents([{ decision_id: 'dec-bare', path: 'offgrid/authz' }]);
  await persistDecisions(bare, ORG);
  const bareRow = await getDecision('dec-bare', ORG);
  assert.ok(bareRow);
  assert.equal(bareRow.input, null);
  assert.equal(bareRow.result, null);
  assert.equal(bareRow.timestamp, ''); // no decided_at → '' via toEvent
  assert.deepEqual(bareRow.labels, {});
});

// Empty org string falls back to DEFAULT_ORG — exercises the `orgId || DEFAULT_ORG` branch and the
// default-parameter path without touching the dedicated test org. Reads only (no writes asserted).
test('opa decision-log store: empty/absent org resolves to default (read paths)', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async () => {
  const { persistDecisions, listDecisions, getDecision, aggregateForOrg, deleteDecision } =
    await import('@/lib/opa-decision-log-store');
  const { validateDecisionQuery, normalizeDecisionEvents } = await import('@/lib/opa-audit');
  // empty-string org → DEFAULT_ORG branch
  assert.ok(Array.isArray(await listDecisions(validateDecisionQuery({}), '')));
  // default-parameter path (no org arg) — persist to the 'default' org with a unique id, then purge,
  // exercising persistDecisions' default org parameter without leaving residue.
  const uniqueId = `dec-default-probe-${Date.now()}`;
  const probe = normalizeDecisionEvents([
    { decision_id: uniqueId, path: 'offgrid/authz', result: { allow: true } },
  ]);
  assert.equal(await persistDecisions(probe), 1); // default org
  assert.ok(await getDecision(uniqueId)); // default org read
  assert.ok(typeof (await aggregateForOrg()).total === 'number');
  assert.equal(await deleteDecision(uniqueId), true); // default org delete (cleanup)
  assert.equal(await getDecision('definitely-absent-id'), null);
});
