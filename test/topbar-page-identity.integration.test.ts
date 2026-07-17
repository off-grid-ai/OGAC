import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopbarIdentity } from '../src/components/Topbar.tsx';
import { routeIdentityForPath } from '../src/modules/route-identity.ts';

test('the global top bar owns canonical route identity beside the utility controls', async () => {
  const [topbarSource, sidebarSource] = await Promise.all([
    readFile(new URL('../src/components/Topbar.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(topbarSource, /aria-label="Console header"/);
  assert.match(topbarSource, /data-og-shell="topbar"/);
  assert.match(topbarSource, /data-og-surface="raised"/);
  assert.match(topbarSource, /routeIdentityForPath/);
  assert.match(sidebarSource, /data-og-shell="sidebar"/);
  assert.match(sidebarSource, /data-og-surface="raised"/);

  // Brand rail and header rail remain one shell plane.
  assert.match(topbarSource, /className="flex h-14 [^"]*border-b/);
  assert.match(sidebarSource, /className="flex h-14 [^"]*border-b/);
});

test('contextual Tools and Quality routes map to their canonical shell identity', () => {
  assert.deepEqual(routeIdentityForPath('/solutions/tools/catalog'), {
    eyebrow: 'Solutions',
    title: 'Tools',
    description: 'Register, discover, and inspect every tool an app can call.',
    ownerId: 'tools',
    headingOwner: 'shell',
  });
  assert.deepEqual(routeIdentityForPath('/solutions/quality/golden-cases?source=review#case-1'), {
    eyebrow: 'Solutions',
    title: 'Quality',
    description: 'Define evaluators, maintain golden cases, and inspect quality runs.',
    ownerId: 'quality-definitions',
    headingOwner: 'shell',
  });
});

test('each contextual module renders exactly one shell H1 and its canonical description', () => {
  for (const pathname of ['/solutions/tools/registered', '/solutions/quality/runs']) {
    const identity = routeIdentityForPath(pathname);
    assert.ok(identity);
    const html = renderToStaticMarkup(createElement(TopbarIdentity, { identity }));

    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, pathname);
    assert.equal((html.match(new RegExp(identity.description, 'g')) ?? []).length, 1, pathname);
    assert.match(html, new RegExp(`<h1[^>]*>${identity.title}<\\/h1>`), pathname);
    assert.match(html, new RegExp(`data-og-route-identity="${identity.ownerId}"`), pathname);
  }
});

test('ordinary collection routes keep their content-owned H1', () => {
  const identity = routeIdentityForPath('/work/projects/project-42');
  assert.deepEqual(identity, {
    eyebrow: 'Work',
    title: 'Projects',
    description: 'Shared instructions, conversations, apps, and activity.',
    ownerId: 'projects',
    headingOwner: 'content',
  });

  const html = renderToStaticMarkup(createElement(TopbarIdentity, { identity }));
  assert.equal((html.match(/<h1\b/g) ?? []).length, 0);
  assert.match(html, /<span[^>]*>Projects<\/span>/);
});
