import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOG_DESTINATIONS,
  FLOW_DESTINATIONS,
  KNOWLEDGE_DESTINATIONS,
  WAREHOUSE_DESTINATIONS,
  dataDestination,
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
