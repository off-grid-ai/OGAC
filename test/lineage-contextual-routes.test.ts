import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalLineagePath } from '../src/components/lineage/lineage-routes.ts';

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
