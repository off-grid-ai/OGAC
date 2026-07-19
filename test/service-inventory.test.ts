import assert from 'node:assert/strict';
import test from 'node:test';
import { getServices, type ServiceEntry } from '../src/lib/services-directory.ts';
import {
  EXPECTED_ENTERPRISE_SOURCE_COUNT,
  EXPECTED_LOGICAL_INVENTORY_COUNT,
  EXPECTED_PLATFORM_SERVICE_COUNT,
  filterServiceInventory,
  isServiceInventoryFamily,
  isServiceInventoryOwner,
  reconcileServiceInventory,
} from '../src/lib/service-inventory.ts';

function canonicalServices(): ServiceEntry[] {
  const previous = process.env.OFFGRID_SERVICES;
  delete process.env.OFFGRID_SERVICES;
  try {
    return getServices();
  } finally {
    if (previous === undefined) delete process.env.OFFGRID_SERVICES;
    else process.env.OFFGRID_SERVICES = previous;
  }
}

test('canonical inventory reconciles exactly 43 platform plus 6 enterprise sources to 49', () => {
  const inventory = reconcileServiceInventory({ platformServices: canonicalServices() });
  assert.deepEqual(
    {
      platform: inventory.platformCount,
      sources: inventory.enterpriseSourceCount,
      total: inventory.totalCount,
      exact: inventory.exactContract,
      issues: inventory.issues,
    },
    {
      platform: EXPECTED_PLATFORM_SERVICE_COUNT,
      sources: EXPECTED_ENTERPRISE_SOURCE_COUNT,
      total: EXPECTED_LOGICAL_INVENTORY_COUNT,
      exact: true,
      issues: [],
    },
  );
  assert.equal(new Set(inventory.entries.map((entry) => entry.id)).size, 49);
});

test('inventory keeps platform services and enterprise sources under different IA owners', () => {
  const inventory = reconcileServiceInventory({ platformServices: canonicalServices() });
  const platform = inventory.entries.filter((entry) => entry.owner === 'operations-services');
  const sources = inventory.entries.filter((entry) => entry.owner === 'data-sources');

  assert.equal(platform.length, 43);
  assert.equal(sources.length, 6);
  assert.ok(platform.every((entry) => entry.routes.list === '/operations/services'));
  assert.ok(sources.every((entry) => entry.routes.list === '/data/sources'));
  assert.ok(sources.every((entry) => entry.routes.detailPattern === '/data/connectors/[id]'));
  assert.ok(platform.every((entry) => entry.family !== 'unclassified'));
});

test('capability coverage is projected from the canonical audit registry without fake zeros', () => {
  const inventory = reconcileServiceInventory({ platformServices: canonicalServices() });
  const evidently = inventory.entries.find((entry) => entry.id === 'evidently');
  const presidio = inventory.entries.find((entry) => entry.id === 'presidio');
  const postgres = inventory.entries.find((entry) => entry.id === 'postgres');
  const corebank = inventory.entries.find((entry) => entry.id === 'enterprise-source-corebank');

  assert.equal(evidently?.capabilityAudit.status, 'audited');
  assert.deepEqual(evidently?.productionWorkflowCapabilityIds, []);
  assert.ok((evidently?.explicitCapabilityGaps.length ?? 0) > 0);
  assert.ok((presidio?.productionWorkflowCapabilityIds.length ?? 0) > 0);
  assert.deepEqual(postgres?.capabilityAudit, { status: 'not-audited' });
  assert.deepEqual(corebank?.capabilityAudit, { status: 'not-audited' });
  assert.equal(corebank?.deployment.version, '16-alpine');
  assert.equal(corebank?.deployment.mutableVersion, true);
  assert.ok((corebank?.seededWorkflowEvidence.length ?? 0) > 0);
});

test('reconciliation fails honestly for drift, duplicate ids, and unknown platform entries', () => {
  const canonical = canonicalServices();
  const custom: ServiceEntry = {
    id: canonical[0]?.id ?? 'console',
    label: 'Duplicate',
    description: 'Duplicate test entry',
    url: 'http://127.0.0.1:9999',
    auth: 'api-key',
    kind: 'api',
  };
  const unknown: ServiceEntry = { ...custom, id: 'new-unclassified-service', label: 'Unknown' };
  const inventory = reconcileServiceInventory({
    platformServices: [...canonical.slice(0, 42), custom, unknown],
  });

  assert.equal(inventory.exactContract, false);
  assert.ok(inventory.issues.some((issue) => issue.code === 'platform-count'));
  assert.ok(inventory.issues.some((issue) => issue.code === 'logical-count'));
  assert.ok(inventory.issues.some((issue) => issue.code === 'duplicate-id'));
  assert.ok(inventory.issues.some((issue) => issue.code === 'unclassified-platform'));
});

test('all 49 records carry routes, system-of-record provenance, and an honest next action', () => {
  const inventory = reconcileServiceInventory({ platformServices: canonicalServices() });
  for (const entry of inventory.entries) {
    assert.match(entry.routes.list, /^\//);
    assert.match(entry.routes.detailPattern, /^\//);
    assert.match(entry.routes.management, /^\//);
    assert.ok(entry.deployment.systemOfRecords.length > 0, `${entry.id} has provenance`);
    assert.ok(entry.nextAction.trim(), `${entry.id} has next action`);
  }
});

test('URL-style inventory filters search identity and narrow by family and IA owner', () => {
  const entries = reconcileServiceInventory({ platformServices: canonicalServices() }).entries;

  assert.deepEqual(
    filterServiceInventory(entries, { query: 'telemetry' }).map((entry) => entry.id),
    ['otel-collector'],
  );
  assert.equal(filterServiceInventory(entries, { family: 'observability' }).length, 8);
  assert.equal(filterServiceInventory(entries, { owner: 'data-sources' }).length, 6);
  assert.deepEqual(
    filterServiceInventory(entries, {
      query: 'claims',
      family: 'enterprise-source',
      owner: 'data-sources',
    }).map((entry) => entry.id),
    ['enterprise-source-corebank', 'enterprise-source-kafka'],
  );
});

test('inventory filter guards accept only canonical URL values', () => {
  assert.equal(isServiceInventoryFamily('runtime'), true);
  assert.equal(isServiceInventoryFamily('unknown'), false);
  assert.equal(isServiceInventoryOwner('operations-services'), true);
  assert.equal(isServiceInventoryOwner('operations'), false);
});
