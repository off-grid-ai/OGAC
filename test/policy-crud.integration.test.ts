import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the Policy module — exercises the REAL create → read → update → delete
// write-paths of src/lib/policy-rules.ts against a REAL Postgres (the module self-creates its
// `policy_rules` table via ensurePolicyRulesSchema's CREATE TABLE IF NOT EXISTS). It imports the
// real lib functions through the @/* resolver hook (test/support/register-alias.mjs), so this
// proves the module actually works end-to-end, not just that it typechecks.
//
// Runs against the same DATABASE_URL the app uses (default offgrid_console). If the DB is
// unreachable the whole suite skips (green) so `npm test` stays green in a DB-less env.
//
// All rows are written under a dedicated org id so real data is never touched, and every test
// cleans up after itself.

const ORG = 'test-int-policy';

const dbUp = await dbReachable();

test('policy-rules CRUD against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    ensurePolicyRulesSchema,
    createPolicyRule,
    listPolicyRules,
    getPolicyRule,
    updatePolicyRule,
    deletePolicyRule,
  } = await import('@/lib/policy-rules');
  const { toOpaDocument } = await import('@/lib/policy-rules-policy');
  const { validatePolicyRule } = await import('@/lib/policy-rules-policy');

  await ensurePolicyRulesSchema();

  // Belt-and-suspenders cleanup of any leftovers from a prior aborted run.
  t.after(async () => {
    for (const r of await listPolicyRules(ORG)) await deletePolicyRule(r.id, ORG);
  });

  // ── pure validation gate (what the write route enforces before touching the DB) ─────────────
  const bad = validatePolicyRule({ name: '', attribute: 'role', value: 'x', effect: 'deny', operator: 'eq' });
  assert.equal(bad.ok, false, 'empty name must fail validation');
  const good = validatePolicyRule({
    name: 'Deny external contractors',
    description: 'block contractor role',
    attribute: 'role',
    operator: 'eq',
    value: 'contractor',
    effect: 'deny',
    priority: 20,
  });
  assert.equal(good.ok, true);
  assert.ok(good.value);

  // ── CREATE ───────────────────────────────────────────────────────────────────────────────────
  const created = await createPolicyRule(good.value!, ORG);
  assert.match(created.id, /^pol_/, 'id is prefixed');
  assert.equal(created.name, 'Deny external contractors');
  assert.equal(created.effect, 'deny');
  assert.equal(created.priority, 20);
  assert.equal(created.enabled, true, 'defaults to enabled');

  // ── READ (getPolicyRule) ───────────────────────────────────────────────────────────────────────
  const fetched = await getPolicyRule(created.id, ORG);
  assert.ok(fetched, 'created rule reads back');
  assert.equal(fetched!.attribute, 'role');
  assert.equal(fetched!.value, 'contractor');

  // ── READ (listPolicyRules is org-scoped) ───────────────────────────────────────────────────────
  const listed = await listPolicyRules(ORG);
  assert.equal(listed.length, 1, 'org sees exactly its one rule');
  assert.equal(listed[0].id, created.id);

  // ── UPDATE ────────────────────────────────────────────────────────────────────────────────────
  const updated = await updatePolicyRule(
    created.id,
    { value: 'intern', effect: 'allow', priority: 5, enabled: false },
    ORG,
  );
  assert.ok(updated, 'update returns the row');
  assert.equal(updated!.value, 'intern');
  assert.equal(updated!.effect, 'allow');
  assert.equal(updated!.priority, 5);
  assert.equal(updated!.enabled, false);
  // Confirm it persisted (not just echoed).
  const reread = await getPolicyRule(created.id, ORG);
  assert.equal(reread!.value, 'intern');
  assert.equal(reread!.enabled, false);

  // A disabled rule must drop out of the OPA projection.
  assert.equal(toOpaDocument([updated!], 1).entries.length, 0, 'disabled rule not compiled to OPA');

  // Tenancy: updating under the wrong org is a no-op miss.
  const wrongOrg = await updatePolicyRule(created.id, { value: 'nope' }, 'test-int-policy-other');
  assert.equal(wrongOrg, null, 'cross-org update misses');

  // ── DELETE ───────────────────────────────────────────────────────────────────────────────────
  const del = await deletePolicyRule(created.id, ORG);
  assert.equal(del, true, 'delete reports a hit');
  assert.equal(await getPolicyRule(created.id, ORG), null, 'gone after delete');
  assert.equal((await listPolicyRules(ORG)).length, 0, 'list empty after delete');

  // Deleting a vanished id is a clean false.
  assert.equal(await deletePolicyRule(created.id, ORG), false, 'second delete misses');
});
