import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectsBrowser } from '../src/components/projects/ProjectsBrowser.tsx';

test('the global utility bar does not claim page title or description ownership', async () => {
  const source = await readFile(new URL('../src/components/Topbar.tsx', import.meta.url), 'utf8');

  assert.match(source, /aria-label="Console utilities"/);
  assert.doesNotMatch(source, /ownerForPath/);
  assert.doesNotMatch(source, /<h1\b/);
  assert.doesNotMatch(source, /owner\.description/);
});

test('a collection surface renders one canonical page heading', () => {
  const html = renderToStaticMarkup(createElement(ProjectsBrowser));

  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /<h1[^>]*>Projects<\/h1>/);
  assert.equal((html.match(/Each project is a chat context/g) ?? []).length, 1);
});
