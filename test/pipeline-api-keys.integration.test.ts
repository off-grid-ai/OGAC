import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for per-pipeline provisioned API keys — exercises the REAL mint → verify → list →
// revoke write-paths of src/lib/pipeline-api-keys.ts against a REAL Postgres (the module self-creates
// its `pipeline_api_keys` table via ensurePipelineApiKeysSchema's CREATE TABLE IF NOT EXISTS). Skips
// (green) when no DB is up. All rows are written under dedicated pipeline/org ids so real data is
// never touched.

const ORG = 'test-int-plk';
const OTHER = 'test-int-plk-other';
const PIPELINE = 'pl_testintplk01';
const PIPELINE_B = 'pl_testintplk02';

const dbUp = await dbReachable();

test('pipeline API keys: mint hashes (not plaintext), verify round-trips, revoke invalidates, list never leaks, cross-org isolated', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { db } = await import('@/db');
  const { pipelineApiKeys } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  const { ensurePipelineApiKeysSchema, mintKey, listKeys, revokeKey, verifyPipelineKey } =
    await import('@/lib/pipeline-api-keys');

  await ensurePipelineApiKeysSchema();

  t.after(async () => {
    for (const org of [ORG, OTHER]) {
      for (const p of [PIPELINE, PIPELINE_B]) {
        for (const k of await listKeys(p, org)) {
          await db.delete(pipelineApiKeys).where(eq(pipelineApiKeys.id, k.id));
        }
      }
    }
  });

  // ── MINT — returns plaintext once; the view NEVER carries a hash/plaintext ──────────────────────
  const minted = await mintKey(PIPELINE, 'Partner — Acme', ORG, 'admin@offgrid.local');
  assert.match(minted.apiKey, /^og_pl_/, 'plaintext is a pipeline-scheme key');
  assert.match(minted.view.prefix, /^og_pl_/, 'prefix is the display stub');
  assert.ok(!minted.view.prefix.includes(minted.apiKey), 'prefix is not the whole secret');
  assert.equal(minted.view.active, true);
  assert.equal(minted.view.name, 'Partner — Acme');
  // The view object must not expose any hash/secret field.
  assert.ok(!('hashedKey' in minted.view), 'view has no hashedKey');
  assert.ok(!('apiKey' in minted.view), 'view has no plaintext');

  // ── STORE stores the HASH, not the plaintext ────────────────────────────────────────────────────
  const rows = await db.select().from(pipelineApiKeys).where(eq(pipelineApiKeys.id, minted.view.id));
  assert.equal(rows.length, 1);
  const stored = rows[0];
  assert.notEqual(stored.hashedKey, minted.apiKey, 'plaintext is NOT stored');
  assert.equal(stored.hashedKey.length, 64, 'sha256 hex is 64 chars');
  assert.equal(stored.pipelineId, PIPELINE);
  assert.equal(stored.orgId, ORG);

  // ── VERIFY round-trips to the right pipeline/org ────────────────────────────────────────────────
  const binding = await verifyPipelineKey(minted.apiKey);
  assert.ok(binding, 'valid key verifies');
  assert.equal(binding.pipelineId, PIPELINE);
  assert.equal(binding.orgId, ORG);
  assert.equal(binding.keyId, minted.view.id);

  // ── VERIFY rejects garbage + wrong-shape strings ────────────────────────────────────────────────
  assert.equal(await verifyPipelineKey('not-a-key'), null, 'non-scheme string rejected');
  assert.equal(await verifyPipelineKey('og_pl_abc'), null, 'too-short scheme string rejected');
  assert.equal(await verifyPipelineKey(minted.apiKey + 'x'), null, 'tampered key rejected');

  // ── LIST is org+pipeline scoped and never leaks the hash ────────────────────────────────────────
  const listed = await listKeys(PIPELINE, ORG);
  assert.equal(listed.length, 1);
  assert.ok(!('hashedKey' in listed[0]), 'list rows carry no hash');
  assert.equal(listed[0].id, minted.view.id);

  // ── REVOKE invalidates immediately; verify then fails; list shows revoked ───────────────────────
  const revoked = await revokeKey(minted.view.id, ORG);
  assert.ok(revoked, 'revoke returns the binding');
  assert.equal(revoked.pipelineId, PIPELINE);
  assert.equal(await verifyPipelineKey(minted.apiKey), null, 'revoked key no longer verifies');
  const afterRevoke = await listKeys(PIPELINE, ORG);
  assert.equal(afterRevoke[0].active, false, 'listed as inactive');
  assert.ok(afterRevoke[0].revokedAt, 'revokedAt stamped');

  // Revoking again (already revoked) is a no-op → null.
  assert.equal(await revokeKey(minted.view.id, ORG), null, 'double-revoke is a no-op');

  // ── CROSS-ORG ISOLATION — another org can neither see nor revoke this pipeline's key ────────────
  const mintedB = await mintKey(PIPELINE, 'Prod', ORG, 'admin@offgrid.local');
  assert.equal((await listKeys(PIPELINE, OTHER)).length, 0, 'other org sees no keys');
  assert.equal(await revokeKey(mintedB.view.id, OTHER), null, 'other org cannot revoke');
  // Its key still verifies (revoke from the wrong org did nothing) — binding remains the true org.
  const bindingB = await verifyPipelineKey(mintedB.apiKey);
  assert.ok(bindingB, 'key still valid after cross-org revoke attempt');
  assert.equal(bindingB.orgId, ORG);

  // ── invalid name rejected at mint ───────────────────────────────────────────────────────────────
  await assert.rejects(() => mintKey(PIPELINE, '   ', ORG, 'x'), /name is required/);
});
