import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeKeyList,
  type SecretKeyRow,
  validateFolderPath,
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

test('validateFolderPath accepts the root (empty string, undefined, null)', () => {
  for (const rootLike of ['', undefined, null]) {
    const r = validateFolderPath(rootLike);
    assert.equal(r.ok, true, `${String(rootLike)} should resolve to the root`);
    assert.equal(r.folder, '');
    assert.equal(r.error, null);
  }
});

test('validateFolderPath accepts well-formed folder paths', () => {
  for (const f of ['connectors/', 'a/b/', 'tools/', 'A_B-C.1/']) {
    const r = validateFolderPath(f);
    assert.equal(r.ok, true, `${f} should be valid`);
    assert.equal(r.folder, f);
  }
});

test('validateFolderPath trims surrounding whitespace', () => {
  const r = validateFolderPath('  connectors/  ');
  assert.equal(r.ok, true);
  assert.equal(r.folder, 'connectors/');
});

test('validateFolderPath rejects non-string / non-root without trailing slash / leading slash / traversal', () => {
  for (const bad of ['connectors', '/connectors/', 'a/../b/', '../', './', 'a//b/', 42, {}, []]) {
    const r = validateFolderPath(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} should be rejected`);
    assert.equal(r.folder, '');
    assert.ok(r.error);
  }
});

test('validateFolderPath rejects illegal characters and over-long paths', () => {
  assert.equal(validateFolderPath('foo bar/').ok, false);
  assert.equal(validateFolderPath(`${'a'.repeat(257)}/`).ok, false);
});
