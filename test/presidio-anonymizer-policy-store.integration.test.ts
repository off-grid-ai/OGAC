import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the anonymizer-policy STORE — real get → upsert → get against a real Postgres
// (the module self-creates its table via ensureAnonymizerPolicySchema's CREATE TABLE IF NOT EXISTS).
// Skips green when no DB is up. Writes under a dedicated org id so real data is never touched.

const ORG = 'test-int-anon-policy';
const dbUp = await dbReachable();

test('anonymizer policy upsert round-trips against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { ensureAnonymizerPolicySchema, getAnonymizerPolicy, setAnonymizerPolicy } = await import(
    '@/lib/presidio-anonymizer-policy-store'
  );
  const { DEFAULT_ANONYMIZER_POLICY } = await import('@/lib/presidio-anonymizers');

  await ensureAnonymizerPolicySchema();
  t.after(async () => {
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`DELETE FROM presidio_anonymizer_policy WHERE org_id = ${ORG};`);
  });

  // No stored row yet → the ready-to-use BFSI default.
  const initial = await getAnonymizerPolicy(ORG);
  assert.deepEqual(initial, DEFAULT_ANONYMIZER_POLICY);

  // Upsert a custom policy.
  const custom = {
    default: { type: 'redact' as const },
    perEntity: {
      IN_PAN: { type: 'mask' as const, maskingChar: '#', charsToMask: 5, fromEnd: true },
      CREDIT_CARD: { type: 'hash' as const, hashType: 'sha512' as const },
    },
  };
  const saved = await setAnonymizerPolicy(custom, ORG);
  assert.deepEqual(saved.perEntity.IN_PAN, custom.perEntity.IN_PAN);

  // Read back the persisted, normalized policy.
  const readBack = await getAnonymizerPolicy(ORG);
  assert.deepEqual(readBack.default, { type: 'redact' });
  assert.deepEqual(readBack.perEntity.CREDIT_CARD, { type: 'hash', hashType: 'sha512' });

  // Second upsert overwrites (ON CONFLICT path).
  const overwrite = await setAnonymizerPolicy({ default: { type: 'keep' }, perEntity: {} }, ORG);
  assert.deepEqual(overwrite, { default: { type: 'keep' }, perEntity: {} });
  const afterOverwrite = await getAnonymizerPolicy(ORG);
  assert.deepEqual(afterOverwrite.default, { type: 'keep' });
});
