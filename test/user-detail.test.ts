import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffRoles, userDisplayName, userSubtitle } from '../src/lib/user-detail.ts';

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
