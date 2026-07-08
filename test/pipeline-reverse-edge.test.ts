import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allowlistReferencesTokens,
  domainMatchTokens,
  filterRowsByPipeline,
  normalizeRefToken,
  readPipelineParam,
  resolvePipelineFacet,
} from '../src/lib/pipelines-policy.ts';

// ─── normalizeRefToken ──────────────────────────────────────────────────────────────────────────────

test('normalizeRefToken: trims + lowercases; non-strings → ""', () => {
  assert.equal(normalizeRefToken('  Employee-Records '), 'employee-records');
  assert.equal(normalizeRefToken('KYC'), 'kyc');
  assert.equal(normalizeRefToken(''), '');
  assert.equal(normalizeRefToken(undefined), '');
  assert.equal(normalizeRefToken(42 as unknown), '');
});

// ─── domainMatchTokens ──────────────────────────────────────────────────────────────────────────────

test('domainMatchTokens: union of id + label + aliases, normalised + de-duped', () => {
  const tokens = domainMatchTokens({
    id: 'dom_abc123',
    label: 'Employee Records',
    aliases: ['employee-records', 'EMPLOYEE-RECORDS', 'staff'],
  });
  assert.deepEqual(tokens, ['dom_abc123', 'employee records', 'employee-records', 'staff']);
});

test('domainMatchTokens: tolerates missing label/aliases', () => {
  assert.deepEqual(domainMatchTokens({ id: 'dom_x' }), ['dom_x']);
  assert.deepEqual(domainMatchTokens({ id: 'dom_x', label: null, aliases: null }), ['dom_x']);
  assert.deepEqual(domainMatchTokens({ id: '' }), []);
});

// ─── allowlistReferencesTokens ───────────────────────────────────────────────────────────────────────

test('allowlistReferencesTokens: matches by id OR label OR alias, case-insensitively', () => {
  const tokens = domainMatchTokens({
    id: 'dom_abc',
    label: 'Employee Records',
    aliases: ['staff-data'],
  });
  // matched by label (as an operator typed the human name into the ceiling)
  assert.equal(allowlistReferencesTokens(['Employee Records', 'kyc'], tokens), true);
  // matched by id
  assert.equal(allowlistReferencesTokens(['dom_abc'], tokens), true);
  // matched by alias, different case
  assert.equal(allowlistReferencesTokens(['STAFF-DATA'], tokens), true);
  // no overlap
  assert.equal(allowlistReferencesTokens(['loan-applications'], tokens), false);
  // empty tokens never match
  assert.equal(allowlistReferencesTokens(['anything'], []), false);
  // empty allowlist never matches
  assert.equal(allowlistReferencesTokens([], tokens), false);
});

// ─── readPipelineParam ──────────────────────────────────────────────────────────────────────────────

test('readPipelineParam: coerces string | string[] | nullish to a trimmed single string', () => {
  assert.equal(readPipelineParam('pl_1'), 'pl_1');
  assert.equal(readPipelineParam('  pl_2 '), 'pl_2');
  assert.equal(readPipelineParam(['pl_3', 'pl_4']), 'pl_3');
  assert.equal(readPipelineParam(undefined), '');
  assert.equal(readPipelineParam(null), '');
  assert.equal(readPipelineParam([]), '');
});

// ─── resolvePipelineFacet ─────────────────────────────────────────────────────────────────────────

test('resolvePipelineFacet: keeps an owned id, else degrades to null ("all")', () => {
  const known = ['pl_a', 'pl_b'];
  assert.equal(resolvePipelineFacet('pl_a', known), 'pl_a');
  assert.equal(resolvePipelineFacet(['pl_b'], known), 'pl_b');
  // stale/forged id the org doesn't own → null, not an empty view
  assert.equal(resolvePipelineFacet('pl_ghost', known), null);
  // no param → all
  assert.equal(resolvePipelineFacet(undefined, known), null);
  assert.equal(resolvePipelineFacet('', known), null);
});

// ─── filterRowsByPipeline ─────────────────────────────────────────────────────────────────────────

test('filterRowsByPipeline: null facet returns all rows unchanged', () => {
  const rows = [{ project: 'pipeline:pl_a' }, { project: 'pipeline:pl_b' }];
  assert.deepEqual(filterRowsByPipeline(rows, null, (r) => [r.project]), rows);
});

test('filterRowsByPipeline: matches the `pipeline:<id>` tag OR the bare id, from any candidate field', () => {
  const rows = [
    { project: 'pipeline:pl_a', resource: null },
    { project: 'pipeline:pl_b', resource: null },
    { project: null, resource: 'pl_a' }, // bare id in a different field
    { project: '(unattributed)', resource: null },
  ];
  const out = filterRowsByPipeline(rows, 'pl_a', (r) => [r.project, r.resource]);
  assert.equal(out.length, 2);
  assert.ok(out.includes(rows[0]));
  assert.ok(out.includes(rows[2]));
});
