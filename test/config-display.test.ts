import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG_REGISTRY, configConnectValue, configDisplayValue } from '@/lib/config-registry';

const host = { hostValue: true } as const;
const hostList = { hostListValue: true } as const;
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

test('comma-separated host lists map every broker without collapsing the list', () => {
  assert.equal(
    configDisplayValue(hostList, '127.0.0.1:19092,192.168.1.67:29092'),
    'offgrid-s1.local:19092,offgrid-s1.local:29092',
  );
  assert.equal(
    configConnectValue(hostList, 'offgrid-s1.local:19092,offgrid-g6.local:29092'),
    '127.0.0.1:19092,127.0.0.1:29092',
  );
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

test('Redpanda registry follows the dynamic edge contract and exposes native Kafka settings', () => {
  const definitions = new Map(CONFIG_REGISTRY.map((definition) => [definition.key, definition]));
  const admin = definitions.get('OFFGRID_REDPANDA_ADMIN_URL');
  const schema = definitions.get('OFFGRID_REDPANDA_SCHEMA_URL');
  const brokers = definitions.get('OFFGRID_REDPANDA_BROKERS');
  const clientId = definitions.get('OFFGRID_REDPANDA_CLIENT_ID');

  assert.equal(admin?.default, 'http://offgrid-s1.local:8943');
  assert.equal(schema?.default, 'http://offgrid-s1.local:8946');
  assert.equal(configConnectValue(admin!, admin!.default!), 'http://127.0.0.1:8943/');
  assert.equal(configConnectValue(schema!, schema!.default!), 'http://127.0.0.1:8946/');

  assert.equal(brokers?.type, 'string');
  assert.equal(brokers?.hostListValue, true);
  assert.equal(brokers?.default, undefined, 'Kafka reachability must not be invented');
  assert.match(brokers?.description ?? '', /broker metadata must be reachable/i);

  assert.equal(clientId?.default, 'offgrid-console');
  assert.equal(clientId?.hostValue, undefined);
  assert.ok(
    [...definitions.values()]
      .filter(({ key }) => key.startsWith('OFFGRID_REDPANDA_'))
      .every(({ default: value }) => !value?.includes('offgrid-s2')),
    'the retired offgrid-s2 node must not remain in Redpanda configuration defaults',
  );
});
