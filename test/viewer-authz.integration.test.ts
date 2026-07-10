import assert from 'node:assert/strict';
import { test, before } from 'node:test';

// SECURITY PROOF — the read-only viewer through the REAL authz gates. We stub only the auth boundary
// (`@/auth` → a controllable session) and run the ACTUAL requireAdmin / requireWriter / requireUser
// code. The terminal artifact asserted is the HTTP RESPONSE the gate hands back (status + body) — the
// exact thing a route returns to the caller — for both arms: a viewer write is 403, a viewer read is
// admitted, an admin passes. If the gate logic broke, these flip.
//
// Enable the auth stub BEFORE importing anything that pulls @/auth.
process.env.OFFGRID_TEST_AUTH_STUB = '1';
delete process.env.OFFGRID_ADMIN_TOKEN; // no break-glass — force the session path

let requireAdmin: typeof import('@/lib/authz').requireAdmin;
let requireWriter: typeof import('@/lib/authz').requireWriter;
let requireUser: typeof import('@/lib/authz').requireUser;
let setSession: (s: unknown) => void;

const asAdmin = { user: { email: 'admin@offgrid.local', role: 'admin' } };
const asViewer = { user: { email: 'demo@offgrid.local', role: 'viewer' } };

// A request whose only meaningful property to the gate is its method (bearer absent → session path).
const req = (method: string): Request => new Request('https://console.local/api/v1/admin/x', { method });

before(async () => {
  const authz = await import('@/lib/authz');
  requireAdmin = authz.requireAdmin;
  requireWriter = authz.requireWriter;
  requireUser = authz.requireUser;
  const stub = (await import('@/auth')) as unknown as { __setSession: (s: unknown) => void };
  setSession = stub.__setSession;
});

test('viewer is BLOCKED (403) by requireWriter on a mutating request', async () => {
  setSession(asViewer);
  const gate = await requireWriter(req('POST'));
  assert.ok(gate instanceof Response, 'expected a Response (blocked), not a session');
  assert.equal((gate as Response).status, 403);
  const body = (await (gate as Response).json()) as { error: string; reason: string };
  assert.equal(body.error, 'forbidden');
  assert.match(body.reason, /read-only/);
});

test('admin PASSES requireWriter — the session flows through, no 403', async () => {
  setSession(asAdmin);
  const gate = await requireWriter(req('POST'));
  assert.ok(!(gate instanceof Response), 'admin should pass the writer gate');
  assert.equal((gate as { user: { role?: string } }).user.role, 'admin');
});

test('requireAdmin: viewer is BLOCKED (403) on a mutating method', async () => {
  setSession(asViewer);
  for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    const gate = await requireAdmin(req(m));
    assert.ok(gate instanceof Response, `${m} should be blocked`);
    assert.equal((gate as Response).status, 403, `${m} → 403`);
  }
});

test('requireAdmin: viewer is ADMITTED on a safe read (GET/HEAD) — view the admin plane', async () => {
  setSession(asViewer);
  for (const m of ['GET', 'HEAD']) {
    const gate = await requireAdmin(req(m));
    assert.ok(!(gate instanceof Response), `${m} should be admitted for a viewer read`);
    assert.equal((gate as { user: { role?: string } }).user.role, 'viewer');
  }
});

test('requireAdmin: a NON-viewer non-admin (operator) stays fully blocked, even on GET', async () => {
  setSession({ user: { email: 'op@offgrid.local', role: 'operator' } });
  const gate = await requireAdmin(req('GET'));
  assert.ok(gate instanceof Response, 'operator must not reach the admin plane');
  assert.equal((gate as Response).status, 403);
});

test('requireUser: a viewer IS an authenticated user (reads flow) — 200-eligible', async () => {
  setSession(asViewer);
  const gate = await requireUser(req('GET'));
  assert.ok(!(gate instanceof Response), 'viewer is a valid authenticated principal');
  assert.equal((gate as { user: { role?: string } }).user.role, 'viewer');
});

test('unauthenticated request → 401 from requireUser (and requireWriter/requireAdmin)', async () => {
  setSession(null);
  for (const fn of [requireUser, requireWriter, requireAdmin]) {
    const gate = await fn(req('POST'));
    assert.ok(gate instanceof Response);
    assert.equal((gate as Response).status, 401);
  }
});
