import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for feature-flag CRUD (src/lib/store.ts) against a REAL Postgres — the flag
// management surface's create → read → toggle → delete path. Skips green if the DB is down.

const KEY = 'test-flag-crud';

const dbUp = await dbReachable();

test('feature-flag CRUD against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { listFlags, setFlag, deleteFlag, isEnabled } = await import('@/lib/store');

  t.after(async () => {
    await deleteFlag(KEY);
  });

  // ── CREATE (upsert with description) ──────────────────────────────────────────────────────────
  await setFlag(KEY, true, 'gates the test capability');
  let flags = await listFlags();
  const created = flags.find((f) => f.key === KEY);
  assert.ok(created, 'flag appears after create');
  assert.equal(created!.enabled, true);
  assert.equal(created!.description, 'gates the test capability');
  assert.equal(await isEnabled(KEY), true, 'isEnabled reads it back');

  // ── TOGGLE (bare enabled change preserves the description) ─────────────────────────────────────
  await setFlag(KEY, false);
  flags = await listFlags();
  const toggled = flags.find((f) => f.key === KEY);
  assert.equal(toggled!.enabled, false, 'toggled off');
  assert.equal(
    toggled!.description,
    'gates the test capability',
    'a bare toggle does not wipe the description',
  );
  assert.equal(await isEnabled(KEY), false);

  // ── DELETE ────────────────────────────────────────────────────────────────────────────────────
  assert.equal(await deleteFlag(KEY), true, 'delete reports a hit');
  assert.equal((await listFlags()).some((f) => f.key === KEY), false, 'gone after delete');
  assert.equal(await deleteFlag(KEY), false, 'second delete misses');
  // unset flag falls back to the provided default
  assert.equal(await isEnabled(KEY, true), true, 'unset flag uses the fallback');
});
