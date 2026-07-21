import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  gatewayFromHost,
  isPublicFileGet,
  isPublicPath,
  isTenantRootRedirect,
  tenantSlugFromHost,
} from '../src/lib/route-access.ts';
import { tenantGatewayHost } from '../src/lib/tenant-domain.ts';

// Real inputs, no mocks — these are pure functions, so we exercise the actual authorization rules
// the middleware relies on.

test('isPublicFileGet: public GET of a single-segment file key', () => {
  assert.equal(isPublicFileGet('GET', '/api/v1/files/logo.png'), true);
});

test('isPublicFileGet: public GET of a NESTED object-store key (the regression this fixes)', () => {
  assert.equal(isPublicFileGet('GET', '/api/v1/files/media/2026/report.png'), true);
  assert.equal(isPublicFileGet('GET', '/api/v1/files/provit/todo-demo/frames/step-000.png'), true);
});

test('isPublicFileGet: non-GET file requests are NOT public (upload/delete still gated)', () => {
  assert.equal(isPublicFileGet('POST', '/api/v1/files/media/x.png'), false);
  assert.equal(isPublicFileGet('DELETE', '/api/v1/files/media/x.png'), false);
});

test('isPublicFileGet: only the files route, not other api paths', () => {
  assert.equal(isPublicFileGet('GET', '/api/v1/admin/agents'), false);
});

test('isPublicPath: marketing/docs/auth surfaces are public', () => {
  for (const p of ['/', '/docs', '/docs/api', '/signin', '/api/auth/callback', '/features']) {
    assert.equal(isPublicPath(p), true, `${p} should be public`);
  }
});

test('isPublicPath: authed console + admin API are NOT public', () => {
  for (const p of [
    '/gateway/fleet',
    '/operations/admin',
    '/api/v1/admin/tenants',
    '/workspace/chat',
  ]) {
    assert.equal(isPublicPath(p), false, `${p} should require auth`);
  }
});

test('isPublicPath: the invite-accept page + endpoint are public (invitee has no session yet)', () => {
  assert.equal(isPublicPath('/invite/accept'), true);
  assert.equal(isPublicPath('/api/v1/invites/accept'), true);
  // but the admin-side invite management stays authed
  assert.equal(isPublicPath('/api/v1/admin/invites'), false);
});

test('isPublicPath: node device endpoints are public (device-token auth)', () => {
  assert.equal(isPublicPath('/api/v1/devices/enroll'), true);
  assert.equal(isPublicPath('/api/v1/devices/dev_01/policy'), true);
  assert.equal(isPublicPath('/api/v1/devices/dev_01/audit'), true);
  // but not an arbitrary device subpath
  assert.equal(isPublicPath('/api/v1/devices/dev_01/secrets'), false);
});

test('tenantSlugFromHost: extracts the slug from a first-level tenant subdomain', () => {
  assert.equal(tenantSlugFromHost('bharatunion-onprem-console.getoffgridai.co'), 'bharatunion');
  assert.equal(tenantSlugFromHost('wednesdaysol-onprem-console.getoffgridai.co'), 'wednesdaysol');
});

test('tenantSlugFromHost: null for the bare console host and unrelated hosts', () => {
  assert.equal(tenantSlugFromHost('onprem-console.getoffgridai.co'), null);
  assert.equal(tenantSlugFromHost('getoffgridai.co'), null);
  assert.equal(tenantSlugFromHost(null), null);
  assert.equal(tenantSlugFromHost(''), null);
});

test('tenantSlugFromHost: case-insensitive on the host', () => {
  assert.equal(tenantSlugFromHost('BharatUnion-OnPrem-Console.getoffgridai.co'), 'bharatunion');
});

// ─── isTenantRootRedirect — tenant "/" goes to the console, apex "/" stays the landing ─────────────

test('isTenantRootRedirect: a tenant host at "/" redirects (signin becomes the tenant home)', () => {
  assert.equal(isTenantRootRedirect('bharatunion-onprem-console.getoffgridai.co', '/'), true);
  assert.equal(isTenantRootRedirect('suraksha-onprem-console.getoffgridai.co', '/'), true);
});

test('isTenantRootRedirect: the APEX host at "/" does NOT redirect (keeps the landing)', () => {
  assert.equal(isTenantRootRedirect('onprem-console.getoffgridai.co', '/'), false);
  assert.equal(isTenantRootRedirect('getoffgridai.co', '/'), false);
});

test('isTenantRootRedirect: a tenant host at a non-root path does NOT redirect', () => {
  assert.equal(
    isTenantRootRedirect('bharatunion-onprem-console.getoffgridai.co', '/overview'),
    false,
  );
  assert.equal(isTenantRootRedirect('bharatunion-onprem-console.getoffgridai.co', '/docs'), false);
  assert.equal(isTenantRootRedirect('suraksha-onprem-console.getoffgridai.co', '/signin'), false);
});

test('isTenantRootRedirect: null/empty host never redirects', () => {
  assert.equal(isTenantRootRedirect(null, '/'), false);
  assert.equal(isTenantRootRedirect(undefined, '/'), false);
  assert.equal(isTenantRootRedirect('', '/'), false);
});

// ─── PA-15: gatewayFromHost — the per-tenant gateway edge resolver ─────────────────────────────────

test('gatewayFromHost: parses the <slug5><rand5>-gateway.<apex> label into parts', () => {
  const parts = gatewayFromHost('bharak7x2p-gateway.getoffgridai.co');
  assert.deepEqual(parts, { label: 'bharak7x2p', slugPrefix: 'bhara', randSuffix: 'k7x2p' });
});

test('gatewayFromHost: round-trips against tenantGatewayHost (the host SHAPE source of truth)', () => {
  // Mint a host with the pure builder, then resolve it back — the label is the stored key.
  const host = tenantGatewayHost('bharatunion', 'k7x2p');
  assert.equal(host, 'bharak7x2p-gateway.getoffgridai.co');
  const parts = gatewayFromHost(host);
  assert.ok(parts);
  assert.equal(parts.label, 'bharak7x2p');
  assert.equal(parts.slugPrefix, 'bhara'); // first 5 of the slug
  assert.equal(parts.randSuffix, 'k7x2p'); // the 5-char random suffix
});

test('gatewayFromHost: case-insensitive on the host', () => {
  const parts = gatewayFromHost('Bharak7X2P-Gateway.getoffgridai.co');
  assert.ok(parts);
  assert.equal(parts.label, 'bharak7x2p');
});

test('gatewayFromHost: rejects the SHARED gateway + non-matching hosts (null)', () => {
  assert.equal(
    gatewayFromHost('gateway.getoffgridai.co'),
    null,
    'shared gateway is not per-tenant',
  );
  assert.equal(
    gatewayFromHost('bharatunion-onprem-console.getoffgridai.co'),
    null,
    'a console host',
  );
  assert.equal(gatewayFromHost('getoffgridai.co'), null);
  // Wrong label length (label must be exactly 10 alphanumerics before -gateway).
  assert.equal(gatewayFromHost('short-gateway.getoffgridai.co'), null, 'label too short');
  assert.equal(gatewayFromHost('waytoolonglabel-gateway.getoffgridai.co'), null, 'label too long');
  assert.equal(gatewayFromHost(null), null);
  assert.equal(gatewayFromHost(''), null);
});

test('isPublicPath: webhook ingress is public (per-trigger HMAC auth, no session)', () => {
  // The inbound consumption primitive authenticates by HMAC signature, not a session — middleware
  // must let it through to its own verifier (else every webhook fire 401s before the signature check).
  assert.equal(isPublicPath('/api/v1/triggers/wht_abc123'), true);
  assert.equal(isPublicPath('/api/v1/triggers/'), true);
  // but the ADMIN CRUD for provisioning triggers still requires auth
  assert.equal(isPublicPath('/api/v1/admin/triggers/webhooks'), false);
});
