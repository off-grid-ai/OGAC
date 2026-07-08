import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateExpectations,
  type TableSchemaDescriptor,
} from '../src/lib/suggest-expectations.ts';

// PURE unit tests for the data-quality expectation generator (M5). From-schema inference (name/type)
// vs observed-stat sharpening. No I/O.

function forColumn(suite: ReturnType<typeof generateExpectations>, col: string, kind: string) {
  return suite.expectations.find((e) => e.column === col && e.kind === kind);
}

test('id column gets not-null + unique (inferred)', () => {
  const schema: TableSchemaDescriptor = {
    table: 'customers',
    columns: [{ name: 'customer_id', type: 'integer' }],
  };
  const suite = generateExpectations(schema);
  assert.ok(forColumn(suite, 'customer_id', 'not_null'));
  assert.ok(forColumn(suite, 'customer_id', 'unique'));
  assert.equal(forColumn(suite, 'customer_id', 'not_null')!.basis, 'inferred');
});

test('type expectation reflects the declared type', () => {
  const suite = generateExpectations({
    table: 't',
    columns: [{ name: 'amount', type: 'decimal' }],
  });
  const type = forColumn(suite, 'amount', 'type');
  assert.ok(type);
  assert.equal(type!.kwargs.type_, 'FLOAT');
});

test('amount column gets a non-negative range (inferred)', () => {
  const suite = generateExpectations({
    table: 't',
    columns: [{ name: 'balance_amount', type: 'number' }],
  });
  const range = forColumn(suite, 'balance_amount', 'range');
  assert.ok(range);
  assert.equal(range!.kwargs.min_value, 0);
});

test('observed min/max produces an observed-basis range', () => {
  const suite = generateExpectations({
    table: 't',
    columns: [{ name: 'age', type: 'integer', min: 18, max: 95 }],
  });
  const range = forColumn(suite, 'age', 'range');
  assert.ok(range);
  assert.equal(range!.basis, 'observed');
  assert.equal(range!.kwargs.min_value, 18);
  assert.equal(range!.kwargs.max_value, 95);
});

test('email column gets unique + a format regex', () => {
  const suite = generateExpectations({
    table: 't',
    columns: [{ name: 'email', type: 'string' }],
  });
  assert.ok(forColumn(suite, 'email', 'unique'));
  assert.ok(forColumn(suite, 'email', 'regex'));
});

test('observed nullCount 0 → observed not-null', () => {
  const suite = generateExpectations({
    table: 't',
    columns: [{ name: 'name', type: 'string', nullCount: 0, rowCount: 1000 }],
  });
  const nn = forColumn(suite, 'name', 'not_null');
  assert.ok(nn);
  assert.equal(nn!.basis, 'observed');
});

test('observed distinct == rowCount → observed unique', () => {
  const suite = generateExpectations({
    table: 't',
    columns: [{ name: 'token', type: 'string', distinctCount: 500, rowCount: 500 }],
  });
  const u = forColumn(suite, 'token', 'unique');
  assert.ok(u);
  assert.equal(u!.basis, 'observed');
});

test('enum-like column with samples → allowed-values set from observed samples', () => {
  const suite = generateExpectations({
    table: 't',
    columns: [
      {
        name: 'status',
        type: 'string',
        distinctCount: 3,
        rowCount: 1000,
        sampleValues: ['active', 'closed', 'pending'],
      },
    ],
  });
  const av = forColumn(suite, 'status', 'allowed_values');
  assert.ok(av);
  assert.deepEqual(av!.kwargs.value_set, ['active', 'closed', 'pending']);
});

test('boolean column gets [true,false] allowed set', () => {
  const suite = generateExpectations({
    table: 't',
    columns: [{ name: 'is_active', type: 'boolean' }],
  });
  const av = forColumn(suite, 'is_active', 'allowed_values');
  assert.ok(av);
  assert.deepEqual(av!.kwargs.value_set, [true, false]);
});

test('PAN column gets the Indian PAN format regex', () => {
  const suite = generateExpectations({
    table: 't',
    columns: [{ name: 'pan_number', type: 'string' }],
  });
  const re = forColumn(suite, 'pan_number', 'regex');
  assert.ok(re);
  assert.equal(re!.kwargs.regex, '^[A-Z]{5}[0-9]{4}[A-Z]$');
});

test('expectations stay grouped in schema column order', () => {
  const suite = generateExpectations({
    table: 't',
    columns: [
      { name: 'id', type: 'integer' },
      { name: 'email', type: 'string' },
    ],
  });
  const firstEmailIdx = suite.expectations.findIndex((e) => e.column === 'email');
  const lastIdIdx = suite.expectations.map((e) => e.column).lastIndexOf('id');
  assert.ok(lastIdIdx < firstEmailIdx, 'all id checks precede email checks');
});
