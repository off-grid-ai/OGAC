import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalLineagePath } from '../src/components/lineage/lineage-routes.ts';
import {
  contextualDestination,
  contextualDestinationForPath,
  contextualModule,
  defaultContextualDestination,
} from '../src/modules/contextual-navigation.ts';

test('Lineage exposes graph, datasets, and runs as durable destinations', () => {
  const lineage = contextualModule('data-lineage');
  assert.deepEqual(
    lineage.destinations.map(({ id, route }) => [id, route]),
    [
      ['graph', '/data/lineage/graph'],
      ['datasets', '/data/lineage/datasets'],
      ['runs', '/data/lineage/runs'],
    ],
  );
  assert.equal(defaultContextualDestination(lineage).id, 'graph');
  assert.equal(
    contextualDestinationForPath(lineage, '/data/lineage/datasets?dataset=customers')?.id,
    'datasets',
  );
  assert.equal(contextualDestination(lineage, 'filter'), undefined);
});

test('the Lineage root enters the graph without dropping query state', () => {
  assert.equal(canonicalLineagePath({}), '/data/lineage/graph');
  assert.equal(
    canonicalLineagePath({ namespace: 'private', window: ['24h', '7d'] }),
    '/data/lineage/graph?namespace=private&window=24h&window=7d',
  );
});

test('legacy dataset detail bookmarks enter the dataset destination', () => {
  assert.equal(
    canonicalLineagePath({ dataset: 'warehouse.customers', namespace: 'private' }),
    '/data/lineage/datasets?dataset=warehouse.customers&namespace=private',
  );
});
