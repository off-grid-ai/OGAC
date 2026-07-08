import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allModuleIds,
  baselineModules,
  BUILTIN_ROLES,
  isRbacRole,
  RBAC_ROLES,
} from '@/lib/roles';

// Pure RBAC guards + baseline-module resolution not reached by the existing roles suite. No I/O.

test('isRbacRole: accepts the three console roles, rejects everything else', () => {
  for (const r of RBAC_ROLES) assert.equal(isRbacRole(r), true);
  assert.equal(isRbacRole('admin'), true);
  assert.equal(isRbacRole('operator'), false); // operator is a built-in module role, not an RBAC role
  assert.equal(isRbacRole('superuser'), false);
  assert.equal(isRbacRole(42), false);
  assert.equal(isRbacRole(null), false);
  assert.equal(isRbacRole(undefined), false);
});

test('baselineModules: admin/operator get every module; viewer (and unknown) excludes admin', () => {
  const all = new Set(allModuleIds());
  assert.ok(all.size > 0, 'expected a non-empty module registry');

  for (const base of ['admin', 'operator']) {
    assert.deepEqual(baselineModules(base), all, `${base} should see all modules`);
  }

  const viewer = baselineModules('viewer');
  assert.equal(viewer.has('admin' as never), false, 'viewer must not reach the admin control plane');
  // Everything except admin is present.
  for (const id of all) {
    if (id === 'admin') continue;
    assert.ok(viewer.has(id), `viewer should retain ${id}`);
  }

  // An unknown base falls to the read-only (viewer-equivalent) baseline.
  assert.deepEqual(baselineModules('nonsense-base'), viewer);
});

test('BUILTIN_ROLES: the three inheritable bases are exposed', () => {
  assert.deepEqual([...BUILTIN_ROLES], ['viewer', 'operator', 'admin']);
});
