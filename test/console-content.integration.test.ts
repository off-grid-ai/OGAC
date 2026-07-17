import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsoleContent } from '../src/components/ConsoleContent.tsx';
import { PageFrame } from '../src/components/PageFrame.tsx';

test('layout and content stay full-size and neutral about route presentation', () => {
  const html = renderToStaticMarkup(
    createElement(
      ConsoleContent,
      null,
      createElement('section', { className: 'route-owned-presentation' }, 'Route content'),
    ),
  );

  assert.match(html, /<main data-og-shell="content" class="[^"]*w-full[^"]*">/);
  assert.match(html, /data-og-shell="route"/);
  assert.match(html, /route-owned-presentation/);
  assert.doesNotMatch(html.match(/<main[^>]*>/)?.[0] ?? '', /\bp-[0-9]|\bm-[0-9]|overflow-y-auto/);
});

test('the rendered route explicitly chooses management-page spacing', () => {
  const html = renderToStaticMarkup(
    createElement(
      ConsoleContent,
      null,
      createElement(PageFrame, null, createElement('section', null, 'Management page')),
    ),
  );

  assert.match(html, /<main[^>]*><div[^>]*><div class="[^"]*p-4 md:p-6[^"]*">/);
  assert.match(html, /data-og-shell="page"/);
  assert.match(html, /Management page/);
});
