import assert from 'node:assert/strict';
import { test } from 'node:test';
import { skillVisibleTo } from '@/lib/chat-skill-policy';

// Pure unit tests for the skill-visibility RULE (zero I/O). Tenant scoping is applied separately at
// the query layer; this exercises every role/ownership arm both ways.

test('admins see everything (disabled, private, role-restricted)', () => {
  assert.equal(skillVisibleTo({ enabled: false, visibility: 'private', createdBy: 'x@x' }, 'admin', 'y@y'), true);
  assert.equal(skillVisibleTo({ enabled: true, allowedRoles: ['manager'] }, 'admin'), true);
});

test('private assistants are visible only to their creator', () => {
  assert.equal(skillVisibleTo({ enabled: true, visibility: 'private', createdBy: 'me@x' }, 'viewer', 'me@x'), true);
  assert.equal(skillVisibleTo({ enabled: true, visibility: 'private', createdBy: 'me@x' }, 'viewer', 'other@x'), false);
});

test('disabled org skills are hidden from non-admins', () => {
  assert.equal(skillVisibleTo({ enabled: false, visibility: 'org' }, 'viewer', 'u@x'), false);
});

test('role allowlist: empty means everyone; otherwise must include the role', () => {
  assert.equal(skillVisibleTo({ enabled: true, visibility: 'org', allowedRoles: [] }, 'viewer', 'u@x'), true);
  assert.equal(skillVisibleTo({ enabled: true, visibility: 'org', allowedRoles: ['manager'] }, 'manager', 'u@x'), true);
  assert.equal(skillVisibleTo({ enabled: true, visibility: 'org', allowedRoles: ['manager'] }, 'viewer', 'u@x'), false);
});

test('missing enabled defaults to not-visible for non-admins', () => {
  assert.equal(skillVisibleTo({ visibility: 'org' }, 'viewer', 'u@x'), false);
});
