import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOG_DESTINATIONS,
  FLOW_DESTINATIONS,
  KNOWLEDGE_DESTINATIONS,
  WAREHOUSE_DESTINATIONS,
  dataDestination,
  isDataManagementLeaf,
} from '../src/lib/data-destinations.ts';

test('Data exposes each existing management place as a stable route', () => {
  assert.deepEqual(
    FLOW_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['overview', '/data/flows'],
      ['replication', '/data/flows/replication'],
      ['orchestration', '/data/flows/orchestration'],
    ],
  );
  assert.deepEqual(
    WAREHOUSE_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['tables', '/data/warehouse'],
      ['query', '/data/warehouse/query'],
      ['models', '/data/warehouse/models'],
    ],
  );
  assert.deepEqual(
    CATALOG_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['assets', '/data/catalog'],
      ['governance', '/data/catalog/governance'],
    ],
  );
  assert.deepEqual(
    KNOWLEDGE_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['collections', '/data/knowledge'],
      ['indexes', '/data/knowledge/indexes'],
    ],
  );
});

test('Data destination lookup accepts known leaves and rejects unknown leaves', () => {
  assert.equal(dataDestination(FLOW_DESTINATIONS, 'replication'), FLOW_DESTINATIONS[1]);
  assert.equal(dataDestination(WAREHOUSE_DESTINATIONS, 'query'), WAREHOUSE_DESTINATIONS[1]);
  assert.equal(dataDestination(CATALOG_DESTINATIONS, 'missing'), undefined);
  assert.equal(dataDestination(KNOWLEDGE_DESTINATIONS, undefined), undefined);
});

test('only exact management leaves enter the contextual shell', () => {
  assert.equal(isDataManagementLeaf(WAREHOUSE_DESTINATIONS, '/data/warehouse'), true);
  assert.equal(
    isDataManagementLeaf(WAREHOUSE_DESTINATIONS, '/data/warehouse/query?sql=SELECT+1'),
    true,
  );
  assert.equal(isDataManagementLeaf(CATALOG_DESTINATIONS, '/data/catalog/'), true);
  assert.equal(isDataManagementLeaf(CATALOG_DESTINATIONS, '/data/catalog/asset-1'), false);
  assert.equal(isDataManagementLeaf(KNOWLEDGE_DESTINATIONS, '/data/knowledge/collection-1'), false);
  assert.equal(isDataManagementLeaf(FLOW_DESTINATIONS, '/data/flows/orchestration/job-1'), false);
});
