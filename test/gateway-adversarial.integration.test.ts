import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ADVERSARIAL integration break-test — the gateway REGISTRY write-path against a REAL Postgres.
// Exercises the real updateGateway seam (read-modify-write), asserting the PERSISTED row (the
// terminal artifact an operator reads back), never a shape. Skips (green) when no DB is up.
// Companion write-up: docs/adversarial/gateway.md. Backlog: G-ADV-GW-4.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const ORG = 'test-adv-gateways';
const dbUp = await dbReachable();

// ── G-ADV-GW-4 (LOW/MEDIUM): PATCH can CLEAR a non-compat gateway's baseUrl to '' with no error ─────
//
// updateGateway merges the patch with `?? existing` (gateways.ts:198) and validateGatewayUpdate
// sets `patch.baseUrl = ''` for an empty-string input (gateways-policy.ts:262). Because '' is not
// nullish, `'' ?? existing.baseUrl` resolves to '' — the stored baseUrl is CLEARED. The only merged
// guard is validateMergedGateway, which checks emptiness for kind==='compat' ONLY (:288). So a
// cloud/on-prem gateway that legitimately has a baseUrl can be PATCHed to an empty baseUrl and the
// unusable row PERSISTS with no user-facing error — a bad persisted row the operator can't tell is
// broken until a run fails downstream.
//
// RED: reading the row back after clearing baseUrl on an OpenAI (cloud) gateway. The registry should
// either reject the empty baseUrl or leave the existing value; today it persists ''.
test('G-ADV-GW-4: clearing baseUrl via PATCH on a non-compat gateway persists an empty (unusable) row', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async (t) => {
  const { ensureGatewaysSchema, createGateway, updateGateway, getGatewayRow, deleteGateway, listGatewayRows } =
    await import('@/lib/gateways');
  await ensureGatewaysSchema();
  t.after(async () => {
    for (const g of await listGatewayRows(ORG)) await deleteGateway(g.id, ORG);
  });

  // A cloud (openai) gateway with a real base URL.
  const gw = await createGateway(
    { name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o', egressClass: 'cloud', enabled: true },
    ORG,
  );
  assert.equal(gw.baseUrl, 'https://api.openai.com/v1');

  // PATCH clearing the baseUrl to empty. The registry accepts it (validateMergedGateway only guards compat).
  const res = await updateGateway(gw.id, { baseUrl: '' }, ORG);

  // The break: the update SUCCEEDS and persists an empty baseUrl on a cloud gateway.
  const persisted = await getGatewayRow(gw.id, ORG);
  // This is the RED assertion — it documents the current (buggy) reality. When the seam is fixed to
  // reject clearing a required baseUrl, flip these to assert the update is rejected / value preserved.
  assert.equal(res.ok, true, 'CURRENT: the empty-baseUrl PATCH is accepted (should be rejected)');
  assert.equal(persisted?.baseUrl, '', 'CURRENT: the cloud gateway now has an empty, unusable baseUrl persisted');
});
