import assert from 'node:assert/strict';
import test from 'node:test';
import { SEED_CONNECTORS } from '../src/lib/data-domains-demo-seed.ts';
import {
  ENTERPRISE_SOURCE_DEFINITIONS,
  findEnterpriseSource,
} from '../src/lib/enterprise-source-registry.ts';

test('enterprise source ontology contains the six fleet-owned logical systems exactly once', () => {
  assert.equal(ENTERPRISE_SOURCE_DEFINITIONS.length, 6);
  assert.deepEqual(
    ENTERPRISE_SOURCE_DEFINITIONS.map((source) => source.key),
    ['corebank', 'policyadmin', 'erp', 'kafka', 'minio', 'crm'],
  );
  assert.equal(new Set(ENTERPRISE_SOURCE_DEFINITIONS.map((source) => source.id)).size, 6);
  assert.equal(new Set(ENTERPRISE_SOURCE_DEFINITIONS.map((source) => source.process)).size, 6);
});

test('every source declares version honesty, system of record, and canonical Data routes', () => {
  for (const source of ENTERPRISE_SOURCE_DEFINITIONS) {
    assert.ok(source.version.trim(), `${source.id} records a version`);
    assert.match(source.systemOfRecord, /onprem-fleet-orchestration.+data-sources\.yml/);
    assert.equal(source.listRoute, '/data/sources');
    assert.equal(source.detailRoutePattern, '/data/connectors/[id]');
    assert.equal(source.managementRoute, '/data/sources');
    assert.ok(source.nextAction.trim(), `${source.id} has an honest next action`);
  }
  assert.equal(findEnterpriseSource('erp').mutableVersion, true);
  assert.equal(findEnterpriseSource('kafka').mutableVersion, false);
});

test('bank/insurance seed reuses the canonical source definitions instead of drifting endpoints', () => {
  assert.deepEqual(
    SEED_CONNECTORS.map((connector) => connector.key),
    ['corebank', 'policyadmin', 'erp', 'crm', 'minio'],
  );
  for (const connector of SEED_CONNECTORS) {
    const source = findEnterpriseSource(
      connector.key as 'corebank' | 'policyadmin' | 'erp' | 'crm' | 'minio',
    );
    assert.equal(connector.type, source.connectorType);
    assert.equal(connector.endpoint, source.seedEndpoint);
    assert.equal(connector.description, source.description);
  }
});
