import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  consoleUrl,
  DEMO_TENANTS,
  demoTenantHref,
  isDemoTenantSlug,
} from '../src/lib/demo-tenants.ts';

// Real inputs, no mocks — pure link/allow-list rules for the public demo tenants. The apex defaults
// to getoffgridai.co (NEXT_PUBLIC_TENANT_APEX unset in the test env).

test('DEMO_TENANTS: the two public demos are the bank and the insurer', () => {
  const slugs = DEMO_TENANTS.map((t) => t.slug);
  assert.deepEqual(slugs, ['bharatunion', 'suraksha']);
  assert.equal(DEMO_TENANTS.find((t) => t.slug === 'bharatunion')?.kind, 'bank');
  assert.equal(DEMO_TENANTS.find((t) => t.slug === 'suraksha')?.kind, 'insurer');
});

test('isDemoTenantSlug: true only for a known demo slug', () => {
  assert.equal(isDemoTenantSlug('bharatunion'), true);
  assert.equal(isDemoTenantSlug('suraksha'), true);
  assert.equal(isDemoTenantSlug('acme'), false);
  assert.equal(isDemoTenantSlug(''), false);
  assert.equal(isDemoTenantSlug(null), false);
  assert.equal(isDemoTenantSlug(undefined), false);
});

test('consoleUrl: DEEP-LINKS the console overview (the See-it-live target), no double slash', () => {
  assert.equal(consoleUrl('bharatunion'), 'https://bharatunion-onprem-console.getoffgridai.co/overview');
  assert.equal(consoleUrl('suraksha'), 'https://suraksha-onprem-console.getoffgridai.co/overview');
  // exactly one slash between host and path
  assert.doesNotMatch(consoleUrl('bharatunion'), /\.co\/\/overview/);
});

test('demoTenantHref: returns the /overview deep-link for a known demo, and it still validates', () => {
  const href = demoTenantHref('bharatunion');
  assert.equal(href, 'https://bharatunion-onprem-console.getoffgridai.co/overview');
  // the returned href is a well-formed https URL on the apex, path /overview
  const u = new URL(href as string);
  assert.equal(u.protocol, 'https:');
  assert.ok(u.hostname.endsWith('.getoffgridai.co'));
  assert.equal(u.pathname, '/overview');

  assert.equal(demoTenantHref('suraksha'), 'https://suraksha-onprem-console.getoffgridai.co/overview');
});

test('demoTenantHref: null for an unknown/blank/absent slug (never links off-suite)', () => {
  assert.equal(demoTenantHref('acme'), null);
  assert.equal(demoTenantHref(''), null);
  assert.equal(demoTenantHref(null), null);
  assert.equal(demoTenantHref(undefined), null);
});
