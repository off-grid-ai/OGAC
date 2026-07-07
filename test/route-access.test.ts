import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  isPublicFileGet,
  isPublicPath,
  tenantSlugFromHost,
} from '../src/lib/route-access.ts';

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
  for (const p of ['/fleet', '/admin', '/api/v1/admin/tenants', '/chat']) {
    assert.equal(isPublicPath(p), false, `${p} should require auth`);
  }
});

test('isPublicPath: node device endpoints are public (device-token auth)', () => {
  assert.equal(isPublicPath('/api/v1/devices/enroll'), true);
  assert.equal(isPublicPath('/api/v1/devices/dev_01/policy'), true);
  assert.equal(isPublicPath('/api/v1/devices/dev_01/audit'), true);
  // but not an arbitrary device subpath
  assert.equal(isPublicPath('/api/v1/devices/dev_01/secrets'), false);
});

test('tenantSlugFromHost: extracts the slug from a first-level tenant subdomain', () => {
  assert.equal(
    tenantSlugFromHost('bharatunion-onprem-console.getoffgridai.co'),
    'bharatunion',
  );
  assert.equal(
    tenantSlugFromHost('wednesdaysol-onprem-console.getoffgridai.co'),
    'wednesdaysol',
  );
});

test('tenantSlugFromHost: null for the bare console host and unrelated hosts', () => {
  assert.equal(tenantSlugFromHost('onprem-console.getoffgridai.co'), null);
  assert.equal(tenantSlugFromHost('getoffgridai.co'), null);
  assert.equal(tenantSlugFromHost(null), null);
  assert.equal(tenantSlugFromHost(''), null);
});

test('tenantSlugFromHost: case-insensitive on the host', () => {
  assert.equal(
    tenantSlugFromHost('BharatUnion-OnPrem-Console.getoffgridai.co'),
    'bharatunion',
  );
});
