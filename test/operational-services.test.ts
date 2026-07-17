import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOperationalServices } from '@/lib/operational-services';
import { getServices } from '@/lib/services-directory';

test('operational registry covers control, workers, edge, public surfaces, and forwarders', () => {
  const roles = getOperationalServices({ OFFGRID_GATEWAY_URL: 'http://gateway:8800' });
  assert.deepEqual(
    new Set(roles.map((entry) => entry.operationalRole)),
    new Set(['control', 'worker', 'edge', 'public-surface', 'forwarder']),
  );
  assert.equal(roles.find((entry) => entry.id === 'gateway-control')?.url, 'http://gateway:8800');
  assert.match(roles.find((entry) => entry.id === 'agent-worker')?.fallbackLabel ?? '', /Temporal/);
});

test('canonical directory includes audited missing logical services', () => {
  const ids = new Set(getServices().map((entry) => entry.id));
  for (const id of [
    'postgres',
    'llm-guard',
    'litellm',
    'gateway-control',
    'cloudflared',
    'landing',
    'status-page',
  ]) {
    assert.equal(ids.has(id), true, `${id} must be represented`);
  }
});
