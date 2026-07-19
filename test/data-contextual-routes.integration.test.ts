import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopbarIdentity } from '../src/components/Topbar.tsx';
import { DataContextualShell } from '../src/components/data/DataContextualShell.tsx';
import { PageFrame } from '../src/components/PageFrame.tsx';
import {
  CATALOG_DESTINATIONS,
  FLOW_DESTINATIONS,
  KNOWLEDGE_DESTINATIONS,
  WAREHOUSE_DESTINATIONS,
} from '../src/lib/data-destinations.ts';
import { routeIdentityForPath } from '../src/modules/route-identity.ts';

test('Data management leaves render one top-bar H1, one leaf H2, and one page frame', () => {
  for (const [moduleId, destinations, path, leaf] of [
    ['data-flows', FLOW_DESTINATIONS, '/data/flows/replication', 'Replication'],
    ['data-warehouse', WAREHOUSE_DESTINATIONS, '/data/warehouse/query', 'Query'],
    ['data-catalog', CATALOG_DESTINATIONS, '/data/catalog/governance', 'Governance'],
    ['data-knowledge', KNOWLEDGE_DESTINATIONS, '/data/knowledge/indexes', 'Indexes'],
  ] as const) {
    process.env.NEXT_TEST_PATHNAME = path;
    try {
      const identity = routeIdentityForPath(path);
      assert.ok(identity);
      const html = renderToStaticMarkup(
        createElement(
          Fragment,
          null,
          createElement(TopbarIdentity, { identity }),
          createElement(
            DataContextualShell,
            { destinations, moduleId },
            createElement(
              PageFrame,
              { embedded: true },
              createElement('div', null, 'Management content'),
            ),
          ),
        ),
      );

      assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
      assert.equal((html.match(/<h2\b/g) ?? []).length, 1);
      assert.equal((html.match(/data-og-shell="page"/g) ?? []).length, 1);
      assert.match(html, new RegExp(`<h2[^>]*>${leaf}</h2>`));
      assert.doesNotMatch(html, /data-slot="tabs-list"|Data navigation/);
    } finally {
      delete process.env.NEXT_TEST_PATHNAME;
    }
  }
});

test('nested Data entity details keep their standalone presentation', () => {
  process.env.NEXT_TEST_PATHNAME = '/data/catalog/asset-1';
  try {
    const html = renderToStaticMarkup(
      createElement(
        DataContextualShell,
        { destinations: CATALOG_DESTINATIONS, moduleId: 'data-catalog' },
        createElement(PageFrame, null, createElement('h2', null, 'Customer records')),
      ),
    );

    assert.equal((html.match(/data-og-shell="page"/g) ?? []).length, 1);
    assert.equal((html.match(/<h2\b/g) ?? []).length, 1);
    assert.match(html, />Customer records<\/h2>/);
    assert.doesNotMatch(html, />Assets<\/h2>/);
  } finally {
    delete process.env.NEXT_TEST_PATHNAME;
  }
});

test('a Data leaf can compose its actions into the owning contextual header', () => {
  process.env.NEXT_TEST_PATHNAME = '/data/catalog';
  try {
    const html = renderToStaticMarkup(
      createElement(
        DataContextualShell,
        {
          destinations: CATALOG_DESTINATIONS,
          moduleId: 'data-catalog',
          actions: createElement('button', null, 'Add dataset'),
        },
        createElement('div', { 'data-test-content': true }, 'Catalog content'),
      ),
    );

    assert.match(html, /<header[^>]*>.*Add dataset.*<\/header>/s);
    assert.ok(html.indexOf('Add dataset') < html.indexOf('data-test-content'));
  } finally {
    delete process.env.NEXT_TEST_PATHNAME;
  }
});
