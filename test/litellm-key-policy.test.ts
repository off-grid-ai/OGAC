import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildKeyGenerateBody,
  buildKeyUpdateBody,
  shapeKeyList,
  shapeKeyRow,
  validateKeyInput,
} from '../src/lib/litellm-key-policy.ts';

test('validateKeyInput: accepts valid, rejects negative/non-finite', () => {
  assert.equal(validateKeyInput({ maxBudget: 5, rpmLimit: 10 }).ok, true);
  assert.equal(validateKeyInput({ maxBudget: -1 }).ok, false);
  assert.equal(validateKeyInput({ tpmLimit: Number.NaN }).ok, false);
  assert.equal(validateKeyInput({}).ok, true); // all unset = unbounded, valid
});

test('buildKeyGenerateBody: only sets provided fields (snake_case)', () => {
  const b = buildKeyGenerateBody({ keyAlias: 'team-a', maxBudget: 20, rpmLimit: 60 });
  assert.deepEqual(b, { key_alias: 'team-a', max_budget: 20, rpm_limit: 60 });
  // unset fields absent (so /key/update never nulls an unspecified field)
  assert.equal('tpm_limit' in b, false);
  assert.equal('models' in b, false);
});

test('buildKeyGenerateBody: includes models only when non-empty', () => {
  assert.equal('models' in buildKeyGenerateBody({ models: [] }), false);
  assert.deepEqual(buildKeyGenerateBody({ models: ['onprem/gemma-4-e4b'] }).models, [
    'onprem/gemma-4-e4b',
  ]);
});

test('buildKeyUpdateBody: carries the target key + changed fields', () => {
  const b = buildKeyUpdateBody('sk-abc', { maxBudget: 50 });
  assert.equal(b.key, 'sk-abc');
  assert.equal(b.max_budget, 50);
});

test('shapeKeyRow: computes overBudget + budgetPct', () => {
  const over = shapeKeyRow({ token: 'sk-x', spend: 6, max_budget: 5 });
  assert.equal(over.overBudget, true);
  assert.equal(over.budgetPct, 120);
  const under = shapeKeyRow({ token: 'sk-y', spend: 1, max_budget: 4 });
  assert.equal(under.overBudget, false);
  assert.equal(under.budgetPct, 25);
  const unbounded = shapeKeyRow({ token: 'sk-z', spend: 99 });
  assert.equal(unbounded.overBudget, false);
  assert.equal(unbounded.budgetPct, null);
});

test('shapeKeyList: handles array and {keys:[…]} and junk', () => {
  assert.equal(shapeKeyList([{ token: 'a' }, { token: 'b' }]).length, 2);
  assert.equal(shapeKeyList({ keys: [{ token: 'a' }] }).length, 1);
  assert.equal(shapeKeyList(null).length, 0);
  assert.equal(shapeKeyList([null, 'x', { token: 'ok' }]).length, 1);
});
