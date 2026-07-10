import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_HOST_SUFFIX, DEMO_TENANTS, demoTenantHref } from '@/lib/demo-tenants';

test('DEMO_TENANTS: bank then insurer, each with a verified https console URL', () => {
  assert.equal(DEMO_TENANTS.length, 2);
  const [bank, insurer] = DEMO_TENANTS;

  assert.equal(bank.flavour, 'bank');
  assert.equal(bank.slug, 'bharatunion');
  assert.equal(bank.industryLabel, 'a bank');
  assert.equal(bank.prompt, 'Are you a bank?');
  assert.equal(bank.href, `https://bharatunion-${DEMO_HOST_SUFFIX}/overview`);

  assert.equal(insurer.flavour, 'insurer');
  assert.equal(insurer.slug, 'suraksha');
  assert.equal(insurer.industryLabel, 'an insurer');
  assert.equal(insurer.prompt, 'Are you an insurer?');
  assert.equal(insurer.href, `https://suraksha-${DEMO_HOST_SUFFIX}/overview`);
});

test('DEMO_TENANTS: every href passes the domain guard', () => {
  for (const t of DEMO_TENANTS) {
    assert.equal(demoTenantHref(t.href), t.href, `${t.slug} href should validate`);
  }
});

test('demoTenantHref: accepts https getoffgridai.co and subdomains', () => {
  assert.equal(
    demoTenantHref('https://getoffgridai.co/'),
    'https://getoffgridai.co/',
    'apex domain allowed',
  );
  assert.equal(
    demoTenantHref('https://x-onprem-console.getoffgridai.co/'),
    'https://x-onprem-console.getoffgridai.co/',
    'subdomain allowed',
  );
});

test('demoTenantHref: rejects non-https, foreign host, and garbage', () => {
  assert.equal(demoTenantHref('http://bharatunion-onprem-console.getoffgridai.co/'), null);
  assert.equal(demoTenantHref('https://evil.example.com/'), null);
  assert.equal(demoTenantHref('https://notgetoffgridai.co/'), null, 'suffix must be a real dot boundary');
  assert.equal(demoTenantHref('not a url'), null);
  assert.equal(demoTenantHref(''), null);
});
