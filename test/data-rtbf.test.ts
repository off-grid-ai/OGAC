import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRtbfScope, type RtbfAsset } from '../src/lib/data-rtbf.ts';
import { planErasure } from '../src/lib/erasure.ts';
import { proposeCatalogAssets } from '../src/lib/data-catalog-seed.ts';

// PURE unit tests for RTBF scope resolution + the catalog-seed proposer. RTBF must cross EVERY plane
// and be honest about what runs now vs. what the data engine runs later.

test('resolveRtbfScope: console steps are immediate, PII warehouse assets + vector + lineage are deferred', () => {
  const assets: RtbfAsset[] = [
    { id: 'da_1', name: 'Customer master', source: 'Core Bank', hasPii: true, piiTags: ['PAN', 'EMAIL'] },
    { id: 'da_2', name: 'Rate card', source: 'Config', hasPii: false, piiTags: [] },
  ];
  const scope = resolveRtbfScope('alice@corp.in', assets);

  // Every console-plane erasure step is present + immediate.
  const consolePlan = planErasure('alice@corp.in');
  const consoleTargets = scope.targets.filter((t) => t.plane === 'console');
  assert.equal(consoleTargets.length, consolePlan.steps.length);
  assert.ok(consoleTargets.every((t) => t.execution === 'immediate'));

  // The PII warehouse asset is in scope (deferred); the non-PII one is NOT.
  const warehouse = scope.targets.filter((t) => t.plane === 'warehouse');
  assert.equal(warehouse.length, 1, 'only the PII-bearing asset is in scope');
  assert.equal(warehouse[0].ref, 'da_1');
  assert.ok(warehouse[0].execution === 'deferred');

  // Vector + lineage planes are always present and deferred.
  assert.ok(scope.targets.some((t) => t.plane === 'vector' && t.execution === 'deferred'));
  assert.ok(scope.targets.some((t) => t.plane === 'lineage' && t.execution === 'deferred'));

  assert.equal(scope.immediateCount, consolePlan.steps.length);
  assert.ok(scope.deferredCount >= 3); // 1 warehouse + vector + lineage
});

test('resolveRtbfScope: empty subject resolves to an empty scope', () => {
  const scope = resolveRtbfScope('   ', []);
  assert.equal(scope.subject, '');
  assert.deepEqual(scope.targets, []);
  assert.equal(scope.immediateCount, 0);
  assert.equal(scope.deferredCount, 0);
});

test('proposeCatalogAssets: a domain becomes an asset bound to its connector; a bare connector gets a placeholder', () => {
  const connectors = [
    { id: 'con_pg', name: 'Core Bank DB', type: 'postgres' },
    { id: 'con_s3', name: 'Docs Bucket', type: 's3' },
  ];
  const domains = [{ id: 'dom_txn', label: 'transactions', connectorId: 'con_pg', resource: 'txns' }];

  const proposals = proposeCatalogAssets(connectors, domains);
  // Domain → one asset; the S3 connector has no domain → one placeholder.
  assert.equal(proposals.length, 2);
  const txn = proposals.find((p) => p.domainId === 'dom_txn');
  assert.ok(txn);
  assert.equal(txn!.connectorId, 'con_pg');
  assert.equal(txn!.kind, 'table');
  const s3 = proposals.find((p) => p.connectorId === 'con_s3');
  assert.ok(s3);
  assert.equal(s3!.domainId, null);
  assert.equal(s3!.kind, 'file', 's3 → file kind');
});

test('proposeCatalogAssets: never fabricates — no connectors ⇒ no proposals; existing names skipped', () => {
  assert.deepEqual(proposeCatalogAssets([], []), []);
  const connectors = [{ id: 'con_pg', name: 'DB', type: 'postgres' }];
  const proposals = proposeCatalogAssets(connectors, [], ['db dataset']);
  assert.equal(proposals.length, 0, 'existing name (case-insensitive) is skipped');
});
