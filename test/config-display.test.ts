import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG_REGISTRY, configConnectValue, configDisplayValue } from '@/lib/config-registry';

const host = { hostValue: true } as const;
const plain = { hostValue: false } as const;

test('host-bearing value displays as mDNS (no raw IP/loopback)', () => {
  assert.equal(configDisplayValue(host, 'http://127.0.0.1:8800'), 'http://offgrid-s1.local:8800/');
  assert.equal(configDisplayValue(host, 'http://127.0.0.1:6333'), 'http://offgrid-s1.local:6333/');
  assert.equal(configDisplayValue(host, 'http://127.0.0.1:8931'), 'http://offgrid-g6.local:8931/');
  assert.equal(configDisplayValue(host, 'redis://127.0.0.1:6379'), 'redis://offgrid-s1.local:6379');
});

test('display maps back to the real connect target on save (round-trip)', () => {
  // What the operator sees (mDNS) → what we persist/connect to (loopback), unchanged connectivity.
  assert.equal(configConnectValue(host, 'http://offgrid-s1.local:8800'), 'http://127.0.0.1:8800/');
  assert.equal(configConnectValue(host, 'http://offgrid-g6.local:8931'), 'http://127.0.0.1:8931/');
  assert.equal(configConnectValue(host, 'redis://offgrid-s1.local:6379'), 'redis://127.0.0.1:6379');
});

test('non-host values pass through untouched both ways', () => {
  assert.equal(configDisplayValue(plain, 'redis'), 'redis');
  assert.equal(configDisplayValue(plain, 'development'), 'development');
  assert.equal(
    configConnectValue(plain, 'http://offgrid-s1.local:8800'),
    'http://offgrid-s1.local:8800',
  );
});

test('empty value is a no-op', () => {
  assert.equal(configDisplayValue(host, ''), '');
  assert.equal(configConnectValue(host, ''), '');
});

test('public / already-mDNS host values are unchanged by display', () => {
  assert.equal(
    configDisplayValue(host, 'https://ai.getoffgridai.co'),
    'https://ai.getoffgridai.co',
  );
  assert.equal(
    configDisplayValue(host, 'http://offgrid-s1.local:6333'),
    'http://offgrid-s1.local:6333',
  );
});

test('every registry default is mDNS — never a raw IP or loopback', () => {
  const forbidden =
    /(127\.0\.0\.1|localhost|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\[::1\]|0\.0\.0\.0)/;
  for (const def of CONFIG_REGISTRY) {
    if (def.default) {
      assert.ok(
        !forbidden.test(def.default),
        `${def.key} default leaks a raw host: ${def.default}`,
      );
    }
  }
});

test('clear-text HTTP defaults are restricted to host-bearing private fleet mDNS boundaries', () => {
  const cleartextDefaults = CONFIG_REGISTRY.filter((def) => def.default?.startsWith('http://'));

  assert.ok(cleartextDefaults.length > 0, 'the on-prem registry should exercise this contract');
  for (const def of cleartextDefaults) {
    assert.equal(def.hostValue, true, `${def.key} must be recognized as a host-bearing value`);
    assert.match(
      def.default ?? '',
      /^http:\/\/offgrid-(?:s1|s2|g6)\.local:\d+$/,
      `${def.key} clear-text default must never address a public or user-supplied host`,
    );
  }
});

test('host-bearing defaults round-trip to a working loopback target', () => {
  for (const def of CONFIG_REGISTRY) {
    if (def.hostValue && def.default) {
      const connect = configConnectValue(def, def.default);
      // The default is mDNS; its connect form resolves to the loopback the server actually uses.
      assert.ok(/127\.0\.0\.1|offgrid-|getoffgridai/.test(connect), `${def.key}: ${connect}`);
    }
  }
});
