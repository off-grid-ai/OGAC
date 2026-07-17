import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopbarIdentity } from '../src/components/Topbar.tsx';
import { ContextualModuleShell } from '../src/components/nav/ContextualModuleShell.tsx';
import { CONTEXTUAL_MODULES } from '../src/modules/contextual-navigation.ts';
import { routeIdentityForPath } from '../src/modules/route-identity.ts';

test('Tools and Quality leaves compose one top-bar H1 with one content H2', () => {
  for (const [moduleId, path, leaf] of [
    ['solutions-tools', '/solutions/tools/catalog', 'Catalog'],
    ['solutions-quality', '/solutions/quality/golden-cases', 'Golden cases'],
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
            ContextualModuleShell,
            { moduleId },
            createElement('div', null, 'Destination content'),
          ),
        ),
      );

      assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
      assert.equal((html.match(/<h2\b/g) ?? []).length, 1);
      assert.match(html, new RegExp(`<h2[^>]*>${leaf}</h2>`));
      assert.doesNotMatch(html, /Solutions navigation|data-slot="tabs-list"/);
    } finally {
      delete process.env.NEXT_TEST_PATHNAME;
    }
  }
});

test('every contextual leaf is backed by the validated route owner and roots redirect', async () => {
  for (const module of CONTEXTUAL_MODULES) {
    const directory = module.id === 'solutions-tools' ? 'tools' : 'quality';
    await access(`src/app/(console)/solutions/${directory}/[destination]/page.tsx`);
    const root = await readFile(`src/app/(console)/solutions/${directory}/page.tsx`, 'utf8');
    assert.match(root, /redirect\(/);
  }

  const [tools, quality] = await Promise.all([
    readFile('src/app/(console)/solutions/tools/[destination]/page.tsx', 'utf8'),
    readFile('src/app/(console)/solutions/quality/[destination]/page.tsx', 'utf8'),
  ]);
  for (const source of [tools, quality]) {
    assert.match(source, /contextualDestination\(/);
    assert.match(source, /notFound\(\)/);
    assert.doesNotMatch(source, /<PageFrame|<h1\b|<SubNav|ToolsNav/);
  }
});
