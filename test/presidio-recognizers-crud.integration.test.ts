import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the DEEP guardrails layer — exercises the REAL create → read → update →
// toggle → delete write-paths for custom recognizers AND the threshold upsert against a REAL
// Postgres (the module self-creates its tables via ensureRecognizersSchema's CREATE TABLE IF NOT
// EXISTS). Imports the real lib through the @/* resolver hook. Skips (green) when no DB is up.
//
// All rows are written under a dedicated org id so real data is never touched.

const ORG = 'test-int-presidio';

const dbUp = await dbReachable();

test('presidio recognizers + thresholds CRUD against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    ensureRecognizersSchema,
    createRecognizer,
    listRecognizers,
    updateRecognizer,
    setRecognizerEnabled,
    deleteRecognizer,
    getThresholds,
    setThresholds,
    validateRecognizer,
    DEFAULT_THRESHOLDS,
  } = await import('@/lib/presidio-recognizers');

  await ensureRecognizersSchema();

  t.after(async () => {
    for (const r of await listRecognizers(ORG)) await deleteRecognizer(r.id, ORG);
    await setThresholds(DEFAULT_THRESHOLDS, ORG);
  });

  // ── validation gate ──────────────────────────────────────────────────────────────────────────
  const bad = validateRecognizer({ kind: 'pattern', entity: 'X', regex: '(' });
  assert.equal(bad.ok, false, 'uncompilable regex rejected');
  const draft = validateRecognizer({
    kind: 'pattern',
    entity: 'employee_id',
    regex: '\\bEMP-\\d{6}\\b',
    context: 'employee, staff',
    score: 0.8,
  });
  assert.ok(draft.ok && draft.value.entity === 'EMPLOYEE_ID');

  // ── CREATE ──────────────────────────────────────────────────────────────────────────────────
  assert.ok(draft.ok);
  const created = await createRecognizer(draft.value, ORG);
  assert.match(created.id, /^rec_/);
  assert.equal(created.kind, 'pattern');
  assert.equal(created.entity, 'EMPLOYEE_ID');
  assert.equal(created.regex, '\\bEMP-\\d{6}\\b');
  assert.deepEqual(created.context, ['employee', 'staff'], 'context list round-trips through JSONB');
  assert.equal(created.score, 0.8);
  assert.equal(created.enabled, true);

  // ── READ (org-scoped) ─────────────────────────────────────────────────────────────────────────
  const listed = await listRecognizers(ORG);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);

  // ── UPDATE (switch to a deny-list recognizer) ─────────────────────────────────────────────────
  const nextDraft = validateRecognizer({
    kind: 'deny_list',
    entity: 'CODENAME',
    name: 'secret_projects',
    denyList: 'Orion, Zeus',
    score: 0.95,
  });
  assert.ok(nextDraft.ok);
  const updated = await updateRecognizer(created.id, nextDraft.value, ORG);
  assert.ok(updated, 'update returns the row');
  assert.equal(updated!.kind, 'deny_list');
  assert.deepEqual(updated!.denyList, ['Orion', 'Zeus']);
  assert.equal(updated!.regex, '');
  const afterUpdate = (await listRecognizers(ORG))[0];
  assert.equal(afterUpdate.kind, 'deny_list', 'update persisted');

  // ── UPDATE (toggle) + tenancy ─────────────────────────────────────────────────────────────────
  const disabled = await setRecognizerEnabled(created.id, false, ORG);
  assert.equal(disabled!.enabled, false);
  assert.equal((await listRecognizers(ORG))[0].enabled, false, 'toggle persisted');
  assert.equal(
    await setRecognizerEnabled(created.id, true, 'test-int-presidio-other'),
    null,
    'cross-org toggle misses',
  );

  // ── THRESHOLDS upsert ─────────────────────────────────────────────────────────────────────────
  const emptyCfg = await getThresholds(ORG);
  assert.equal(emptyCfg.global, 0, 'no row → default global 0');
  const saved = await setThresholds({ global: 0.5, perEntity: { person: 0.85, 'bad!': 0.9 } }, ORG);
  assert.equal(saved.global, 0.5);
  assert.deepEqual(saved.perEntity, { PERSON: 0.85 }, 'bad key dropped, good key upper-cased');
  const reread = await getThresholds(ORG);
  assert.equal(reread.global, 0.5);
  assert.equal(reread.perEntity.PERSON, 0.85, 'thresholds round-trip through the DB');
  // upsert again (ON CONFLICT) — no duplicate-key error, value replaced.
  const saved2 = await setThresholds({ global: 0.2, perEntity: {} }, ORG);
  assert.equal(saved2.global, 0.2);
  assert.deepEqual((await getThresholds(ORG)).perEntity, {}, 'per-entity replaced on upsert');

  // ── DELETE ───────────────────────────────────────────────────────────────────────────────────
  assert.equal(await deleteRecognizer(created.id, ORG), true);
  assert.equal((await listRecognizers(ORG)).length, 0, 'gone after delete');
  assert.equal(await deleteRecognizer(created.id, ORG), false, 'second delete misses');
});
