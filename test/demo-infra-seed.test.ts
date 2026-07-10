import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEMO_ORG_IDS,
  assertDemoOrg,
  baoPutCommand,
  demoFileKey,
  fakeSecretValue,
  fileSlug,
  isDemoOrg,
} from '../src/lib/demo/infra-seed.ts';
import { BANK_SECRETS, INSURER_SECRETS } from '../src/lib/demo/secrets.ts';
import { BANK_FILES, INSURER_FILES } from '../src/lib/demo/storage.ts';

test('isDemoOrg / assertDemoOrg: only the two demo tenants pass', () => {
  assert.equal(isDemoOrg('org_bharat'), true);
  assert.equal(isDemoOrg('org_suraksha'), true);
  assert.equal(isDemoOrg('default'), false);
  assert.equal(isDemoOrg('wednesdaysol'), false);
  assert.doesNotThrow(() => assertDemoOrg('org_bharat'));
  assert.doesNotThrow(() => assertDemoOrg('org_suraksha'));
  assert.throws(() => assertDemoOrg('default'), /refusing to seed infra for non-demo org "default"/);
  assert.throws(() => assertDemoOrg(''), /refusing/);
});

test('DEMO_ORG_IDS is exactly the two tenants', () => {
  assert.deepEqual([...DEMO_ORG_IDS], ['org_bharat', 'org_suraksha']);
});

test('fileSlug: stable, path-safe, no leading/trailing/duplicate dashes', () => {
  assert.equal(fileSlug('account-statement-XXXX3391.csv'), 'account-statement-xxxx3391.csv');
  assert.equal(fileSlug('kyc checklist (medium risk).md'), 'kyc-checklist-medium-risk-.md');
  assert.equal(fileSlug('  Weird__Name!!.TXT  '), 'weird-name-.txt'); // edges trimmed, collapsed; deterministic
  // Deterministic — same input twice → same slug (the whole basis of idempotency).
  assert.equal(fileSlug('policy-schedule-SL-2291043.txt'), fileSlug('policy-schedule-SL-2291043.txt'));
});

test('demoFileKey: deterministic, under the org prefix, demo/ segment', () => {
  const k1 = demoFileKey('org_bharat', 'account-statement-XXXX3391.csv');
  assert.equal(k1, 'orgs/org_bharat/demo/account-statement-xxxx3391.csv');
  assert.ok(k1.startsWith('orgs/org_bharat/'), 'lands under the org prefix so isKeyInOrg surfaces it');
  assert.equal(demoFileKey('org_suraksha', 'policy-schedule-SL-2291043.txt'), 'orgs/org_suraksha/demo/policy-schedule-sl-2291043.txt');
  // Idempotency: same org+name → same key, so putObject overwrites (never duplicates).
  assert.equal(demoFileKey('org_bharat', 'a.csv'), demoFileKey('org_bharat', 'a.csv'));
  // SAFETY: a non-demo org can never get a key.
  assert.throws(() => demoFileKey('default', 'x.csv'), /refusing/);
});

test('demo file keys never cross tenants (bank under bharat, insurer under suraksha)', () => {
  for (const f of BANK_FILES) {
    const key = demoFileKey('org_bharat', f.name);
    assert.ok(key.startsWith('orgs/org_bharat/'), `${f.name} → ${key}`);
    assert.ok(!key.includes('org_suraksha'));
  }
  for (const f of INSURER_FILES) {
    const key = demoFileKey('org_suraksha', f.name);
    assert.ok(key.startsWith('orgs/org_suraksha/'), `${f.name} → ${key}`);
    assert.ok(!key.includes('org_bharat'));
  }
});

test('fakeSecretValue: shape follows kind; clearly non-real; never empty', () => {
  const rand = () => 'abc123';
  // A CIBIL API key → sk_demo_ prefix.
  const keySpec = BANK_SECRETS.find((s) => /key/i.test(s.name))!;
  assert.equal(fakeSecretValue(keySpec, rand), 'sk_demo_abc123');
  // A DB password → Demo! prefix, not a key shape.
  const pwSpec = BANK_SECRETS.find((s) => /password/i.test(s.name))!;
  assert.equal(fakeSecretValue(pwSpec, rand), 'Demo!abc123');
  // Nothing real: both are obviously synthetic.
  assert.ok(fakeSecretValue(pwSpec, rand).startsWith('Demo!'));
});

test('baoPutCommand: writes value= to the secret its tenant-scoped path, for every demo secret', () => {
  const rand = () => 'deadbeef';
  for (const spec of [...BANK_SECRETS, ...INSURER_SECRETS]) {
    const value = fakeSecretValue(spec, rand);
    const cmd = baoPutCommand(spec, value);
    assert.equal(cmd, `bao kv put ${spec.path} value=${value}`);
    // Every demo secret path is tenant-scoped under secret/<demoOrg>/.
    assert.ok(/^secret\/org_(bharat|suraksha)\//.test(spec.path), `${spec.path} must be tenant-scoped`);
    // The command never embeds a real-looking credential.
    assert.ok(cmd.includes('value=sk_demo_') || cmd.includes('value=Demo!'));
  }
});
