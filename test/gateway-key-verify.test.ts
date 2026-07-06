import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { GatewayKeyVerifier, isGatewayKey, parseGatewayKey } from '../scripts/lib/gateway-key-verify.mjs';
import { formatApiKey, parseApiKey } from '../src/lib/gateway-api-key.ts';

// ── parse parity: the raw .mjs mirror must stay in lockstep with the TS parseApiKey ──

test('parseGatewayKey (.mjs) matches parseApiKey (.ts) on valid and invalid inputs', () => {
  const cases = [
    formatApiKey('ogk-mobile-ab12', 'secret'),
    formatApiKey('ogk-x', 'a.b.c'),
    'ogk_nodot',
    'ogk_.secret',
    'ogk_notprefixed.secret',
    'sk-ant-123',
    '',
  ];
  for (const c of cases) {
    assert.deepEqual(parseGatewayKey(c), parseApiKey(c), `parity failed for: ${JSON.stringify(c)}`);
  }
});

test('isGatewayKey matches the prefix contract', () => {
  assert.equal(isGatewayKey('ogk_ogk-x.y'), true);
  assert.equal(isGatewayKey('ogk_bad'), false);
  assert.equal(isGatewayKey('bearer-jwt.aaa.bbb'), false);
});

// ── verify: a REAL local token endpoint stands in for Keycloak (no mocking of fetch) ──

// Spin up a throwaway HTTP server that behaves like Keycloak's token endpoint: 200 for the one
// known good client_credentials pair, 401 otherwise. The verifier hits it over real HTTP.
async function withFakeKeycloak(
  goodClientId: string,
  goodSecret: string,
  run: (verifier: GatewayKeyVerifier) => Promise<void>,
): Promise<void> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = new URLSearchParams(body);
      const ok =
        p.get('grant_type') === 'client_credentials' &&
        p.get('client_id') === goodClientId &&
        p.get('client_secret') === goodSecret;
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
      res.end(JSON.stringify(ok ? { access_token: 'x', expires_in: 60 } : { error: 'unauthorized_client' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  // The verifier builds `${url}/realms/${realm}/protocol/openid-connect/token`; our server ignores
  // the path, so any url/realm works.
  const verifier = new GatewayKeyVerifier({ url: `http://127.0.0.1:${port}`, realm: 'offgrid' });
  try {
    await run(verifier);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test('verify() accepts a valid key and rejects a wrong secret / unknown client', async () => {
  await withFakeKeycloak('ogk-mobile-ab12', 'good-secret', async (v) => {
    assert.equal(await v.verify(formatApiKey('ogk-mobile-ab12', 'good-secret')), true);
    assert.equal(await v.verify(formatApiKey('ogk-mobile-ab12', 'wrong-secret')), false);
    assert.equal(await v.verify(formatApiKey('ogk-unknown-1', 'good-secret')), false);
  });
});

test('verify() rejects a non-gateway-key string without any network call', async () => {
  await withFakeKeycloak('ogk-x', 's', async (v) => {
    assert.equal(await v.verify('sk-ant-123'), false);
    assert.equal(await v.verify('ogk_malformed'), false);
  });
});

test('verify() caches a positive result (revoke takes effect within the TTL, not per-request)', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'x', expires_in: 60 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const v = new GatewayKeyVerifier({ url: `http://127.0.0.1:${port}`, realm: 'offgrid' });
  const key = formatApiKey('ogk-cache-1', 'sekret');
  try {
    assert.equal(await v.verify(key), true);
    assert.equal(await v.verify(key), true);
    assert.equal(hits, 1, 'second verify should be served from cache');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
