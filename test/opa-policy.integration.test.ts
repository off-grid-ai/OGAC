import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPA_BASE, SKIP_MESSAGE, opaReachable } from './support/opa-available.mjs';

// INTEGRATION test for the OPA Rego-module surface — exercises the REAL author → validate → deploy →
// read → delete lifecycle of src/lib/opa-policy.ts against a REAL OPA over its policy API
// (PUT/GET/DELETE /v1/policies/{id}). It proves OPA actually compiles on upload and returns compile
// diagnostics for invalid Rego — the whole point of the feature.
//
// Runs against OFFGRID_OPA_URL. If OPA is unreachable the suite skips (green) so `npm test` stays
// green without an OPA. All modules use a dedicated test id prefix and are cleaned up.

const ID = '__offgrid_test__/authz';
const up = await opaReachable();

test('OPA Rego-module lifecycle against a real OPA', { skip: up ? false : SKIP_MESSAGE }, async (t) => {
  process.env.OFFGRID_OPA_URL = OPA_BASE;
  const { deployModule, getModule, listModules, deleteModule, validateModule } = await import(
    '@/lib/opa-policy'
  );

  t.after(async () => {
    await deleteModule(ID).catch(() => undefined);
  });

  // ── invalid Rego → compile diagnostics (no deploy) ──────────────────────────
  const bad = await deployModule({ id: ID, rego: 'package p\nallow := :::' });
  assert.equal(bad.status, 'invalid', 'garbage Rego must be rejected by OPA compile');
  if (bad.status === 'invalid') {
    assert.ok(bad.errors.length > 0, 'OPA returned at least one compile error');
  }

  // ── validate valid Rego without persisting a real module ────────────────────
  const check = await validateModule({ id: ID, rego: 'package offgrid.authz\ndefault allow := false\n' });
  assert.equal(check.status, 'deployed', 'valid Rego compiles');
  // scratch id should have been cleaned up
  const scratch = await getModule(`__offgrid_validate__/${ID}`);
  assert.ok(scratch.reachable && scratch.module === null, 'scratch validate module cleaned up');

  // ── deploy a real module, then read it back ─────────────────────────────────
  const rego = 'package offgrid.authz\n\ndefault allow := false\n\nallow if input.role == "admin"\n';
  const deployed = await deployModule({ id: ID, rego });
  assert.equal(deployed.status, 'deployed');

  const got = await getModule(ID);
  assert.ok(got.reachable && got.module);
  assert.equal(got.module?.id, ID);
  assert.ok(got.module?.rego.includes('package offgrid.authz'));

  const list = await listModules();
  assert.ok(list.reachable);
  if (list.reachable) assert.ok(list.modules.some((m) => m.id === ID), 'module appears in list');

  // ── delete ──────────────────────────────────────────────────────────────────
  const del = await deleteModule(ID);
  assert.ok(del.reachable && del.deleted);
  const gone = await getModule(ID);
  assert.ok(gone.reachable && gone.module === null, 'module gone after delete');
});
