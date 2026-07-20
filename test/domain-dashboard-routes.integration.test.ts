import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROUTES = [
  'work',
  'solutions',
  'data',
  'runtime',
  'governance',
  'insights',
  'operations',
] as const;

test('every top-level domain route renders the shared dashboard composition', async () => {
  const sources = await Promise.all(
    ROUTES.map((route) => readFile(`src/app/(console)/${route}/page.tsx`, 'utf8')),
  );
  for (const [index, source] of sources.entries()) {
    assert.match(source, /<DomainDashboard model=/, `${ROUTES[index]} must render DomainDashboard`);
    assert.doesNotMatch(
      source,
      /redirect\(/,
      `${ROUTES[index]} must be a consumable landing route`,
    );
  }
});

test('legacy management roots remain available below a named depth transition', async () => {
  const expected = {
    data: 'Manage the data plane',
    governance: 'Manage controls',
    insights: 'Inspect evidence',
  } as const;
  for (const [route, heading] of Object.entries(expected)) {
    const source = await readFile(`src/app/(console)/${route}/page.tsx`, 'utf8');
    assert.match(source, new RegExp(heading));
  }
});
