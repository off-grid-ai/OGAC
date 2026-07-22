import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function doc(path: string): Promise<string> {
  return readFile(new URL(path, root), 'utf8');
}

test('context-builder records separate first-party evidence from the upstream denominator', async () => {
  const [map, status, gaps] = await Promise.all([
    doc('docs/SERVICE_CAPABILITY_MAP.md'),
    doc('docs/SERVICE_CAPABILITY_STATUS.md'),
    doc('docs/GAPS_BACKLOG.md'),
  ]);

  assert.match(map, /## First-party capability planes/);
  assert.match(map, /do not create synthetic services or\s+inflate an upstream denominator/);
  assert.match(status, /Enterprise Context and Catalogue-driven Builder live-verified delta/);
  assert.match(status, /df60a318847b7669296e428f0ecfa22b96b1bba1/);
  assert.match(status, /No pipeline \(unbound\)/);
  assert.match(status, /does not alter the 171 upstream capability denominator/);
  assert.match(gaps, /\[G-CONTEXT-BUILDER\] RESOLVED \+ LIVE/);
  assert.match(gaps, /\[G-CONTEXT-FORGE-PIPELINE\] OPEN/);
});

test('operator guidance explains governed catalogue states without technical identifiers', async () => {
  const guide = await doc('docs/user/app-builder.md');

  assert.match(guide, /## What “Available to you” means/);
  assert.match(guide, /Ready to add/);
  assert.match(guide, /Needs approval/);
  assert.match(guide, /Setup needed/);
  assert.match(guide, /No pipeline \(unbound\)/);
  assert.doesNotMatch(guide, /resource ref|sliceId|authorization projection/);
});
