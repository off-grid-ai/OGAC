import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allModuleIds, isModuleId, validateModules } from '@/lib/roles';

test('isModuleId accepts every real module id and rejects junk', () => {
  const ids = allModuleIds();
  assert.ok(ids.length > 0, 'registry should expose module ids');
  for (const id of ids) assert.equal(isModuleId(id), true, id);
  assert.equal(isModuleId('not-a-module'), false);
  assert.equal(isModuleId(''), false);
  assert.equal(isModuleId(123), false);
  assert.equal(isModuleId(null), false);
});

test('validateModules partitions known vs unknown and dedupes', () => {
  const [a, b] = allModuleIds();
  const r = validateModules([a, b, a, 'bogus', ' ', 'another-bogus']);
  assert.deepEqual(r.valid, [a, b]);
  assert.deepEqual(r.unknown, ['bogus', 'another-bogus']);
});

test('validateModules on a non-array yields empty (fail-closed)', () => {
  assert.deepEqual(validateModules(undefined), { valid: [], unknown: [] });
  assert.deepEqual(validateModules(null), { valid: [], unknown: [] });
  assert.deepEqual(validateModules('overview'), { valid: [], unknown: [] });
  assert.deepEqual(validateModules({}), { valid: [], unknown: [] });
});

test('validateModules trims whitespace around ids', () => {
  const [a] = allModuleIds();
  assert.deepEqual(validateModules([` ${a} `]).valid, [a]);
});
