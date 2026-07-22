import assert from 'node:assert/strict';
import test from 'node:test';

import {
  operationUnavailable,
  parseCapabilityManifest,
  parseHistoryQuery,
  parseProfileRequest,
  parseSuiteDelete,
  parseSuiteDraft,
  parseSuiteName,
  parseSuiteUpdate,
  parseTenantContext,
  parseValidationRequest,
  unavailableManifest,
} from '../src/lib/service-capabilities/great-expectations-lifecycle.ts';

const expectation = { type: 'expect_column_values_to_not_be_null', kwargs: { column: 'pan' } };

test('tenant context requires an explicit bounded org and actor', () => {
  assert.deepEqual(parseTenantContext({ orgId: 'org_bharat', actor: 'admin@example.test' }).value, {
    orgId: 'org_bharat',
    actor: 'admin@example.test',
  });
  assert.equal(parseTenantContext({ orgId: '../other', actor: '' }).ok, false);
  assert.equal(parseTenantContext(null).ok, false);
});

test('suite create and update normalize valid lifecycle input', () => {
  const create = parseSuiteDraft({ name: 'customer-quality.v1', description: '  PAN rules ', expectations: [expectation] });
  assert.equal(create.ok, true);
  assert.equal(create.value?.description, 'PAN rules');
  assert.deepEqual(create.value?.expectations, [expectation]);

  const update = parseSuiteUpdate({ expectedVersion: 2, description: ' tightened ', expectations: [expectation] });
  assert.deepEqual(update.value, { expectedVersion: 2, description: 'tightened', expectations: [expectation] });
  assert.equal(parseSuiteName('kyc.v1').value, 'kyc.v1');
  assert.deepEqual(parseSuiteDelete({ expectedVersion: 2 }).value, { expectedVersion: 2 });
  assert.deepEqual(parseSuiteDelete({}).value, {});
});

test('suite validation rejects traversal, fake expectation types, empty updates, and unbounded suites', () => {
  assert.equal(parseSuiteDraft({ name: '../suite', expectations: [expectation] }).ok, false);
  assert.equal(parseSuiteDraft({ name: 'suite', expectations: [{ type: 'sql', kwargs: {} }] }).ok, false);
  assert.equal(parseSuiteDraft({ name: 'suite', expectations: [{ type: 'expect_valid_name', kwargs: [] }] }).ok, false);
  assert.equal(parseSuiteDraft({ name: 'suite', expectations: [] }).ok, false);
  assert.equal(parseSuiteDraft({ name: 'suite', expectations: Array.from({ length: 201 }, () => expectation) }).ok, false);
  assert.equal(parseSuiteUpdate({ expectedVersion: 1 }).ok, false);
  assert.equal(parseSuiteUpdate({ expectedVersion: 0, description: 'x' }).ok, false);
  assert.equal(parseSuiteUpdate({ expectedVersion: 1, description: 'x'.repeat(1001) }).ok, false);
  assert.equal(parseSuiteName('../kyc').ok, false);
  assert.equal(parseSuiteDelete({ expectedVersion: '2' }).ok, false);
});

test('profile parsing requires a governed source/asset and applies a bounded default sample', () => {
  assert.deepEqual(parseProfileRequest({ dataSourceId: 'warehouse', assetName: 'customers' }).value, {
    dataSourceId: 'warehouse',
    assetName: 'customers',
    sampleLimit: 1_000,
  });
  assert.equal(parseProfileRequest({ dataSourceId: '', assetName: 'customers' }).ok, false);
  assert.equal(parseProfileRequest({ dataSourceId: 'warehouse', assetName: 'customers', sampleLimit: 100_001 }).ok, false);
  assert.equal(parseProfileRequest({ dataSourceId: 'warehouse', assetName: 'customers', sampleLimit: '100' }).ok, false);
});

test('validation request accepts bounded inline rows or an asset, never malformed batches', () => {
  assert.deepEqual(
    parseValidationRequest({ suiteName: 'kyc', batch: { kind: 'inline', rows: [{ pan: 'ABCDE1234F' }] } }).value,
    { suiteName: 'kyc', batch: { kind: 'inline', rows: [{ pan: 'ABCDE1234F' }] }, idempotencyKey: undefined },
  );
  assert.deepEqual(
    parseValidationRequest({ suiteName: 'kyc', idempotencyKey: 'run_1', batch: { kind: 'asset', dataSourceId: 'warehouse', assetName: 'customers' } }).value,
    { suiteName: 'kyc', batch: { kind: 'asset', dataSourceId: 'warehouse', assetName: 'customers', limit: 1_000 }, idempotencyKey: 'run_1' },
  );
  assert.equal(parseValidationRequest({ suiteName: 'kyc', batch: { kind: 'inline', rows: [null] } }).ok, false);
  assert.equal(parseValidationRequest({ suiteName: 'kyc', batch: { kind: 'query', sql: 'select *' } }).ok, false);
  assert.equal(parseValidationRequest({ suiteName: '../kyc', batch: { kind: 'inline', rows: [] } }).ok, false);
});

test('history query is bounded and cursor-safe', () => {
  assert.deepEqual(parseHistoryQuery({ suiteName: 'kyc' }).value, {
    suiteName: 'kyc', dataSourceId: undefined, limit: 50, cursor: undefined,
  });
  assert.equal(parseHistoryQuery({ limit: 201 }).ok, false);
  assert.equal(parseHistoryQuery({ cursor: '../next' }).ok, false);
  assert.equal(parseHistoryQuery({ dataSourceId: 'warehouse', limit: 25, cursor: 'eyJpZCI6IjEifQ' }).ok, true);
});

test('manifest parsing never invents support and distinguishes real GX from compatibility mode', () => {
  const real = parseCapabilityManifest({
    status: 'ok', engine: 'great-expectations', engineVersion: '1.8.0',
    operations: { profile: true, validate: true, 'suite.list': true, madeUp: true },
  });
  assert.equal(real.serviceReachable, true);
  assert.equal(real.engine, 'great-expectations');
  assert.equal(real.operations.profile, true);
  assert.equal(real.operations['suite.list'], true);
  assert.equal(real.operations['suite.create'], false);

  const compatibility = parseCapabilityManifest({ status: 'ok', engine: 'native' });
  assert.equal(compatibility.engine, 'native-compatibility');
  assert.equal(Object.values(compatibility.operations).every((supported) => !supported), true);
  assert.equal(parseCapabilityManifest(null).serviceReachable, false);
});

test('unavailable operations produce an honest typed 501 result', () => {
  const manifest = unavailableManifest('sidecar is stateless', true, 'native-compatibility');
  const result = operationUnavailable(manifest, 'history.list');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, 'unavailable');
    assert.equal(result.status, 501);
    assert.match(result.message, /native compatibility engine/);
  }
});
