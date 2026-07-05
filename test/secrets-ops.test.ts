import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildDynamicDbCreds,
  buildLeaseDetail,
  buildLeaseRows,
  buildSealActionView,
  buildSecretVersionsView,
  dbCredsPath,
  dbRolesPath,
  formatTtl,
  kvDataPath,
  kvDeleteVersionsPath,
  kvDestroyPath,
  kvMetadataPath,
  kvUndeletePath,
  leaseLookupPath,
  validateRoleName,
  validateUnsealKey,
} from '../src/lib/secrets-ops.ts';

// Unit tests for the PURE OpenBao operational logic — NO mocks, no I/O. Verifies path builders and
// the defensive response shapers over version metadata, seal status, leases, and dynamic creds.

test('KV v2 path builders encode segments but keep the "/" hierarchy', () => {
  assert.equal(kvDataPath('secret', 'a/b c'), '/v1/secret/data/a/b%20c');
  assert.equal(kvDataPath('secret', 'k', 3), '/v1/secret/data/k?version=3');
  assert.equal(kvDataPath('secret', 'k', 0), '/v1/secret/data/k'); // 0 → latest, no query
  assert.equal(kvMetadataPath('secret', 'a/b'), '/v1/secret/metadata/a/b');
  assert.equal(kvDeleteVersionsPath('kv', 'k'), '/v1/kv/delete/k');
  assert.equal(kvUndeletePath('kv', 'k'), '/v1/kv/undelete/k');
  assert.equal(kvDestroyPath('kv', 'k'), '/v1/kv/destroy/k');
});

test('buildSecretVersionsView derives current/deleted/destroyed state, newest-first', () => {
  const view = buildSecretVersionsView({
    current_version: 3,
    oldest_version: 1,
    max_versions: 10,
    created_time: '2026-01-01T00:00:00Z',
    updated_time: '2026-03-01T00:00:00Z',
    versions: {
      '1': { created_time: '2026-01-01T00:00:00Z', deletion_time: '', destroyed: false },
      '2': { created_time: '2026-02-01T00:00:00Z', deletion_time: '2026-02-15T00:00:00Z', destroyed: false },
      '3': { created_time: '2026-03-01T00:00:00Z', deletion_time: '', destroyed: false },
      '4': { created_time: '2026-04-01T00:00:00Z', deletion_time: '', destroyed: true },
    },
  });
  assert.equal(view.currentVersion, 3);
  assert.equal(view.maxVersions, 10);
  assert.deepEqual(view.versions.map((v) => v.version), [4, 3, 2, 1]);
  const byV = Object.fromEntries(view.versions.map((v) => [v.version, v]));
  assert.equal(byV[3].state, 'active');
  assert.equal(byV[3].current, true);
  assert.equal(byV[2].state, 'deleted');
  assert.equal(byV[4].state, 'destroyed');
  assert.equal(byV[1].current, false);
});

test('buildSecretVersionsView degrades safely on null / malformed input', () => {
  const empty = buildSecretVersionsView(null);
  assert.equal(empty.currentVersion, null);
  assert.deepEqual(empty.versions, []);
  const junk = buildSecretVersionsView({ versions: 'nope', current_version: 'x' } as never);
  assert.deepEqual(junk.versions, []);
  assert.equal(junk.currentVersion, null);
});

test('buildSecretVersionsView accepts string version keys/numbers (Vault sends strings)', () => {
  const view = buildSecretVersionsView({
    current_version: '2',
    versions: { '1': { destroyed: false }, '2': { destroyed: false } },
  });
  assert.equal(view.currentVersion, 2);
  assert.equal(view.versions.find((v) => v.version === 2)?.current, true);
});

test('validateUnsealKey enforces plausible shape without leaking the value', () => {
  assert.equal(validateUnsealKey('').ok, false);
  assert.equal(validateUnsealKey('short').ok, false);
  assert.equal(validateUnsealKey('has space in it here longer').ok, false);
  const good = 'aB3+/=_-'.repeat(4); // 32 chars, valid charset
  assert.equal(validateUnsealKey(good).ok, true);
  assert.equal(validateUnsealKey(good).key, good);
});

test('buildSealActionView normalizes seal-status shape', () => {
  const v = buildSealActionView({ sealed: true, t: 3, n: 5, progress: 1, version: '2.0.0' });
  assert.deepEqual(v, { sealed: true, threshold: 3, shares: 5, progress: 1, version: '2.0.0' });
  const empty = buildSealActionView(null);
  assert.equal(empty.sealed, null);
  assert.equal(empty.threshold, null);
});

test('leaseLookupPath handles empty + nested prefixes', () => {
  assert.equal(leaseLookupPath(''), '/v1/sys/leases/lookup?list=true');
  assert.equal(leaseLookupPath('/database/creds/ro/'), '/v1/sys/leases/lookup/database/creds/ro?list=true');
});

test('buildLeaseRows joins prefix + suffixes, de-duped and sorted', () => {
  const rows = buildLeaseRows('database/creds/ro', ['h2', 'h1', 'h1', 5, '']);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['database/creds/ro/h1', 'database/creds/ro/h2'],
  );
  assert.deepEqual(buildLeaseRows('', ['x']).map((r) => r.id), ['x']);
});

test('buildLeaseDetail unwraps .data or reads flat, coerces ttl', () => {
  const nested = buildLeaseDetail({
    data: { id: 'lease/abc', ttl: 3600, renewable: true, issue_time: 't', expire_time: 'e' },
  });
  assert.equal(nested.id, 'lease/abc');
  assert.equal(nested.ttl, 3600);
  assert.equal(nested.renewable, true);
  const flat = buildLeaseDetail({ id: 'x', ttl: 0 });
  assert.equal(flat.id, 'x');
  assert.equal(flat.ttl, 0);
  assert.equal(buildLeaseDetail(null).id, null);
});

test('formatTtl renders compact human durations', () => {
  assert.equal(formatTtl(null), '—');
  assert.equal(formatTtl(-1), '—');
  assert.equal(formatTtl(0), '0s');
  assert.equal(formatTtl(45), '45s');
  assert.equal(formatTtl(3900), '1h 5m');
  assert.equal(formatTtl(90000), '1d 1h');
});

test('dynamic DB path builders + creds shaping', () => {
  assert.equal(dbCredsPath('database', 'app-ro'), '/v1/database/creds/app-ro');
  assert.equal(dbRolesPath('database'), '/v1/database/roles?list=true');
  const creds = buildDynamicDbCreds({
    lease_id: 'database/creds/app-ro/xyz',
    lease_duration: 3600,
    renewable: true,
    data: { username: 'v-token-app-ro-abc', password: 'A1b2C3' },
  });
  assert.equal(creds.leaseId, 'database/creds/app-ro/xyz');
  assert.equal(creds.leaseDuration, 3600);
  assert.equal(creds.username, 'v-token-app-ro-abc');
  assert.equal(creds.password, 'A1b2C3');
  const empty = buildDynamicDbCreds(null);
  assert.equal(empty.username, null);
  assert.equal(empty.password, null);
});

test('validateRoleName rejects bad names', () => {
  assert.equal(validateRoleName('app-ro').ok, true);
  assert.equal(validateRoleName('').ok, false);
  assert.equal(validateRoleName('bad name').ok, false);
  assert.equal(validateRoleName('a/b').ok, false);
  assert.equal(validateRoleName('a'.repeat(129)).ok, false);
});
