import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeKeyList,
  type SecretKeyRow,
  validateKeyPath,
} from '../src/lib/secret-keys.ts';

// PURE unit tests for secret KEY-NAME logic — NO mocks, no I/O.
// SAFETY: the display model must never carry a secret value; several tests assert that structurally.

test('validateKeyPath accepts normal KV v2 key paths', () => {
  for (const k of ['connector.slack.token', 'a', 'foo/bar/baz', 'A_B-C.1', 'x/y-z_1.2']) {
    const r = validateKeyPath(k);
    assert.equal(r.ok, true, `${k} should be valid`);
    assert.equal(r.key, k);
    assert.equal(r.error, null);
  }
});

test('validateKeyPath trims surrounding whitespace', () => {
  const r = validateKeyPath('  foo/bar  ');
  assert.equal(r.ok, true);
  assert.equal(r.key, 'foo/bar');
});

test('validateKeyPath rejects empty / non-string', () => {
  for (const bad of ['', '   ', null, undefined, 42, {}, []]) {
    const r = validateKeyPath(bad);
    assert.equal(r.ok, false);
    assert.equal(r.key, '');
    assert.ok(r.error);
  }
});

test('validateKeyPath rejects path-traversal and bad slashes', () => {
  for (const bad of ['/foo', 'foo/', 'foo//bar', '../etc', 'foo/../bar', '.', '..', 'a/./b']) {
    const r = validateKeyPath(bad);
    assert.equal(r.ok, false, `${bad} should be rejected`);
    assert.ok(r.error);
  }
});

test('validateKeyPath rejects illegal characters and over-long keys', () => {
  for (const bad of ['foo bar', 'foo\tbar', 'foo:bar', 'foo=bar', 'em😀ji']) {
    assert.equal(validateKeyPath(bad).ok, false, `${bad} should be rejected`);
  }
  assert.equal(validateKeyPath('a'.repeat(257)).ok, false);
  assert.equal(validateKeyPath('a'.repeat(256)).ok, true);
});

test('normalizeKeyList sorts leaves before folders, alphabetical, de-duped', () => {
  const rows = normalizeKeyList(['zeta', 'alpha/', 'beta', 'alpha/', 'gamma/']);
  assert.deepEqual(
    rows.map((r) => r.key),
    ['beta', 'zeta', 'alpha/', 'gamma/'],
  );
  assert.deepEqual(
    rows.map((r) => r.folder),
    [false, false, true, true],
  );
});

test('normalizeKeyList drops non-strings, blanks, and handles non-arrays', () => {
  assert.deepEqual(normalizeKeyList(null), []);
  assert.deepEqual(normalizeKeyList(undefined), []);
  assert.deepEqual(normalizeKeyList('nope'), []);
  const rows = normalizeKeyList(['ok', '', '  ', 5, null, {}, 'ok']);
  assert.deepEqual(
    rows.map((r) => r.key),
    ['ok'],
  );
});

// The display model is structurally incapable of carrying a secret value — assert no `value` field
// (or anything value-like) exists on any produced row, even if the input tries to smuggle one in.
test('normalizeKeyList display rows NEVER contain a value field', () => {
  const rows: SecretKeyRow[] = normalizeKeyList(['some/secret/key', 'other']);
  for (const row of rows) {
    const fields = Object.keys(row).sort();
    assert.deepEqual(fields, ['folder', 'key']);
    assert.equal('value' in row, false);
    // Nothing on the row is anything other than the key name / folder flag.
    assert.equal(typeof (row as Record<string, unknown>).value, 'undefined');
  }
});

test('validateKeyPath result carries only key + error metadata (no value channel)', () => {
  const r = validateKeyPath('foo/bar');
  assert.deepEqual(Object.keys(r).sort(), ['error', 'key', 'ok']);
  assert.equal('value' in r, false);
});
