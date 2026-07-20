import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { dispatchBrainIngest } from '../src/lib/brain-ingest.ts';
import { deleteDocument, listDocuments } from '../src/lib/brain.ts';

const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const bankOrg = `bank_ingest_${suffix}`;
const insuranceOrg = `insurance_ingest_${suffix}`;
const ids: Array<{ id: string; orgId: string }> = [];

after(async () => {
  await Promise.all(ids.map(({ id, orgId }) => deleteDocument(id, orgId).catch(() => false)));
});

test('Brain ingest carries the resolved tenant through request dispatch into retrieval storage', async () => {
  const bank = await dispatchBrainIngest(
    { kind: 'text', title: 'Delinquency playbook', text: `bank-${suffix}` },
    bankOrg,
  );
  const insurance = await dispatchBrainIngest(
    { kind: 'file', name: 'Indemnity SOP', text: `insurance-${suffix}` },
    insuranceOrg,
  );
  assert.ok(bank);
  assert.ok(insurance);
  ids.push({ id: bank.id, orgId: bankOrg }, { id: insurance.id, orgId: insuranceOrg });

  assert.equal(bank.orgId, bankOrg);
  assert.equal(insurance.orgId, insuranceOrg);
  assert.ok((await listDocuments(bankOrg)).some((doc) => doc.id === bank.id));
  assert.ok(!(await listDocuments(bankOrg)).some((doc) => doc.id === insurance.id));
  assert.ok((await listDocuments(insuranceOrg)).some((doc) => doc.id === insurance.id));
  assert.ok(!(await listDocuments(insuranceOrg)).some((doc) => doc.id === bank.id));
});
