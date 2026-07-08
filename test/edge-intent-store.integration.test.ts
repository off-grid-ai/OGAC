import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the edge-WAF intent persistence in src/lib/store.ts — exercises the REAL
// getEdgeIntent / saveEdgeIntent against a REAL Postgres (creates edge_intent idempotently, upserts
// the single row, reads it back). Proves the operator's WAF intent actually persists so it can be
// applied on the next edge reload. Skips green if the DB is down.

const dbUp = await dbReachable();

test('saveEdgeIntent persists and getEdgeIntent reads it back', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { getEdgeIntent, saveEdgeIntent } = await import('@/lib/store');
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');

  // Snapshot + restore the single default row so we never clobber real intent.
  const original = await getEdgeIntent();
  t.after(async () => { await saveEdgeIntent(original); });

  const intent = {
    wafEnabled: false,
    rules: [{ id: 'int-test-rule', name: 'Int Test Rule', pattern: 'path = /int-test', enabled: true }],
    updatedAt: new Date().toISOString(),
  };
  await saveEdgeIntent(intent);

  const read = await getEdgeIntent();
  assert.equal(read.wafEnabled, false);
  assert.equal(read.rules.length, 1);
  assert.equal(read.rules[0].id, 'int-test-rule');
  assert.equal(read.rules[0].name, 'Int Test Rule');

  // Upsert (single row) — a second save replaces, not appends.
  await saveEdgeIntent({ ...intent, wafEnabled: true, rules: [] });
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM edge_intent WHERE id = 'default'`);
  const rows = (res as unknown as { rows?: { n?: unknown }[] }).rows ?? (res as unknown as { n?: unknown }[]);
  assert.equal(Number(rows[0]?.n), 1);
  const after = await getEdgeIntent();
  assert.equal(after.wafEnabled, true);
  assert.equal(after.rules.length, 0);
});
