import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deviceCommandBody,
  deviceCommandPath,
  fleetHeaders,
  mapDeviceCommand,
  mapPolicies,
  mapPolicy,
  mapQueryReport,
  mapSoftware,
  policyBody,
  runCampaignBody,
  saveQueryBody,
  validateOsquery,
  validatePolicyInput,
} from '../src/lib/fleetdm.ts';

// ── validateOsquery ──────────────────────────────────────────────────────────
test('validateOsquery accepts a plain SELECT', () => {
  assert.deepEqual(validateOsquery('SELECT name FROM os_version'), { ok: true });
  assert.deepEqual(validateOsquery('  select 1  '), { ok: true });
});

test('validateOsquery rejects empty, non-select, mutations, and multi-statement', () => {
  assert.equal(validateOsquery('').ok, false);
  assert.equal(validateOsquery('DROP TABLE users').ok, false);
  assert.equal(validateOsquery('UPDATE x SET y=1').ok, false);
  assert.equal(validateOsquery('DELETE FROM x').ok, false);
  assert.equal(validateOsquery('PRAGMA table_info(x)').ok, false);
  assert.equal(validateOsquery('SELECT 1; DROP TABLE x').ok, false);
});

test('validateOsquery allows a trailing semicolon on a single statement', () => {
  assert.deepEqual(validateOsquery('SELECT 1;'), { ok: true });
});

// ── auth headers ──────────────────────────────────────────────────────────────
test('fleetHeaders attaches bearer token only when set, merges extras', () => {
  assert.deepEqual(fleetHeaders('tok', { 'content-type': 'application/json' }), {
    authorization: 'Bearer tok',
    'content-type': 'application/json',
  });
  assert.deepEqual(fleetHeaders(undefined), {});
});

// ── live query bodies ──────────────────────────────────────────────────────────
test('saveQueryBody + runCampaignBody produce the FleetDM shapes', () => {
  const save = saveQueryBody('offgrid-live-x', 'SELECT 1');
  assert.equal(save.query, 'SELECT 1');
  assert.equal(save.observer_can_run, true);
  assert.deepEqual(runCampaignBody([3, 7]), { selected: { hosts: [3, 7], labels: [] } });
});

// ── mapQueryReport ──────────────────────────────────────────────────────────────
test('mapQueryReport normalizes rows and computes complete/pending', () => {
  const report = {
    results: [
      { host_id: 1, host_name: 'g1', columns: { name: 'macOS', version: 15 } },
      { host_id: 2, host_name: 'g2', columns: { name: 'Ubuntu', version: null } },
    ],
  };
  const complete = mapQueryReport(9, 'SELECT 1', report, 2);
  assert.equal(complete.status, 'complete');
  assert.equal(complete.respondedHosts, 2);
  assert.equal(complete.rows[0].columns.version, '15'); // coerced to string
  assert.equal(complete.rows[1].columns.version, ''); // null → ''

  const pending = mapQueryReport(9, 'SELECT 1', report, 5);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.respondedHosts, 2);

  const none = mapQueryReport(9, 'SELECT 1', {}, 3);
  assert.equal(none.status, 'pending');
  assert.equal(none.rows.length, 0);
});

// ── mapSoftware ──────────────────────────────────────────────────────────────────
test('mapSoftware sorts by highest CVSS, counts vulnerable, and reads both payload shapes', () => {
  const payload = {
    software: [
      { id: 1, name: 'zlib', version: '1.2', source: 'deb', vulnerabilities: [] },
      {
        id: 2,
        name: 'openssl',
        version: '1.1',
        source: 'deb',
        vulnerabilities: [
          { cve: 'CVE-2020-1', cvss_score: 7.5, details_link: 'https://x/1' },
          { cve: 'CVE-2020-2', cvss_score: 9.8 },
        ],
      },
      {
        id: 3,
        name: 'curl',
        version: '7.0',
        source: 'deb',
        vulnerabilities: [{ cve: 'CVE-2019-9', cvss_score: 5.0 }],
      },
    ],
  };
  const inv = mapSoftware(42, payload);
  assert.equal(inv.hostId, 42);
  assert.equal(inv.count, 3);
  assert.equal(inv.vulnerableCount, 2);
  // openssl (9.8) first, then curl (5.0), then zlib (0)
  assert.deepEqual(inv.software.map((s) => s.name), ['openssl', 'curl', 'zlib']);
  assert.equal(inv.software[0].vulnerabilities[0].url, 'https://x/1');

  // nested host.software shape
  const nested = mapSoftware(1, { host: { software: [{ id: 5, name: 'a', version: '1' }] } });
  assert.equal(nested.count, 1);
  assert.equal(nested.software[0].name, 'a');

  // empty / missing
  assert.equal(mapSoftware(1, {}).count, 0);
});

test('mapSoftware drops vulnerabilities without a cve', () => {
  const inv = mapSoftware(1, {
    software: [{ id: 1, name: 'x', version: '1', vulnerabilities: [{ cvss_score: 5 }] }],
  });
  assert.equal(inv.vulnerableCount, 0);
  assert.equal(inv.software[0].vulnerabilities.length, 0);
});

// ── policies ──────────────────────────────────────────────────────────────────
test('validatePolicyInput requires name + valid query', () => {
  assert.equal(validatePolicyInput({ name: '', query: 'SELECT 1' }).ok, false);
  assert.equal(validatePolicyInput({ name: 'x', query: '' }).ok, false);
  assert.equal(validatePolicyInput({ name: 'x', query: 'DROP TABLE y' }).ok, false);
  assert.deepEqual(validatePolicyInput({ name: 'x', query: 'SELECT 1' }), { ok: true });
});

test('policyBody omits unset fields (snake_case passthrough)', () => {
  assert.deepEqual(policyBody({ name: 'x', query: 'SELECT 1' }), { name: 'x', query: 'SELECT 1' });
  assert.deepEqual(policyBody({ critical: true, platform: 'darwin' }), {
    critical: true,
    platform: 'darwin',
  });
});

test('mapPolicy + mapPolicies normalize snake_case counts and defaults', () => {
  const p = mapPolicy({
    id: 4,
    name: 'Disk encrypted',
    query: 'SELECT 1',
    passing_host_count: 10,
    failing_host_count: 2,
    critical: true,
  });
  assert.equal(p.passingHostCount, 10);
  assert.equal(p.failingHostCount, 2);
  assert.equal(p.critical, true);
  assert.equal(p.platform, ''); // default

  const list = mapPolicies({ policies: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] });
  assert.deepEqual(list.map((x) => x.id), [1, 2]);
  assert.deepEqual(mapPolicies({}), []);
});

// ── device commands ──────────────────────────────────────────────────────────
test('deviceCommandPath maps each command to its host endpoint', () => {
  assert.equal(deviceCommandPath(5, 'lock'), '/api/latest/fleet/hosts/5/lock');
  assert.equal(deviceCommandPath(5, 'unlock'), '/api/latest/fleet/hosts/5/unlock');
  assert.equal(deviceCommandPath(5, 'wipe'), '/api/latest/fleet/hosts/5/wipe');
  assert.equal(deviceCommandPath(5, 'refetch'), '/api/latest/fleet/hosts/5/refetch');
});

test('deviceCommandBody is undefined except for a Windows wipe type', () => {
  assert.equal(deviceCommandBody('lock'), undefined);
  assert.equal(deviceCommandBody('unlock'), undefined);
  assert.equal(deviceCommandBody('refetch'), undefined);
  assert.equal(deviceCommandBody('wipe'), undefined); // no type → bodyless
  assert.deepEqual(deviceCommandBody('wipe', { windowsWipeType: 'DoubleWipe' }), {
    metadata: { windows: { wipe_type: 'DoubleWipe' } },
  });
});

test('mapDeviceCommand reports pending for lock/wipe, requested for refetch', () => {
  assert.equal(mapDeviceCommand(1, 'lock', {}).status, 'pending');
  assert.equal(mapDeviceCommand(1, 'wipe', {}).status, 'pending');
  assert.equal(mapDeviceCommand(1, 'unlock', {}).status, 'pending');
  assert.equal(mapDeviceCommand(1, 'refetch', {}).status, 'requested');
});

test('mapDeviceCommand echoes unlock_pin and device status when present', () => {
  const locked = mapDeviceCommand(9, 'lock', {
    unlock_pin: '123456',
    device_status: 'locking',
    pending_action: 'lock',
  });
  assert.equal(locked.hostId, 9);
  assert.equal(locked.command, 'lock');
  assert.equal(locked.unlockPin, '123456');
  assert.equal(locked.deviceStatus, 'locking');
  assert.equal(locked.pendingAction, 'lock');

  // nested host.mdm shape + no pin
  const nested = mapDeviceCommand(2, 'wipe', {
    host: { mdm: { device_status: 'wiping', pending_action: 'wipe' } },
  });
  assert.equal(nested.deviceStatus, 'wiping');
  assert.equal(nested.pendingAction, 'wipe');
  assert.equal(nested.unlockPin, undefined);

  // empty payload → no optional fields
  assert.deepEqual(mapDeviceCommand(3, 'refetch', {}), {
    hostId: 3,
    command: 'refetch',
    status: 'requested',
  });
  // null-safe
  assert.equal(mapDeviceCommand(3, 'lock', null).status, 'pending');
});
