import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  randomGatewaySuffix,
  slugifyTenant,
  tenantGatewayHost,
  tenantHost,
} from '../src/lib/tenant-domain.ts';

// Pure tenant host helpers. tenantHost drives the console subdomain the middleware resolves; the
// per-tenant GATEWAY host (PA-15) mirrors the shared gateway.<apex> with a tenant prefix + random
// suffix so a provisioned tenant gateway gets its own unguessable endpoint.

test('tenantHost: <slug>-onprem-console.<apex>', () => {
  assert.equal(tenantHost('bharatunion'), 'bharatunion-onprem-console.getoffgridai.co');
});

test('tenantGatewayHost: first-5-of-slug + 5 random + -gateway.<apex>', () => {
  const host = tenantGatewayHost('bharatunion', 'k7x2p');
  assert.equal(host, 'bharak7x2p-gateway.getoffgridai.co');
});

test('tenantGatewayHost: sanitises + caps both parts (5 + 5)', () => {
  // "Wednesday Solutions" slugified → "wednesdaysolutions"; first 5 = "wedne". Random over-long +
  // punctuation is stripped and capped to 5.
  const host = tenantGatewayHost('Wednesday Solutions', 'AB-3d9zzz');
  assert.equal(host, 'wedneab3d9-gateway.getoffgridai.co');
});

test('tenantGatewayHost: label is DNS-safe (lowercase alnum + single hyphen group)', () => {
  const host = tenantGatewayHost('bharatunion', randomGatewaySuffix());
  const label = host.split('.')[0];
  assert.match(label, /^[a-z0-9]{1,5}[a-z0-9]{1,5}-gateway$/);
});

test('randomGatewaySuffix: 5 lowercase alphanumerics', () => {
  const s = randomGatewaySuffix();
  assert.equal(s.length, 5);
  assert.match(s, /^[a-z0-9]{5}$/);
});

test('slugifyTenant: lowercases + strips non-alphanumerics', () => {
  assert.equal(slugifyTenant('Bharat Union Bank!'), 'bharatunionbank');
});
