import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for SIEM suppression CRUD (src/lib/siem-suppress.ts) against a REAL Postgres.
// The module self-creates its `siem_suppressions` table (CREATE TABLE IF NOT EXISTS), so this
// proves the create→read→delete write-paths work end-to-end. Skips green if the DB is down.

const ORG = 'test-int-siem-suppress';

const dbUp = await dbReachable();

test('siem suppression CRUD against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { ensureSiemSuppressSchema, listSuppressions, createSuppression, deleteSuppression } =
    await import('@/lib/siem-suppress');

  await ensureSiemSuppressSchema();
  t.after(async () => {
    for (const r of await listSuppressions(ORG)) await deleteSuppression(r.id, ORG);
  });

  // ── validation gate rejects bad input before touching the DB ─────────────────────────────────
  const bad = await createSuppression({ kind: 'bogus' as never, pattern: 'x' }, ORG);
  assert.equal(bad.ok, false, 'invalid kind rejected');

  // ── CREATE ───────────────────────────────────────────────────────────────────────────────────
  const created = await createSuppression(
    { kind: 'ip', pattern: '10.0.0.5', note: 'known scanner' },
    ORG,
  );
  assert.equal(created.ok, true);
  assert.match(created.rule!.id, /^sup_/, 'id is prefixed');
  assert.equal(created.rule!.kind, 'ip');
  assert.equal(created.rule!.pattern, '10.0.0.5');

  // ── READ (org-scoped) ──────────────────────────────────────────────────────────────────────────
  const listed = await listSuppressions(ORG);
  assert.equal(listed.length, 1, 'org sees exactly its one rule');
  assert.equal(listed[0].id, created.rule!.id);
  assert.equal(listed[0].note, 'known scanner');

  // Cross-org isolation: another org sees nothing.
  assert.equal((await listSuppressions('test-int-siem-other')).length, 0, 'other org isolated');

  // ── DELETE ───────────────────────────────────────────────────────────────────────────────────
  assert.equal(await deleteSuppression(created.rule!.id, ORG), true, 'delete reports a hit');
  assert.equal((await listSuppressions(ORG)).length, 0, 'empty after delete');
  // cross-org / vanished delete is a clean false
  assert.equal(await deleteSuppression(created.rule!.id, ORG), false, 'second delete misses');
});
