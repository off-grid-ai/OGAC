import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(
  new URL('../src/components/services/RedpandaManager.tsx', import.meta.url),
  'utf8',
);

function headerContaining(title: string): string {
  const header = [...SOURCE.matchAll(/<CardHeader[\s\S]*?<\/CardHeader>/g)].find((match) =>
    match[0].includes(title),
  );

  assert.ok(header, `expected a CardHeader containing “${title}”`);
  return header[0];
}

test('schema and workflow guidance uses the shared full-width card description row', () => {
  for (const title of ['Create or update schema', 'Prove a business event end to end']) {
    const header = headerContaining(title);

    assert.match(header, /<CardDescription\b/);
    assert.doesNotMatch(header, /<p\b/);
  }
});

test('workflow proof status keeps its icon and title together in the primary header column', () => {
  const header = headerContaining('Latest proof');

  assert.match(header, /<div className="flex min-w-0 items-center gap-2">/);
  assert.match(header, /<CheckCircle[\s\S]*?<CardTitle[^>]*>Latest proof<\/CardTitle>/);
});
