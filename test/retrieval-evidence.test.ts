import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRetrievalExecutionEvidence,
  retrievalExecutionSummary,
  retrievalProviderId,
  withLineageDelivery,
} from '../src/lib/retrieval/evidence.ts';

test('provider identity defaults honestly and only selects supported adapters', () => {
  assert.equal(retrievalProviderId(undefined), 'lancedb');
  assert.equal(retrievalProviderId('unknown'), 'lancedb');
  assert.equal(retrievalProviderId('pgvector'), 'pgvector');
  assert.equal(retrievalProviderId('qdrant'), 'qdrant');
});

test('Qdrant evidence retains run, collection, tenant, metadata, ACL, and mode', () => {
  const evidence = buildRetrievalExecutionEvidence({
    correlationId: ' run_claim_42 ',
    selectedProvider: 'qdrant',
    qdrantCollection: 'claims-rules',
    selectedSourceIds: ['kb'],
    orgId: 'org_suraksha',
    options: {
      mode: 'hybrid',
      filter: {
        must: [
          { field: 'source', match: 'claims-playbook' },
          { field: 'product', any: ['motor', 'health'] },
          { field: 'text', text: 'authority limit' },
        ],
      },
      asker: { subject: 'claims.officer@suraksha.example', roles: ['claims'] },
    },
  });

  assert.equal(evidence.correlationId, 'run_claim_42');
  assert.equal(evidence.providerId, 'qdrant');
  assert.equal(evidence.collection, 'claims-rules');
  assert.equal(evidence.mode, 'hybrid');
  assert.deepEqual(
    evidence.filters.map(({ kind, field, operator }) => ({ kind, field, operator })),
    [
      { kind: 'tenant', field: 'org_id', operator: 'match' },
      { kind: 'metadata', field: 'source', operator: 'match' },
      { kind: 'metadata', field: 'product', operator: 'any' },
      { kind: 'metadata', field: 'text', operator: 'text' },
      { kind: 'acl', field: 'document_acl', operator: 'grants' },
    ],
  );
});

test('summary exposes proof shape without leaking filter values', () => {
  const base = buildRetrievalExecutionEvidence({
    selectedProvider: 'qdrant',
    selectedSourceIds: ['kb'],
    orgId: 'org_bharat',
    options: { filter: { must: [{ field: 'customer', match: 'sensitive-customer-id' }] } },
  });
  const evidence = withLineageDelivery(base, {
    adapterId: 'marquez',
    job: 'brain.retrieve.qdrant',
    runId: 'lineage-run',
    status: 'accepted',
    httpStatus: 201,
    attemptedAt: '2026-07-20T00:00:00.000Z',
    detail: 'accepted',
  });
  const summary = retrievalExecutionSummary(evidence);
  assert.match(summary, /provider=qdrant collection=offgrid-brain/);
  assert.match(summary, /metadata:customer\/match/);
  assert.match(summary, /lineage=marquez:accepted\/201/);
  assert.doesNotMatch(summary, /sensitive-customer-id/);
});

test('A LANCEDB RETRIEVAL NAMES THE TABLE IT READ', () => {
  // `collection` was Qdrant-only and hard-coded to null for every other provider, so a LanceDB
  // retrieval recorded WHICH provider ran but not WHAT it read. "The provider-neutral port selected
  // LanceDB" was therefore unfalsifiable — nothing distinguished it from a retrieval that touched no
  // store at all.
  const lance = buildRetrievalExecutionEvidence({
    selectedProvider: 'lancedb',
    lanceTable: 'documents',
    selectedSourceIds: ['kb'],
    orgId: 'org_bharat',
  });
  assert.equal(lance.providerId, 'lancedb');
  assert.equal(lance.collection, 'documents');
  assert.match(retrievalExecutionSummary(lance), /provider=lancedb collection=documents/);
});

test('the default provider is LanceDB, and it still names its table', () => {
  // No explicit provider means LanceDB on this deployment; the evidence must not go quiet just because
  // nobody set an env var.
  const implicit = buildRetrievalExecutionEvidence({
    lanceTable: 'documents',
    selectedSourceIds: ['kb'],
  });
  assert.equal(implicit.providerId, 'lancedb');
  assert.equal(implicit.collection, 'documents');
});

test('Qdrant keeps naming its collection, and pgvector reports NOT RECORDED rather than a guess', () => {
  const qdrant = buildRetrievalExecutionEvidence({
    selectedProvider: 'qdrant',
    selectedSourceIds: ['kb'],
  });
  assert.equal(qdrant.collection, 'offgrid-brain');
  // pgvector stores documents in a table too, but nothing threads its name yet. Null means "not
  // recorded"; inventing a plausible name would be worse than an honest blank.
  const pg = buildRetrievalExecutionEvidence({
    selectedProvider: 'pgvector',
    lanceTable: 'documents',
    selectedSourceIds: ['kb'],
  });
  assert.equal(pg.providerId, 'pgvector');
  assert.equal(pg.collection, null);
});

test('a missing table name is null, not an invented default', () => {
  const none = buildRetrievalExecutionEvidence({
    selectedProvider: 'lancedb',
    selectedSourceIds: ['kb'],
  });
  assert.equal(none.collection, null);
});
