import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Regression test for the live "new-document ingest 500" bug (VERIFICATION_GAPS S1).
//
// Root cause: LanceDB fixes a table's schema at creation. The `documents` table on the live server
// was created BEFORE the per-doc ACL columns (owner/allowed_roles/allowed_subjects/data_class)
// were added to the persisted row. Every new ingest then tried to `add()` a row carrying those
// four columns, and LanceDB rejected it with "Found field not in schema: owner at row 0" — surfaced
// as a bare 500. Reads worked because the reader tolerates absent ACL columns.
//
// The fix: on opening an existing table, reconcile its schema — add any missing ACL columns in
// place (back-filling existing rows with the empty-string sentinel) so `add()` matches the schema.
//
// These tests exercise REAL behavior: the pure migration rule, and a full integration test against
// a real embedded LanceDB table deliberately created WITHOUT the ACL columns (the legacy shape),
// proving the reconciliation makes ingest work end-to-end. No mocks.

test('aclColumnMigration (pure): a legacy table missing all ACL columns gets all four back-filled', async () => {
  const { aclColumnMigration } = await import('../src/lib/brain.ts');
  // Exactly the live legacy schema: base columns + vector, no ACL columns.
  const migration = aclColumnMigration(['id', 'title', 'source', 'text', 'vector']);
  assert.deepEqual(
    migration.map((m) => m.name),
    ['owner', 'allowed_roles', 'allowed_subjects', 'data_class'],
  );
  // Each missing column back-fills existing rows with the empty-string ("no value") sentinel.
  for (const m of migration) assert.equal(m.valueSql, "''");
});

test('aclColumnMigration (pure): a current table needs no migration (idempotent)', async () => {
  const { aclColumnMigration } = await import('../src/lib/brain.ts');
  const current = ['id', 'title', 'source', 'text', 'vector', 'owner', 'allowed_roles', 'allowed_subjects', 'data_class'];
  assert.deepEqual(aclColumnMigration(current), []);
  // A partially-migrated table only fills what's still missing.
  const partial = ['id', 'title', 'source', 'text', 'vector', 'owner', 'data_class'];
  assert.deepEqual(
    aclColumnMigration(partial).map((m) => m.name),
    ['allowed_roles', 'allowed_subjects'],
  );
});

// Integration: reproduce the exact legacy on-disk table, then prove the Brain reconciles it and
// ingest succeeds + the doc becomes retrievable. LANCEDB_PATH must be set BEFORE brain.ts loads
// (it reads the env at module import), so we set it here and import dynamically inside the test.
const dir = mkdtempSync(join(tmpdir(), 'offgrid-brain-schema-'));
process.env.LANCEDB_PATH = dir;
delete process.env.OFFGRID_ADAPTER_RETRIEVAL; // force the LanceDB default backend
delete process.env.OFFGRID_SEED_DEMO;

test('integration: a legacy table with NO ACL columns is reconciled → addDocument succeeds + is searchable', async () => {
  const lancedb = await import('@lancedb/lancedb');
  const { addDocument, searchDocuments, listDocuments } = await import('../src/lib/brain.ts');
  const { EMBED_DIM } = await import('../src/lib/adapters/types.ts');

  // 1) Create the table in the LEGACY shape — base columns + a real vector, NO ACL columns —
  //    the pre-migration schema that broke the live server.
  const db = await lancedb.connect(dir);
  const legacyRow = {
    id: 'legacy-1',
    title: 'Legacy KYC note',
    source: 'SOP',
    text: 'Collect a government photo ID and proof of address for onboarding.',
    vector: new Array(EMBED_DIM).fill(0).map((_, i) => (i % 7) / 7),
  };
  const legacy = await db.createTable('documents', [legacyRow]);
  const before = (await legacy.schema()).fields.map((f) => f.name);
  assert.ok(!before.includes('owner'), 'precondition: legacy table must lack ACL columns');

  // 2) Ingest a NEW document through the real Brain. Pre-fix this threw "Found field not in
  //    schema: owner" → 500. Post-fix getTable() reconciles the schema first, so this succeeds.
  const doc = await addDocument(
    'Wire transfer limits',
    'Policy',
    'Domestic NEFT and RTGS transfer limits and the daily aggregate cap for retail accounts.',
    { owner: 'ops-team', data_class: 'internal' },
  );
  assert.ok(doc.id, 'addDocument returns a persisted doc with an id');

  // The table now carries the ACL columns, and the legacy row survived the back-fill.
  const after = (await db.openTable('documents').then((t) => t.schema())).fields.map((f) => f.name);
  for (const c of ['owner', 'allowed_roles', 'allowed_subjects', 'data_class']) {
    assert.ok(after.includes(c), `reconciled schema includes ${c}`);
  }

  // 3) The freshly ingested doc is retrievable, and its ACL round-trips.
  const hits = await searchDocuments('what are the RTGS transfer limits', 5);
  const found = hits.find((h) => h.id === doc.id);
  assert.ok(found, 'the new document is searchable after ingest');
  assert.equal(found?.acl?.owner, 'ops-team');

  // The legacy row is still present and reads back with an empty (visible) ACL.
  const all = await listDocuments();
  const legacyBack = all.find((d) => d.id === 'legacy-1');
  assert.ok(legacyBack, 'the pre-existing legacy row survived the migration');
  assert.equal(legacyBack?.acl?.owner, null, 'back-filled legacy ACL reads as un-owned / visible');
});
