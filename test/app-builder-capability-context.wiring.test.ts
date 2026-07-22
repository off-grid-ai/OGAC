import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('AppBuilder loads one context and threads that same state into both editors', () => {
  const source = readFileSync(
    new URL('../src/components/build/AppBuilder.tsx', import.meta.url),
    'utf8',
  );
  assert.equal((source.match(/useBuilderCapabilityContext\(/g) ?? []).length, 1);
  assert.equal((source.match(/capabilityContext=\{capabilityContext\.state\}/g) ?? []).length, 2);
});
