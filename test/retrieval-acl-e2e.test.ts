import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

// E2E-style integration test with the REAL Brain (LanceDB embedded store + the deterministic
// offline embedding fallback — no gateway, no mocks). Proves the vision-critical guarantee:
// a user WITHOUT access to a document cannot retrieve/cite it, even when the query is one that
// document would answer, while an un-ACL'd document stays visible to everyone.
//
// LANCEDB_PATH must be set to a fresh temp dir BEFORE brain.ts is imported (it reads the env at
// module load), so we set it here and import brain dynamically inside the test.
const dir = mkdtempSync(join(tmpdir(), 'offgrid-acl-'));
process.env.LANCEDB_PATH = dir;
delete process.env.OFFGRID_ADAPTER_RETRIEVAL; // force the LanceDB default backend
delete process.env.OFFGRID_SEED_DEMO;

test('permissions-aware retrieval: a doc the asker cannot see is NOT returned (nor cited)', async () => {
  const { addDocument, searchDocuments } = await import('../src/lib/brain.ts');

  // Doc X — a confidential HR salary doc, restricted to the "hr" role / its owner.
  const secret =
    'Confidential compensation review: the executive severance package and salary bands for 2026.';
  await addDocument('Executive compensation review', 'HR', secret, {
    owner: 'alice@corp.io',
    allowed_roles: ['hr'],
  });

  // An un-ACL'd public doc that also mentions salary, to prove un-ACL'd docs stay visible.
  await addDocument(
    'Payroll FAQ',
    'HR',
    'General payroll FAQ: when salary is paid and how to read your payslip.',
    undefined,
  );

  const query = 'what is the executive severance package and salary bands?';

  // Bob (role: sales) has NO grant on doc X. He must NOT get it back — even though it is the best
  // semantic match for his query.
  const bob = { subject: 'bob@corp.io', roles: ['sales'] };
  const bobHits = await searchDocuments(query, 10, { asker: bob });
  const bobTitles = bobHits.map((h) => h.title);
  assert.ok(!bobTitles.includes('Executive compensation review'),
    `doc X leaked to an unauthorized asker: ${JSON.stringify(bobTitles)}`);
  // The un-ACL'd doc is still visible to him.
  assert.ok(bobTitles.includes('Payroll FAQ'), 'un-ACL\'d doc wrongly hidden');

  // Alice (the owner) CAN retrieve doc X.
  const aliceHits = await searchDocuments(query, 10, { asker: { subject: 'alice@corp.io', roles: [] } });
  assert.ok(aliceHits.map((h) => h.title).includes('Executive compensation review'),
    'owner cannot see their own doc');

  // An HR user (role match) CAN retrieve doc X.
  const hrHits = await searchDocuments(query, 10, { asker: { subject: 'carol@corp.io', roles: ['hr'] } });
  assert.ok(hrHits.map((h) => h.title).includes('Executive compensation review'),
    'role-granted user cannot see the doc');

  // An admin superuser CAN retrieve doc X.
  const adminHits = await searchDocuments(query, 10, { asker: { subject: 'ops@corp.io', roles: ['admin'] } });
  assert.ok(adminHits.map((h) => h.title).includes('Executive compensation review'),
    'admin superuser cannot see the doc');

  // Backward compatibility: NO asker → both docs returned (today's behaviour, nothing filtered).
  const legacyHits = await searchDocuments(query, 10);
  assert.ok(legacyHits.map((h) => h.title).includes('Executive compensation review'),
    'legacy no-asker retrieval regressed');
});

after(() => {
  // temp dir is left for the OS to reap; no explicit cleanup needed for the assertion.
});
