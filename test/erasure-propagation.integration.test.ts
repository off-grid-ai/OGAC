import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';
import { propagateErasure, type PropagationAdapters } from '../src/lib/erasure.ts';

// INTEGRATION test for the DSAR external-plane propagation ORCHESTRATOR. It drives the REAL pure plan
// + REAL summarizer, injects FAKE vector/lake adapters (external services aren't up in CI), and — when
// Postgres is reachable — exercises the REAL device tombstone path end-to-end. Proves the honesty bar:
// a configured target's delete really runs and is counted; an unconfigured/failed one is `deferred`
// with a reason, NEVER counted as erased.

const ORG = 'test-int-erasure-prop';

// A fully-configured fake adapter set (external deletes succeed) — used to prove the orchestrator
// routes each step and aggregates propagated results.
function fakeAdapters(over: Partial<PropagationAdapters> = {}): PropagationAdapters {
  return {
    isVectorConfigured: async () => true,
    eraseVectors: async () => ({ ok: true, removed: 7, error: null }),
    isLakeConfigured: async () => true,
    eraseLake: async () => ({ ok: true, removed: 3, error: null }),
    eraseDevice: async () => ({ ok: true, removed: 1, error: null }),
    ...over,
  };
}

test('propagateErasure: all external targets configured → each delete runs, counted as propagated', async () => {
  const report = await propagateErasure('Alice@Corp.in', 'ops@corp.in', ORG, fakeAdapters());
  assert.equal(report.subject, 'alice@corp.in');
  const propagatedTargets = report.propagated.map((r) => r.target).sort();
  assert.deepEqual(propagatedTargets, ['device', 'lake', 'vector']);
  assert.equal(report.deferred.length, 0);
  assert.equal(report.propagated.find((r) => r.target === 'vector')?.removed, 7);
  assert.equal(report.propagated.find((r) => r.target === 'lake')?.removed, 3);
});

test('propagateErasure: unconfigured vector + lake → deferred with reason, NOT erased (honest)', async () => {
  const report = await propagateErasure(
    'bob@corp.in',
    'ops@corp.in',
    ORG,
    fakeAdapters({ isVectorConfigured: async () => false, isLakeConfigured: async () => false }),
  );
  // Only device (always actionable via the queue) propagates.
  assert.deepEqual(report.propagated.map((r) => r.target), ['device']);
  const deferredTargets = report.deferred.map((r) => r.target).sort();
  assert.deepEqual(deferredTargets, ['lake', 'vector']);
  for (const d of report.deferred) {
    assert.equal(d.outcome, 'deferred');
    assert.equal(d.removed, 0);
    assert.ok(d.reason && /deferred|not configured/i.test(d.reason));
  }
});

test('propagateErasure: a configured target that FAILS is deferred (error), never counted erased', async () => {
  const report = await propagateErasure(
    'carol@corp.in',
    'ops@corp.in',
    ORG,
    fakeAdapters({ eraseVectors: async () => ({ ok: false, removed: null, error: 'qdrant delete 500' }) }),
  );
  assert.ok(!report.propagated.some((r) => r.target === 'vector'), 'failed vector is NOT propagated');
  const v = report.deferred.find((r) => r.target === 'vector');
  assert.ok(v);
  assert.equal(v.outcome, 'error');
  assert.equal(v.reason, 'qdrant delete 500');
});

// ── REAL device tombstone path against Postgres ────────────────────────────────────────────────
const dbUp = await dbReachable();

test('propagateErasure: REAL device adapter records a durable tombstone in Postgres', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async (t) => {
  const store = await import('@/lib/erasure-tombstone-store');
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');

  t.after(async () => {
    await db.execute(sql`DELETE FROM erasure_tombstones WHERE org_id = ${ORG}`);
  });

  // Real device adapter (default), fake external deletes so the test needs no Qdrant/SeaweedFS.
  const { eraseSubjectDeviceReplicas } = await import('@/lib/adapters/erasure-device');
  const report = await propagateErasure('Dave@Corp.in', 'dpo@corp.in', ORG, {
    isVectorConfigured: async () => false,
    eraseVectors: async () => ({ ok: true, removed: 0, error: null }),
    isLakeConfigured: async () => false,
    eraseLake: async () => ({ ok: true, removed: 0, error: null }),
    eraseDevice: eraseSubjectDeviceReplicas, // the REAL one → writes a tombstone row
  });

  const device = report.propagated.find((r) => r.target === 'device');
  assert.ok(device, 'device propagation succeeded');
  assert.equal(device.removed, 1);

  // The tombstone is really in Postgres, pending, keyed by the normalised subject.
  const pending = await store.listTombstones(ORG, true);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].subject, 'dave@corp.in');
  assert.equal(pending[0].status, 'pending');
  assert.equal(pending[0].requestedBy, 'dpo@corp.in');
  assert.equal(await store.countPendingTombstones(ORG), 1);

  // A device acknowledges it → status flips, count drops.
  const ack = await store.acknowledgeTombstone(pending[0].id, ORG);
  assert.equal(ack?.status, 'acknowledged');
  assert.ok(ack?.acknowledgedAt);
  assert.equal(await store.countPendingTombstones(ORG), 0);
});
