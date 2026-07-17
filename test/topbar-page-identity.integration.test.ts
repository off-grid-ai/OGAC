import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectsBrowser } from '../src/components/projects/ProjectsBrowser.tsx';

test('the global utility bar does not claim page title or description ownership', async () => {
  const [topbarSource, sidebarSource] = await Promise.all([
    readFile(new URL('../src/components/Topbar.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(topbarSource, /aria-label="Console utilities"/);
  assert.match(topbarSource, /data-og-shell="topbar"/);
  assert.match(topbarSource, /data-og-surface="raised"/);
  assert.match(sidebarSource, /data-og-shell="sidebar"/);
  assert.match(sidebarSource, /data-og-surface="raised"/);
  assert.doesNotMatch(topbarSource, /ownerForPath/);
  assert.doesNotMatch(topbarSource, /<h1\b/);
  assert.doesNotMatch(topbarSource, /owner\.description/);

  // Brand rail and utility rail are one piece of shell chrome: their bottom borders must meet.
  assert.match(topbarSource, /className="flex h-14 [^"]*border-b/);
  assert.match(sidebarSource, /className="flex h-14 [^"]*border-b/);
});

test('a collection surface renders one canonical page heading', () => {
  const html = renderToStaticMarkup(createElement(ProjectsBrowser));

  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /<h1[^>]*>Projects<\/h1>/);
  assert.equal((html.match(/Each project is a chat context/g) ?? []).length, 1);
});
