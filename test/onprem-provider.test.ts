// The Providers page listed five CLOUD providers and omitted the on-prem gateway entirely — on a page
// headed "Available model providers and endpoints", with a cloud router as the only entry marked
// `available`, while the thing actually serving every request did not appear at all.
//
// These tests pin the two properties that make the fix meaningful: the local gateway is present and
// FIRST, and its status reflects what is really being served rather than the fact that a process is up.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ONPREM_PROVIDER_ID,
  onPremProviderRow,
  providersWithOnPrem,
  type PoolModel,
  type ProviderRow,
} from '@/lib/onprem-provider';

const cloud = (id: string, available = false): ProviderRow => ({
  id,
  label: id,
  baseUrl: `https://api.${id}.com/v1`,
  configured: available,
  defaultModel: 'x',
  prefixes: [id],
  health: available ? 'up' : 'unconfigured',
  probeStatus: available ? 200 : 0,
  available,
});

const POOL: PoolModel[] = [
  { id: 'qwythos-9b-1m', gateways: ['g7'] },
  { id: 'qwen35-2b', gateways: ['g3'] },
];

test('the on-prem gateway is present and FIRST', () => {
  // Order is the product statement: local is the default path, every cloud row is opt-in egress.
  const rows = providersWithOnPrem(POOL, [cloud('openai'), cloud('anthropic')]);
  assert.equal(rows[0].id, ONPREM_PROVIDER_ID);
  assert.equal(rows[0].onPrem, true);
  assert.equal(rows.length, 3, 'cloud providers are kept, not replaced');
});

test('it is available when the pool is serving, and lists what it serves', () => {
  const row = onPremProviderRow(POOL);
  assert.equal(row.available, true);
  assert.equal(row.health, 'up');
  assert.deepEqual(row.prefixes, ['qwythos-9b-1m', 'qwen35-2b']);
  assert.equal(row.defaultModel, 'qwythos-9b-1m');
});

test('an EMPTY pool is reported as unavailable, not as a healthy provider', () => {
  // The failure this guards: claiming the local provider is fine because the process is up, while
  // nothing is actually being served. Same standard the cloud rows are held to.
  const row = onPremProviderRow([]);
  assert.equal(row.available, false);
  assert.equal(row.health, 'down');
  assert.equal(row.defaultModel, '');
  assert.match(row.note ?? '', /cannot be answered locally/i);
});

test('it counts the nodes serving, not the models', () => {
  // Two models on one node is ONE node. Saying "2 nodes" would overstate the fleet.
  const oneNode = onPremProviderRow([
    { id: 'a', gateways: ['g7'] },
    { id: 'b', gateways: ['g7'] },
  ]);
  assert.match(oneNode.baseUrl, /^1 node on this network$/);
  assert.match(onPremProviderRow(POOL).baseUrl, /^2 nodes on this network$/);
});

test('it never renders a raw endpoint address', () => {
  // The loopback address is identical on every install and tells a reader nothing; where it runs does.
  for (const row of [onPremProviderRow(POOL), onPremProviderRow([])]) {
    assert.doesNotMatch(row.baseUrl, /127\.0\.0\.1|localhost|:\d{2,5}|https?:/i);
  }
});

test('the note tells a reader what it means for their data', () => {
  const note = onPremProviderRow(POOL).note ?? '';
  assert.match(note, /nothing leaves your network/i);
  // No engine names, no internal component names — this is customer-facing copy.
  for (const internal of ['llama', 'aggregator', 'litellm', '8800']) {
    assert.ok(!note.toLowerCase().includes(internal), `note must not mention ${internal}`);
  }
});
