import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCreateDatasetBody,
  buildCreateItemBody,
  coerceJsonField,
  coerceStatus,
  fieldToText,
  shapeDataset,
  shapeDatasetItem,
  shapeDatasetItems,
  shapeDatasetRuns,
  shapeDatasets,
  validateDatasetName,
  validateItemId,
  validateMetadata,
  type RawDataset,
  type RawDatasetItem,
  type RawDatasetRun,
} from '../src/lib/langfuse-datasets.ts';

// PURE unit tests for the Langfuse dataset-management logic — no network, no mocks. They pin
// validation, the create-dataset / upsert-item body shaping, JSON-field coercion, and the
// JSON→display normalization for datasets, items, and runs.

// ─── validateDatasetName ──────────────────────────────────────────────────────
test('validateDatasetName trims + validates', () => {
  assert.deepEqual(validateDatasetName('  golden-set  '), { ok: true, value: 'golden-set' });
  assert.equal(validateDatasetName('').ok, false);
  assert.equal(validateDatasetName('a'.repeat(256)).ok, false);
  assert.equal(validateDatasetName('bad\nname').ok, false);
});

// ─── validateItemId ───────────────────────────────────────────────────────────
test('validateItemId: blank → undefined, over-length rejected', () => {
  assert.deepEqual(validateItemId('  '), { ok: true, value: undefined });
  assert.deepEqual(validateItemId('item-1'), { ok: true, value: 'item-1' });
  assert.equal(validateItemId('x'.repeat(256)).ok, false);
});

// ─── coerceStatus ─────────────────────────────────────────────────────────────
test('coerceStatus normalizes to ACTIVE/ARCHIVED', () => {
  assert.equal(coerceStatus('archived'), 'ARCHIVED');
  assert.equal(coerceStatus('ACTIVE'), 'ACTIVE');
  assert.equal(coerceStatus(''), 'ACTIVE');
  assert.equal(coerceStatus(null), 'ACTIVE');
  assert.equal(coerceStatus('weird'), 'ACTIVE');
});

// ─── coerceJsonField ──────────────────────────────────────────────────────────
test('coerceJsonField parses JSON, falls back to raw string, blank → null', () => {
  assert.deepEqual(coerceJsonField('{"q":"hi"}'), { q: 'hi' });
  assert.deepEqual(coerceJsonField('[1,2]'), [1, 2]);
  assert.equal(coerceJsonField('just text'), 'just text');
  assert.equal(coerceJsonField('   '), null);
  assert.equal(coerceJsonField(null), null);
  assert.equal(coerceJsonField('42'), 42);
});

// ─── validateMetadata ─────────────────────────────────────────────────────────
test('validateMetadata: blank→null, object ok, scalar/array/invalid rejected', () => {
  assert.deepEqual(validateMetadata(''), { ok: true, value: null });
  assert.deepEqual(validateMetadata('{"a":1}'), { ok: true, value: { a: 1 } });
  assert.equal(validateMetadata('[1]').ok, false);
  assert.equal(validateMetadata('5').ok, false);
  assert.equal(validateMetadata('not json').ok, false);
  assert.equal(validateMetadata('"str"').ok, false);
});

// ─── buildCreateDatasetBody ───────────────────────────────────────────────────
test('buildCreateDatasetBody shapes name + optional description/metadata', () => {
  const r = buildCreateDatasetBody({
    name: '  eval-set ',
    description: '  BFSI KYC cases ',
    metadata: '{"owner":"tax"}',
  });
  assert.deepEqual(r, {
    ok: true,
    value: { name: 'eval-set', description: 'BFSI KYC cases', metadata: { owner: 'tax' } },
  });
});

test('buildCreateDatasetBody omits empties and rejects bad name/metadata', () => {
  const r = buildCreateDatasetBody({ name: 'x' });
  assert.equal(r.ok, true);
  const v = (r as { value: Record<string, unknown> }).value;
  assert.ok(!('description' in v));
  assert.ok(!('metadata' in v));
  assert.equal(buildCreateDatasetBody({ name: '' }).ok, false);
  assert.equal(buildCreateDatasetBody({ name: 'x', metadata: '[1]' }).ok, false);
});

// ─── buildCreateItemBody ──────────────────────────────────────────────────────
test('buildCreateItemBody shapes a full upsert item', () => {
  const r = buildCreateItemBody({
    datasetName: 'eval-set',
    input: '{"question":"What is my balance?"}',
    expectedOutput: 'Rs. 5,000',
    metadata: '{"lang":"en"}',
    id: 'case-1',
    status: 'archived',
  });
  assert.deepEqual(r, {
    ok: true,
    value: {
      datasetName: 'eval-set',
      input: { question: 'What is my balance?' },
      expectedOutput: 'Rs. 5,000',
      metadata: { lang: 'en' },
      status: 'ARCHIVED',
      id: 'case-1',
    },
  });
});

test('buildCreateItemBody: input required, id optional, defaults status ACTIVE', () => {
  const r = buildCreateItemBody({ datasetName: 'd', input: 'hello' });
  assert.equal(r.ok, true);
  const v = (r as { value: Record<string, unknown> }).value;
  assert.equal(v.status, 'ACTIVE');
  assert.ok(!('id' in v));
  assert.equal(v.expectedOutput, null);
  assert.equal(v.metadata, null);
});

test('buildCreateItemBody rejects missing datasetName / input / bad metadata / long id', () => {
  assert.equal(buildCreateItemBody({ datasetName: '', input: 'x' }).ok, false);
  assert.equal(buildCreateItemBody({ datasetName: 'd', input: '  ' }).ok, false);
  assert.equal(buildCreateItemBody({ datasetName: 'd', input: 'x', metadata: '5' }).ok, false);
  assert.equal(
    buildCreateItemBody({ datasetName: 'd', input: 'x', id: 'y'.repeat(256) }).ok,
    false,
  );
});

// ─── fieldToText ──────────────────────────────────────────────────────────────
test('fieldToText pretty-prints objects, passes strings, empties null', () => {
  assert.equal(fieldToText(null), '');
  assert.equal(fieldToText('raw'), 'raw');
  assert.equal(fieldToText({ a: 1 }), '{\n  "a": 1\n}');
});

test('fieldToText falls back to String() when JSON.stringify throws (BigInt)', () => {
  assert.equal(fieldToText(10n), '10');
});

// ─── shapeDatasets / shapeDataset ─────────────────────────────────────────────
test('shapeDatasets normalizes + sorts newest-created first', () => {
  const rows: RawDataset[] = [
    { id: '1', name: 'a', createdAt: '2026-01-01' },
    { id: '2', name: 'b', description: ' desc ', createdAt: '2026-03-01' },
    { id: '3', name: null, createdAt: null },
  ];
  const out = shapeDatasets(rows);
  assert.equal(out[0].name, 'b');
  assert.equal(out[0].description, 'desc');
  assert.ok(out.some((d) => d.name === 'unnamed'));
  assert.deepEqual(shapeDatasets(undefined as unknown as RawDataset[]), []);
});

test('shapeDatasets tie-breaks equal createdAt by name', () => {
  const out = shapeDatasets([
    { id: '2', name: 'zebra', createdAt: '2026-01-01' },
    { id: '1', name: 'alpha', createdAt: '2026-01-01' },
  ]);
  assert.deepEqual(out.map((d) => d.name), ['alpha', 'zebra']);
});

test('shapeDataset single row + null', () => {
  assert.equal(shapeDataset(null), null);
  assert.equal(shapeDataset({ id: 'x', name: 'n' })!.name, 'n');
});

// ─── shapeDatasetItems / shapeDatasetItem ─────────────────────────────────────
test('shapeDatasetItems renders fields to text + sorts', () => {
  const rows: RawDatasetItem[] = [
    { id: 'i1', status: 'ACTIVE', input: { q: 1 }, createdAt: '2026-01-01' },
    { id: 'i2', status: 'archived', input: 'plain', expectedOutput: { a: 2 }, createdAt: '2026-02-01' },
  ];
  const out = shapeDatasetItems(rows);
  assert.equal(out[0].id, 'i2'); // newer first
  assert.equal(out[0].status, 'ARCHIVED');
  assert.equal(out[0].expectedOutput, '{\n  "a": 2\n}');
  assert.equal(out[1].input, '{\n  "q": 1\n}');
  assert.equal(shapeDatasetItem(null), null);
  assert.equal(shapeDatasetItem(rows[0])!.id, 'i1');
});

test('shapeDatasetItems tie-breaks equal createdAt by id', () => {
  const out = shapeDatasetItems([
    { id: 'b', input: 'x', createdAt: '2026-01-01' },
    { id: 'a', input: 'y', createdAt: '2026-01-01' },
  ]);
  assert.deepEqual(out.map((i) => i.id), ['a', 'b']);
});

// ─── shapeDatasetRuns ─────────────────────────────────────────────────────────
test('shapeDatasetRuns normalizes + sorts', () => {
  const rows: RawDatasetRun[] = [
    { id: 'r1', name: 'run-a', createdAt: '2026-01-01' },
    { id: 'r2', name: 'run-b', description: 'd', createdAt: '2026-05-01' },
  ];
  const out = shapeDatasetRuns(rows);
  assert.equal(out[0].name, 'run-b');
  assert.equal(out[0].description, 'd');
  assert.deepEqual(shapeDatasetRuns(null as unknown as RawDatasetRun[]), []);
});
