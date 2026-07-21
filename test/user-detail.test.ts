import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffRoles, userDisplayName, userSubtitle, validateUserEdit } from '../src/lib/user-detail.ts';

const ROLES = [
  { id: '1', name: 'admin' },
  { id: '2', name: 'analyst' },
  { id: '3', name: 'viewer' },
];

test('diffRoles: adds newly-checked, removes newly-unchecked, leaves unchanged alone', () => {
  const diff = diffRoles(ROLES, ['admin', 'viewer'], ['admin', 'analyst']);
  assert.deepEqual(
    diff.toAdd.map((r) => r.name),
    ['analyst'],
  );
  assert.deepEqual(
    diff.toRemove.map((r) => r.name),
    ['viewer'],
  );
});

test('diffRoles: no change when checked matches assigned', () => {
  const diff = diffRoles(ROLES, ['admin'], ['admin']);
  assert.deepEqual(diff.toAdd, []);
  assert.deepEqual(diff.toRemove, []);
});

test('diffRoles: assign from empty', () => {
  const diff = diffRoles(ROLES, [], ['admin', 'viewer']);
  assert.deepEqual(
    diff.toAdd.map((r) => r.name).sort(),
    ['admin', 'viewer'],
  );
  assert.deepEqual(diff.toRemove, []);
});

test('diffRoles: remove all', () => {
  const diff = diffRoles(ROLES, ['admin', 'analyst'], []);
  assert.deepEqual(
    diff.toRemove.map((r) => r.name).sort(),
    ['admin', 'analyst'],
  );
  assert.deepEqual(diff.toAdd, []);
});

test('diffRoles: ignores a checked role that is not in the realm catalog', () => {
  const diff = diffRoles(ROLES, [], ['ghost-role']);
  assert.deepEqual(diff.toAdd, []);
  assert.deepEqual(diff.toRemove, []);
});

test('userDisplayName: prefers full name, then username, then email, then id', () => {
  assert.equal(
    userDisplayName({ firstName: 'Ada', lastName: 'Lovelace', username: 'ada', id: 'u1' }),
    'Ada Lovelace',
  );
  assert.equal(userDisplayName({ firstName: 'Ada', username: 'ada', id: 'u1' }), 'Ada');
  assert.equal(userDisplayName({ username: 'ada', id: 'u1' }), 'ada');
  assert.equal(userDisplayName({ email: 'a@x.io', id: 'u1' }), 'a@x.io');
  assert.equal(userDisplayName({ id: 'u1' }), 'u1');
});

test('userSubtitle: email, else username, else id', () => {
  assert.equal(userSubtitle({ email: 'a@x.io', username: 'ada', id: 'u1' }), 'a@x.io');
  assert.equal(userSubtitle({ username: 'ada', id: 'u1' }), 'ada');
  assert.equal(userSubtitle({ id: 'u1' }), 'u1');
});

// ── validateUserEdit ─────────────────────────────────────────────────────────

test('validateUserEdit: trims names, keeps only provided fields', () => {
  const r = validateUserEdit({ firstName: '  Aarav  ', lastName: 'Sharma' });
  assert.deepEqual(r, { patch: { firstName: 'Aarav', lastName: 'Sharma' } });
});

test('validateUserEdit: accepts a valid email and normalizes emailVerified/enabled', () => {
  const r = validateUserEdit({ email: ' aarav.sharma@absli.co.in ', emailVerified: true, enabled: false });
  assert.deepEqual(r, {
    patch: { email: 'aarav.sharma@absli.co.in', emailVerified: true, enabled: false },
  });
});

test('validateUserEdit: rejects an empty email', () => {
  assert.deepEqual(validateUserEdit({ email: '   ' }), { error: 'email cannot be empty' });
});

test('validateUserEdit: rejects a malformed email', () => {
  assert.deepEqual(validateUserEdit({ email: 'not-an-email' }), {
    error: 'email is not a valid address',
  });
});

test('validateUserEdit: rejects non-boolean flags', () => {
  assert.deepEqual(
    validateUserEdit({ emailVerified: 'yes' as unknown as boolean }),
    { error: 'emailVerified must be a boolean' },
  );
  assert.deepEqual(
    validateUserEdit({ enabled: 1 as unknown as boolean }),
    { error: 'enabled must be a boolean' },
  );
});

test('validateUserEdit: allows clearing a name (empty string is kept as a real change)', () => {
  assert.deepEqual(validateUserEdit({ firstName: '' }), { patch: { firstName: '' } });
});

test('validateUserEdit: errors when nothing is provided', () => {
  assert.deepEqual(validateUserEdit({}), { error: 'no fields to update' });
});

test('validateUserEdit: disable-only patch (the enable/disable action)', () => {
  assert.deepEqual(validateUserEdit({ enabled: false }), { patch: { enabled: false } });
});
