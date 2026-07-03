import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildDatasetTagRequest,
  buildDatasetUntagRequest,
  buildJobTagRequest,
  buildNamespaceRequest,
  buildTagRequest,
  MARQUEZ_CAPABILITIES,
  normalizeName,
} from '../src/lib/lineage-writer.ts';

// Pure Marquez request-shaping. No network, no mocks — inputs in, request shape out.

test('normalizeName trims and rejects non-strings', () => {
  assert.equal(normalizeName('  offgrid  '), 'offgrid');
  assert.equal(normalizeName(''), '');
  assert.equal(normalizeName(42), '');
  assert.equal(normalizeName(undefined), '');
});

test('buildNamespaceRequest: PUT with default owner, encoded path', () => {
  const r = buildNamespaceRequest({ name: 'my ns' });
  assert.equal(r.method, 'PUT');
  assert.equal(r.path, '/api/v1/namespaces/my%20ns');
  assert.deepEqual(r.body, { ownerName: 'offgrid-console' });
});

test('buildNamespaceRequest: carries owner + description', () => {
  const r = buildNamespaceRequest({ name: 'ns', ownerName: 'team', description: 'desc' });
  assert.deepEqual(r.body, { ownerName: 'team', description: 'desc' });
});

test('buildNamespaceRequest: empty name throws', () => {
  assert.throws(() => buildNamespaceRequest({ name: '  ' }), /name required/);
});

test('buildTagRequest: PUT tag, optional description', () => {
  assert.deepEqual(buildTagRequest({ name: 'pii' }), {
    method: 'PUT',
    path: '/api/v1/tags/pii',
    body: {},
  });
  assert.deepEqual(buildTagRequest({ name: 'pii', description: 'sensitive' }).body, {
    description: 'sensitive',
  });
  assert.throws(() => buildTagRequest({ name: '' }), /tag name required/);
});

test('buildDatasetTagRequest / untag: POST + DELETE on encoded path', () => {
  const input = { namespace: 'ns', dataset: 'db.table', tag: 'pii' };
  assert.deepEqual(buildDatasetTagRequest(input), {
    method: 'POST',
    path: '/api/v1/namespaces/ns/datasets/db.table/tags/pii',
  });
  assert.equal(buildDatasetUntagRequest(input).method, 'DELETE');
  assert.throws(() => buildDatasetTagRequest({ namespace: '', dataset: 'd', tag: 't' }), /required/);
});

test('buildJobTagRequest: POST on job tag path', () => {
  const r = buildJobTagRequest({ namespace: 'ns', job: 'ingest', tag: 'critical' });
  assert.equal(r.method, 'POST');
  assert.equal(r.path, '/api/v1/namespaces/ns/jobs/ingest/tags/critical');
  assert.throws(() => buildJobTagRequest({ namespace: 'ns', job: '', tag: 't' }), /required/);
});

test('MARQUEZ_CAPABILITIES: delete honestly reported as unsupported', () => {
  assert.equal(MARQUEZ_CAPABILITIES.createNamespace, true);
  assert.equal(MARQUEZ_CAPABILITIES.tagDataset, true);
  assert.equal(MARQUEZ_CAPABILITIES.deleteEntity, false);
  assert.match(MARQUEZ_CAPABILITIES.deleteEntityReason, /append-only/);
});
