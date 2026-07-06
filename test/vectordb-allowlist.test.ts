import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowExternal, hostOf, isAllowedVectorDbUrl } from '@/lib/vectordb-allowlist';

const CONFIGURED = { OFFGRID_QDRANT_URL: 'http://qdrant.internal:6333' };

test('hostOf parses full URLs, host:port, bare host, IPv6', () => {
  assert.equal(hostOf('http://127.0.0.1:6333/collections'), '127.0.0.1');
  assert.equal(hostOf('https://qdrant.internal:6333'), 'qdrant.internal');
  assert.equal(hostOf('qdrant.internal:6333'), 'qdrant.internal');
  assert.equal(hostOf('qdrant.internal'), 'qdrant.internal');
  assert.equal(hostOf('[::1]:6333'), '::1');
  assert.equal(hostOf('http://[::1]:6333/x'), '::1');
  assert.equal(hostOf('  HTTP://LOCALHOST:6333  '), 'localhost');
});

test('hostOf returns null on empty / null / garbage', () => {
  assert.equal(hostOf(''), null);
  assert.equal(hostOf(null), null);
  assert.equal(hostOf(undefined), null);
  assert.equal(hostOf('http://'), null);
});

test('allowExternal is a strict truthy opt-in', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' On ']) {
    assert.equal(allowExternal({ OFFGRID_VECTORDB_ALLOW_EXTERNAL: v }), true, v);
  }
  for (const v of ['', '0', 'false', 'no', 'off', undefined]) {
    assert.equal(allowExternal({ OFFGRID_VECTORDB_ALLOW_EXTERNAL: v }), false, String(v));
  }
});

test('loopback targets are always allowed', () => {
  for (const u of [
    'http://127.0.0.1:6333',
    'http://localhost:6333',
    'https://0.0.0.0:6333',
    'http://[::1]:6333',
    '127.0.0.1',
  ]) {
    assert.equal(isAllowedVectorDbUrl(u, CONFIGURED).allowed, true, u);
  }
});

test('the configured store host is allowed', () => {
  assert.equal(isAllowedVectorDbUrl('http://qdrant.internal:6333/x', CONFIGURED).allowed, true);
  // Different host on same config → rejected
  assert.equal(isAllowedVectorDbUrl('http://qdrant.evil:6333', CONFIGURED).allowed, false);
});

test('arbitrary external / internal hosts are REJECTED by default (SSRF defense)', () => {
  const cases = [
    'http://169.254.169.254/latest/meta-data', // cloud metadata SSRF classic
    'http://127.0.0.1:8200/v1/sys', // an internal service that is NOT the store
    'https://attacker.example.com',
    'http://10.0.0.5:6333',
  ];
  for (const u of cases) {
    const r = isAllowedVectorDbUrl(u, CONFIGURED);
    assert.equal(r.allowed, false, u);
    assert.match(r.reason ?? '', /not an allowed vector-store target/);
  }
});

test('missing / unparseable url is rejected (fail-closed)', () => {
  assert.equal(isAllowedVectorDbUrl('', CONFIGURED).allowed, false);
  assert.equal(isAllowedVectorDbUrl(null, CONFIGURED).allowed, false);
  assert.equal(isAllowedVectorDbUrl('http://', CONFIGURED).allowed, false);
});

test('OFFGRID_VECTORDB_ALLOW_EXTERNAL opt-in permits any host', () => {
  const env = { ...CONFIGURED, OFFGRID_VECTORDB_ALLOW_EXTERNAL: '1' };
  assert.equal(isAllowedVectorDbUrl('https://attacker.example.com', env).allowed, true);
  assert.equal(isAllowedVectorDbUrl('http://169.254.169.254', env).allowed, true);
});

test('with no configured store, only loopback passes (default-deny)', () => {
  const env = {};
  assert.equal(isAllowedVectorDbUrl('http://127.0.0.1:6333', env).allowed, true);
  assert.equal(isAllowedVectorDbUrl('http://qdrant.internal:6333', env).allowed, false);
});
