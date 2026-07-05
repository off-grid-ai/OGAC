import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONSOLE_ADMIN_ROLE, machineConsoleRole } from '../src/lib/auth/machine-roles.ts';

// ── machineConsoleRole — the machine-role → console-capability mapping (A5) ─────
// Pure function, real invocation (no mocks): a service account is elevated to console admin ONLY by
// an explicit console-admin realm-role grant. A bare svc-<service> scope role must never elevate.

test('an explicit console-admin realm-role grant elevates a machine principal to admin', () => {
  assert.equal(machineConsoleRole(['svc-gateway', CONSOLE_ADMIN_ROLE], 'svc-gateway'), 'admin');
  // Order/other roles present must not matter.
  assert.equal(machineConsoleRole([CONSOLE_ADMIN_ROLE], 'viewer'), 'admin');
});

test('a bare svc-<service> scope role does NOT elevate — least privilege', () => {
  // The four non-gateway service accounts carry only their scope role: they stay non-admin.
  for (const svc of ['svc-opensearch', 'svc-fleet', 'svc-temporal', 'svc-seaweedfs']) {
    assert.equal(machineConsoleRole([svc], svc), svc, `${svc} must not be elevated to admin`);
    assert.notEqual(machineConsoleRole([svc], svc), 'admin');
  }
});

test('with no console-admin grant the resolved scope role passes through unchanged', () => {
  assert.equal(machineConsoleRole([], 'viewer'), 'viewer');
  assert.equal(machineConsoleRole(['svc-gateway'], 'svc-gateway'), 'svc-gateway');
});

test('CONSOLE_ADMIN_ROLE is the stable dedicated grant role name', () => {
  assert.equal(CONSOLE_ADMIN_ROLE, 'console-admin');
});
