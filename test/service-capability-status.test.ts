import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ENTERPRISE_SOURCE_DEFINITIONS } from '../src/lib/enterprise-source-registry.ts';
import { getServices } from '../src/lib/services-directory.ts';

const STATUS_LEDGER = new URL('../docs/SERVICE_CAPABILITY_STATUS.md', import.meta.url);

test('service capability tracker names every canonical inventory entry exactly once', async () => {
  const markdown = await readFile(STATUS_LEDGER, 'utf8');
  const perServiceLedger = markdown
    .split('## Per-service ledger')[1]
    ?.split('## Pending audit actions')[0];
  const canonicalIds = [
    ...getServices().map((service) => service.id),
    ...ENTERPRISE_SOURCE_DEFINITIONS.map((source) => source.id),
  ];

  assert.equal(canonicalIds.length, 49);
  assert.equal(new Set(canonicalIds).size, 49);
  assert.ok(perServiceLedger, 'per-service ledger section must exist');

  for (const id of canonicalIds) {
    const ledgerRows = perServiceLedger
      .split('\n')
      .filter((line) => line.startsWith('|') && line.includes(`\`${id}\``));
    assert.equal(ledgerRows.length, 1, `${id} must have exactly one tracker row`);
  }
});

test('service capability tracker preserves the resume and release contracts', async () => {
  const markdown = await readFile(STATUS_LEDGER, 'utf8');

  assert.match(markdown, /## Current checkpoint/);
  assert.match(markdown, /## Active lanes/);
  assert.match(markdown, /## Per-service ledger/);
  assert.match(markdown, /## Release gates/);
  assert.match(markdown, /## Required worker handoff/);
  assert.match(markdown, /Next resumable action:/);
});
