import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the Evals module — exercises the REAL add → read → update → delete
// write-paths of src/lib/evals.ts against a REAL Postgres. Unlike policy/guardrails, evals reuses
// the base `golden_cases` table declared in src/db/schema.ts and only WIDENS it post-hoc
// (ensureEvalsSchema does ALTER TABLE ... ADD COLUMN IF NOT EXISTS), so a real DB with the console
// schema is required; the ensure call is still exercised for real. Imports the real lib through the
// @/* resolver hook. Skips (green) when no DB is up.
//
// Golden cases are NOT org-scoped, so this suite tracks the exact ids it creates and deletes only
// those — it never touches other rows.

const dbUp = await dbReachable();

test('evals golden-case CRUD against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    ensureEvalsSchema,
    addGoldenCase,
    getGoldenCase,
    updateGoldenCase,
    deleteGoldenCase,
    listGoldenCases,
  } = await import('@/lib/evals');
  const { validateGoldenCase } = await import('@/lib/evals-golden');

  await ensureEvalsSchema();

  const createdIds: string[] = [];
  t.after(async () => {
    for (const id of createdIds) await deleteGoldenCase(id).catch(() => {});
  });

  // ── pure validation gate ────────────────────────────────────────────────────────────────────
  assert.equal(validateGoldenCase({ query: '', expected: 'x' }).ok, false, 'empty query rejected');
  const marker = `int-${Date.now()}`;
  const draft = validateGoldenCase({
    name: `case ${marker}`,
    query: `what is ${marker}?`,
    expected: marker,
    suite: 'promptfoo',
  });
  assert.ok(draft.ok);

  // ── CREATE ──────────────────────────────────────────────────────────────────────────────────
  const created = await addGoldenCase(draft.value);
  createdIds.push(created.id);
  assert.match(created.id, /^gc_/);
  assert.equal(created.name, `case ${marker}`);
  assert.equal(created.query, `what is ${marker}?`);
  assert.equal(created.expected, marker);
  assert.equal(created.suite, 'promptfoo');

  // ── READ (getGoldenCase) ──────────────────────────────────────────────────────────────────────
  const fetched = await getGoldenCase(created.id);
  assert.ok(fetched, 'reads back');
  assert.equal(fetched!.expected, marker);
  assert.equal(fetched!.suite, 'promptfoo');

  // ── READ (listGoldenCases contains it) ─────────────────────────────────────────────────────────
  const listed = await listGoldenCases();
  assert.ok(listed.some((c) => c.id === created.id), 'appears in the list');

  // ── UPDATE ────────────────────────────────────────────────────────────────────────────────────
  const nextDraft = validateGoldenCase({
    name: `renamed ${marker}`,
    query: `updated ${marker}?`,
    expected: `${marker}-v2`,
    suite: 'golden',
  });
  assert.ok(nextDraft.ok);
  const updated = await updateGoldenCase(created.id, nextDraft.value);
  assert.ok(updated, 'update returns the row');
  assert.equal(updated!.name, `renamed ${marker}`);
  assert.equal(updated!.query, `updated ${marker}?`);
  assert.equal(updated!.expected, `${marker}-v2`);
  assert.equal(updated!.suite, 'golden');
  // Confirm persistence.
  assert.equal((await getGoldenCase(created.id))!.expected, `${marker}-v2`);

  // Updating a vanished id returns null.
  assert.equal(await updateGoldenCase('gc_nope00', nextDraft.value), null, 'unknown id → null');

  // ── DELETE ───────────────────────────────────────────────────────────────────────────────────
  await deleteGoldenCase(created.id);
  assert.equal(await getGoldenCase(created.id), null, 'gone after delete');
  assert.ok(
    !(await listGoldenCases()).some((c) => c.id === created.id),
    'no longer in the list',
  );
});
