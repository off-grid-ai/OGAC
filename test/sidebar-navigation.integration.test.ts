import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SolutionsLayout from '../src/app/(console)/solutions/layout.tsx';
import { SidebarNav } from '../src/components/Sidebar.tsx';

test('the rendered sidebar is the only global collection hierarchy', () => {
  const html = renderToStaticMarkup(createElement(SidebarNav));

  for (const [label, href] of [
    ['Library', '/solutions/library'],
    ['Deployed', '/solutions/deployed'],
    ['Prompts', '/work/prompts'],
    ['Artifacts', '/work/artifacts'],
    ['Domains', '/data/domains'],
    ['Warehouse', '/data/warehouse'],
    ['Teams', '/governance/teams'],
    ['Guardrails', '/governance/guardrails/overview'],
    ['Quality', '/insights/quality/scorecards'],
    ['Configuration', '/operations/configuration/settings'],
    ['Clusters', '/operations/clusters'],
    ['Backups', '/operations/backups'],
  ]) {
    assert.match(html, new RegExp(`href="${href}"`));
    assert.match(html, new RegExp(`>${label}<`));
  }

  assert.match(html, /aria-label="Primary navigation"/);
  assert.match(html, /data-og-surface="raised"/);
  assert.ok((html.match(/data-og-interactive="true"/g) ?? []).length > 8);
  assert.match(html, /href="\/overview"[^>]*>.*Home/s);
  assert.doesNotMatch(html, /aria-controls="nav-section-home"/);
  assert.match(html, /aria-controls="nav-section-solutions"/);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 7);
  assert.equal((html.match(/id="nav-section-[^"]+" hidden=""/g) ?? []).length, 7);
});

test('a canonical collection layout renders content without a competing horizontal nav', () => {
  const html = renderToStaticMarkup(
    createElement(SolutionsLayout, null, createElement('h1', null, 'Solution library')),
  );
  assert.match(html, /Solution library/);
  assert.doesNotMatch(html, /<nav|Solutions navigation|aria-current/);
});

test('a level-3 deep link exposes its active ancestors and remains collapsible', () => {
  process.env.NEXT_TEST_PATHNAME = '/solutions/tools/catalog';
  try {
    const html = renderToStaticMarkup(createElement(SidebarNav));

    assert.match(html, /aria-expanded="true"[^>]*aria-controls="nav-section-solutions"/);
    assert.doesNotMatch(html, /id="nav-section-solutions" hidden=""/);
    assert.match(html, /<details[^>]*open=""[^>]*>/);
    assert.match(
      html,
      /href="\/solutions\/tools\/catalog"[^>]*aria-current="page"[^>]*>.*Catalog/s,
    );
    assert.match(html, /aria-label="Tools destinations"/);
    assert.match(html, /aria-label="Quality destinations"/);
    assert.doesNotMatch(html, /href="\/solutions\/tools\?tab=/);
  } finally {
    delete process.env.NEXT_TEST_PATHNAME;
  }
});
