import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsoleContent, FullBleedContent } from '../src/components/ConsoleContent.tsx';

test('one console container owns standard and full-bleed content spacing', () => {
  const standard = renderToStaticMarkup(
    createElement(ConsoleContent, null, createElement('section', null, 'Management page')),
  );
  const immersive = renderToStaticMarkup(
    createElement(
      ConsoleContent,
      null,
      createElement(FullBleedContent, null, createElement('section', null, 'Workspace')),
    ),
  );
  assert.match(standard, /<main[^>]*>.*Management page.*<\/main>/);
  assert.doesNotMatch(standard, /data-console-layout="/);
  assert.match(immersive, /<main[^>]*>.*data-console-layout="full-bleed".*Workspace.*<\/main>/);
  assert.match(immersive, /has-\[\[data-console-layout=full-bleed\]\]:overflow-hidden/);
  assert.match(immersive, /has-\[\[data-console-layout=full-bleed\]\]:p-0/);
});
