import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  addDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  searchDocuments,
} from '../src/lib/brain.ts';

const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const orgA = `brain_a_${suffix}`;
const orgB = `brain_b_${suffix}`;
const needle = `quasarledger${suffix.replaceAll('_', '')}`;
let docA = '';
let docB = '';

after(async () => {
  if (docA) await deleteDocument(docA, orgA);
  if (docB) await deleteDocument(docB, orgB);
});

test('Brain persists org identity and enforces org + asker ACL before citation', async () => {
  const a = await addDocument(
    `${needle} A`,
    'Claims',
    `${needle} indemnity guidance for organisation A`,
    { owner: 'alice@a.test', allowed_roles: ['claims'] },
    orgA,
  );
  const b = await addDocument(
    `${needle} B`,
    'Lending',
    `${needle} delinquency guidance for organisation B`,
    { owner: 'bob@b.test', allowed_roles: ['collections'] },
    orgB,
  );
  docA = a.id;
  docB = b.id;

  assert.equal(a.orgId, orgA);
  assert.equal(b.orgId, orgB);
  assert.equal(await getDocument(docB, orgA), null, 'org A cannot address org B document');
  assert.deepEqual(
    (await listDocuments(orgA))
      .filter((doc) => doc.id === docA || doc.id === docB)
      .map((d) => d.id),
    [docA],
  );

  const alice = await searchDocuments(
    needle,
    10,
    { asker: { subject: 'alice@a.test', roles: ['claims'] } },
    orgA,
  );
  assert.ok(
    alice.some((hit) => hit.id === docA),
    'A owner can retrieve A document',
  );
  assert.ok(!alice.some((hit) => hit.id === docB), 'A search never cites B document');

  const mallory = await searchDocuments(
    needle,
    10,
    { asker: { subject: 'mallory@a.test', roles: ['sales'] } },
    orgA,
  );
  assert.ok(
    !mallory.some((hit) => hit.id === docA),
    'document ACL hides A doc from unauthorized A asker',
  );

  await deleteDocument(docB, orgA);
  assert.ok(await getDocument(docB, orgB), 'cross-org delete attempt does not remove B document');
});
