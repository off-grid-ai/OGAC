import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { gatewayFromHost as mjsResolver } from '../scripts/lib/gateway-host.mjs';
import { gatewayFromHost as tsResolver } from '../src/lib/route-access.ts';
import { tenantGatewayHost } from '../src/lib/tenant-domain.ts';

// PA-15 — the aggregator (plain .mjs, cannot import TS) carries a duplicated `gatewayFromHost`. This
// test PINS the two implementations to identical behaviour so they can never drift apart, and
// round-trips both against the host-shape source of truth (tenantGatewayHost).

const HOSTS = [
  'bharak7x2p-gateway.getoffgridai.co',
  'Bharak7X2P-Gateway.getoffgridai.co',
  'gateway.getoffgridai.co', // shared → null
  'bharatunion-onprem-console.getoffgridai.co', // console → null
  'getoffgridai.co',
  'short-gateway.getoffgridai.co', // label too short → null
  'waytoolonglabel-gateway.getoffgridai.co', // label too long → null
  '',
];

test('gateway-host.mjs matches the canonical route-access.ts resolver on every case', () => {
  for (const h of HOSTS) {
    assert.deepEqual(mjsResolver(h), tsResolver(h), `mismatch for host "${h}"`);
  }
  assert.deepEqual(mjsResolver(null), tsResolver(null));
});

test('gateway-host.mjs round-trips a minted tenant gateway host', () => {
  const host = tenantGatewayHost('bharatunion', 'k7x2p');
  const parts = mjsResolver(host);
  assert.ok(parts);
  assert.equal(parts.label, 'bharak7x2p');
  assert.equal(parts.slugPrefix, 'bhara');
  assert.equal(parts.randSuffix, 'k7x2p');
});
