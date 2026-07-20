import assert from 'node:assert/strict';
import test from 'node:test';
import { SERVICE_CAPABILITY_AUDITS } from '../src/lib/service-capability-map.ts';
import { getServices, type ServiceEntry } from '../src/lib/services-directory.ts';
import {
  EXPECTED_ENTERPRISE_SOURCE_COUNT,
  EXPECTED_LOGICAL_INVENTORY_COUNT,
  EXPECTED_PLATFORM_SERVICE_COUNT,
  filterServiceInventory,
  isServiceInventoryAuditState,
  isServiceInventoryFamily,
  isServiceInventoryOwner,
  isServiceInventoryReadinessState,
  reconcileServiceInventory,
  serviceCapabilityMapHref,
  serviceInventoryAuditState,
  serviceInventoryReadinessState,
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

test('canonical inventory reconciles exactly 42 platform plus 6 enterprise sources to 48', () => {
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
  assert.equal(new Set(inventory.entries.map((entry) => entry.id)).size, 48);
});

test('inventory keeps platform services and enterprise sources under different IA owners', () => {
  const inventory = reconcileServiceInventory({ platformServices: canonicalServices() });
  const platform = inventory.entries.filter((entry) => entry.owner === 'operations-services');
  const sources = inventory.entries.filter((entry) => entry.owner === 'data-sources');

  assert.equal(platform.length, 42);
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
  assert.deepEqual(postgres?.capabilityAudit, {
    status: 'audited',
    auditState: 'current',
    verifiedGates: 9,
    partialGates: 5,
    totalGates: 16,
    productionItems: 1,
    totalItems: 4,
  });
  assert.deepEqual(postgres?.productionWorkflowCapabilityIds, ['relational-store']);
  assert.deepEqual(corebank?.capabilityAudit, {
    status: 'audited',
    auditState: 'stale',
    verifiedGates: 4,
    partialGates: 5,
    totalGates: 12,
    productionItems: 1,
    totalItems: 3,
  });
  assert.deepEqual(corebank?.productionWorkflowCapabilityIds, ['sql-read']);
  assert.equal(corebank?.deployment.version, '16-alpine (mutable image tag)');
  assert.equal(corebank?.deployment.mutableVersion, true);
  assert.ok((corebank?.seededWorkflowEvidence.length ?? 0) > 0);
});

test('all 39 canonical audits project consistently across the 48-entry inventory', () => {
  const inventory = reconcileServiceInventory({ platformServices: canonicalServices() });
  const auditStates = inventory.entries.reduce(
    (counts, entry) => {
      counts[serviceInventoryAuditState(entry)] += 1;
      return counts;
    },
    { current: 0, stale: 0, pending: 0 },
  );

  assert.equal(SERVICE_CAPABILITY_AUDITS.length, 39);
  assert.deepEqual(auditStates, { current: 22, stale: 17, pending: 9 });
  assert.equal(
    inventory.entries.filter((entry) => entry.capabilityAudit.status === 'audited').length,
    SERVICE_CAPABILITY_AUDITS.length,
  );
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

test('all 48 records carry routes, system-of-record provenance, and an honest next action', () => {
  const inventory = reconcileServiceInventory({ platformServices: canonicalServices() });
  for (const entry of inventory.entries) {
    assert.match(entry.routes.list, /^\//);
    assert.match(entry.routes.detailPattern, /^\//);
    assert.match(entry.routes.management, /^\//);
    assert.ok(entry.deployment.systemOfRecords.length > 0, `${entry.id} has provenance`);
    assert.ok(entry.nextAction.trim(), `${entry.id} has next action`);
  }
});

test('URL-style inventory filters search identity, IA facets, audit recency, and readiness', () => {
  const entries = reconcileServiceInventory({ platformServices: canonicalServices() }).entries;

  assert.deepEqual(
    filterServiceInventory(entries, { query: 'telemetry' }).map((entry) => entry.id),
    ['victoriametrics', 'otel-collector'],
  );
  assert.equal(filterServiceInventory(entries, { family: 'observability' }).length, 8);
  assert.equal(filterServiceInventory(entries, { owner: 'data-sources' }).length, 6);
  assert.equal(filterServiceInventory(entries, { readiness: 'unverified' }).length, 48);
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
  assert.equal(isServiceInventoryAuditState('stale'), true);
  assert.equal(isServiceInventoryAuditState('audited'), false);
  assert.equal(isServiceInventoryReadinessState('attention'), true);
  assert.equal(isServiceInventoryReadinessState('failed'), false);
});

test('audit and readiness facets derive only from canonical inventory evidence', () => {
  const entries = reconcileServiceInventory({ platformServices: canonicalServices() }).entries;
  const base = entries[0];
  assert.ok(base);
  const auditedSummary = {
    status: 'audited' as const,
    verifiedGates: 0,
    partialGates: 0,
    totalGates: 0,
    productionItems: 0,
    totalItems: 0,
  };
  const current = {
    ...base,
    id: 'current',
    capabilityAudit: { ...auditedSummary, auditState: 'current' as const },
    deployment: { ...base.deployment, mutableVersion: true, version: 'latest' },
  };
  const stale = {
    ...base,
    id: 'stale',
    capabilityAudit: { ...auditedSummary, auditState: 'stale' as const },
    deployment: { ...base.deployment, mutableVersion: false, version: '1.0.0' },
  };
  const pending = {
    ...base,
    id: 'pending',
    capabilityAudit: { status: 'not-audited' as const },
    deployment: { ...base.deployment, mutableVersion: true, version: 'stale' },
  };

  assert.equal(serviceInventoryAuditState(current), 'current');
  assert.equal(serviceInventoryAuditState(stale), 'stale');
  assert.equal(serviceInventoryAuditState(pending), 'pending');
  assert.deepEqual(
    filterServiceInventory([current, stale, pending], { audit: 'current' }).map(
      (entry) => entry.id,
    ),
    ['current'],
  );
  assert.deepEqual(
    filterServiceInventory([current, stale, pending], { audit: 'stale' }).map((entry) => entry.id),
    ['stale'],
  );
  assert.deepEqual(
    filterServiceInventory([current, stale, pending], { audit: 'pending' }).map(
      (entry) => entry.id,
    ),
    ['pending'],
  );

  const withReadiness = (states: Array<'pass' | 'fail' | 'unknown' | 'not-applicable'>) => ({
    ...pending,
    readiness: {
      deployed: states[0] ?? 'unknown',
      reachable: states[1] ?? 'unknown',
      functional: states[2] ?? 'unknown',
      seeded: states[3] ?? 'unknown',
      'console-used': states[4] ?? 'unknown',
    },
  });
  const verified = withReadiness(['pass', 'pass', 'pass', 'pass', 'pass']);
  const partial = withReadiness(['pass', 'pass', 'unknown', 'not-applicable', 'pass']);
  const attention = withReadiness(['pass', 'fail', 'unknown']);
  const unverified = withReadiness([]);
  assert.equal(serviceInventoryReadinessState(verified), 'verified');
  assert.equal(serviceInventoryReadinessState(partial), 'partial');
  assert.equal(serviceInventoryReadinessState(attention), 'attention');
  assert.equal(serviceInventoryReadinessState(unverified), 'unverified');
  assert.deepEqual(
    filterServiceInventory([verified, partial, attention, unverified], { readiness: 'verified' }),
    [verified],
  );
  assert.deepEqual(
    filterServiceInventory([verified, partial, attention, unverified], { readiness: 'partial' }),
    [partial],
  );
  assert.deepEqual(
    filterServiceInventory([verified, partial, attention, unverified], { readiness: 'attention' }),
    [attention],
  );
});

test('capability map URLs preserve explicit search, facets, and service selection', () => {
  assert.equal(serviceCapabilityMapHref(), '/operations/services/capability-map');
  assert.equal(
    serviceCapabilityMapHref({
      serviceId: 'otel collector',
      query: 'trace id',
      family: 'observability',
      owner: 'operations-services',
      audit: 'stale',
      readiness: 'partial',
    }),
    '/operations/services/capability-map?service=otel+collector&q=trace+id&family=observability&owner=operations-services&audit=stale&readiness=partial',
  );
  assert.equal(
    serviceCapabilityMapHref({ serviceId: 'otel-collector', query: '   ' }),
    '/operations/services/capability-map?service=otel-collector',
  );
});
