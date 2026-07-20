import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(
  new URL('../src/components/build/AppBuilder.tsx', import.meta.url),
  'utf8',
);

test('builder card headers use the shared description slot for two-row layout', () => {
  assert.match(
    SOURCE,
    /<CardTitle[^>]*>[\s\S]*?The steps[\s\S]*?<CardDescription className="text-xs">[\s\S]*?The process we carved/,
  );
  assert.match(
    SOURCE,
    /<CardTitle[^>]*>[\s\S]*?Runs on[\s\S]*?<CardDescription className="text-\[11px\]">[\s\S]*?The governed pipeline/,
  );

  // The shared CardHeader is a two-column grid: only CardDescription owns the
  // full-width second row. A raw paragraph becomes column two and collides with
  // the title at wide viewports.
  for (const header of SOURCE.matchAll(/<CardHeader[\s\S]*?<\/CardHeader>/g)) {
    assert.doesNotMatch(header[0], /<p\b/);
  }
});
