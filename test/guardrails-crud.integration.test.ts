import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the Guardrails module — exercises the REAL create → read → update →
// toggle → delete write-paths of src/lib/guardrails-rules.ts against a REAL Postgres (the module
// self-creates its `guardrails_rules` table via ensureGuardrailRulesSchema's CREATE TABLE IF NOT
// EXISTS). Imports the real lib through the @/* resolver hook. Skips (green) when no DB is up.
//
// All rows are written under a dedicated org id so real data is never touched.

const ORG = 'test-int-guardrails';

const dbUp = await dbReachable();

test('guardrails-rules CRUD against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    ensureGuardrailRulesSchema,
    createGuardrailRule,
    listGuardrailRules,
    updateGuardrailRule,
    setGuardrailRuleEnabled,
    deleteGuardrailRule,
    validateRule,
  } = await import('@/lib/guardrails-rules');

  await ensureGuardrailRulesSchema();

  t.after(async () => {
    for (const r of await listGuardrailRules(ORG)) await deleteGuardrailRule(r.id, ORG);
  });

  // ── pure validation gate ────────────────────────────────────────────────────────────────────
  const badRegex = validateRule({ matcher: 'regex', pattern: '(', action: 'mask' });
  assert.equal(badRegex.ok, false, 'uncompilable regex rejected');
  const draft = validateRule({ matcher: 'entity', pattern: 'us_ssn', action: 'redact', label: 'SSNs' });
  assert.equal(draft.ok, true);
  assert.ok(draft.ok && draft.value.pattern === 'US_SSN', 'entity name upper-snaked');

  // ── CREATE ──────────────────────────────────────────────────────────────────────────────────
  assert.ok(draft.ok);
  const created = await createGuardrailRule(draft.value, ORG);
  assert.match(created.id, /^grr_/);
  assert.equal(created.matcher, 'entity');
  assert.equal(created.pattern, 'US_SSN');
  assert.equal(created.action, 'redact');
  assert.equal(created.label, 'SSNs');
  assert.equal(created.enabled, true, 'defaults enabled');
  assert.ok(created.createdAt, 'has a created timestamp');

  // ── READ (list is org-scoped) ─────────────────────────────────────────────────────────────────
  const listed = await listGuardrailRules(ORG);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);
  assert.equal(listed[0].pattern, 'US_SSN');

  // ── UPDATE (full replace) ─────────────────────────────────────────────────────────────────────
  const nextDraft = validateRule({
    matcher: 'regex',
    pattern: 'ACME-\\d+',
    action: 'hash',
    label: 'internal ticket ids',
  });
  assert.ok(nextDraft.ok);
  const updated = await updateGuardrailRule(created.id, nextDraft.value, ORG);
  assert.ok(updated, 'update returns the row');
  assert.equal(updated!.matcher, 'regex');
  assert.equal(updated!.pattern, 'ACME-\\d+');
  assert.equal(updated!.action, 'hash');
  assert.equal(updated!.label, 'internal ticket ids');
  // Confirm persistence via a fresh list.
  const afterUpdate = (await listGuardrailRules(ORG))[0];
  assert.equal(afterUpdate.action, 'hash');

  // ── UPDATE (toggle enabled) ──────────────────────────────────────────────────────────────────
  const disabled = await setGuardrailRuleEnabled(created.id, false, ORG);
  assert.ok(disabled);
  assert.equal(disabled!.enabled, false);
  assert.equal((await listGuardrailRules(ORG))[0].enabled, false, 'toggle persisted');
  const reenabled = await setGuardrailRuleEnabled(created.id, true, ORG);
  assert.equal(reenabled!.enabled, true);

  // Tenancy: wrong org misses.
  assert.equal(
    await setGuardrailRuleEnabled(created.id, false, 'test-int-guardrails-other'),
    null,
    'cross-org toggle misses',
  );

  // ── DELETE ───────────────────────────────────────────────────────────────────────────────────
  assert.equal(await deleteGuardrailRule(created.id, ORG), true);
  assert.equal((await listGuardrailRules(ORG)).length, 0, 'gone after delete');
  assert.equal(await deleteGuardrailRule(created.id, ORG), false, 'second delete misses');
});
