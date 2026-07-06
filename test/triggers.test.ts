import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMING_SOON_TRIGGER_KINDS,
  CONFIGURED_TRIGGER_KINDS,
  cronOf,
  isConfiguredKind,
  isTriggerKind,
  normalizeTrigger,
  validateTrigger,
  webhookPathFor,
} from '@/lib/triggers';

// Pure-logic unit tests for the trigger substrate — validation, normalization, webhook-path
// derivation, and the configured-vs-coming-soon gating. No I/O.

test('isTriggerKind: only the five known kinds', () => {
  for (const k of ['on-demand', 'webhook', 'email', 'whatsapp', 'schedule']) {
    assert.equal(isTriggerKind(k), true);
  }
  assert.equal(isTriggerKind('cron'), false);
  assert.equal(isTriggerKind(''), false);
  assert.equal(isTriggerKind(null), false);
});

test('isConfiguredKind: on-demand/webhook/schedule wired; email/whatsapp gated', () => {
  assert.deepEqual([...CONFIGURED_TRIGGER_KINDS], ['on-demand', 'webhook', 'schedule']);
  assert.deepEqual([...COMING_SOON_TRIGGER_KINDS], ['email', 'whatsapp']);
  assert.equal(isConfiguredKind('webhook'), true);
  assert.equal(isConfiguredKind('email'), false);
});

test('validateTrigger: on-demand needs no config', () => {
  const v = validateTrigger({ kind: 'on-demand' });
  assert.equal(v.ok, true);
  assert.equal(v.comingSoon, false);
});

test('validateTrigger: schedule requires a valid cron', () => {
  assert.equal(validateTrigger({ kind: 'schedule', config: { cron: '0 9 * * *' } }).ok, true);
  assert.equal(validateTrigger({ kind: 'schedule', config: { cron: '@daily' } }).ok, true);
  const bad = validateTrigger({ kind: 'schedule', config: { cron: 'not-cron' } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /cron/);
  assert.equal(validateTrigger({ kind: 'schedule' }).ok, false);
});

test('validateTrigger: webhook slug must be path-safe', () => {
  assert.equal(validateTrigger({ kind: 'webhook' }).ok, true);
  assert.equal(validateTrigger({ kind: 'webhook', config: { slug: 'my-hook_1' } }).ok, true);
  assert.equal(validateTrigger({ kind: 'webhook', config: { slug: 'bad slug!' } }).ok, false);
});

test('validateTrigger: email/whatsapp are valid but comingSoon (on-prem-gated)', () => {
  const e = validateTrigger({ kind: 'email' });
  assert.equal(e.ok, true);
  assert.equal(e.comingSoon, true);
  const w = validateTrigger({ kind: 'whatsapp' });
  assert.equal(w.ok, true);
  assert.equal(w.comingSoon, true);
});

test('validateTrigger: unknown kind fails', () => {
  const v = validateTrigger({ kind: 'sms' as never });
  assert.equal(v.ok, false);
  assert.equal(v.comingSoon, false);
});

test('normalizeTrigger: drops unknown config keys per kind', () => {
  assert.deepEqual(normalizeTrigger({ kind: 'on-demand', config: { junk: 1 } }), { kind: 'on-demand' });
  assert.deepEqual(normalizeTrigger({ kind: 'schedule', config: { cron: '0 9 * * *', junk: 1 } }), {
    kind: 'schedule',
    config: { cron: '0 9 * * *' },
  });
  // webhook slug sanitized to a path token.
  assert.deepEqual(normalizeTrigger({ kind: 'webhook', config: { slug: 'My Hook!' } }), {
    kind: 'webhook',
    config: { slug: 'my-hook' },
  });
  // webhook with no slug → bare kind.
  assert.deepEqual(normalizeTrigger({ kind: 'webhook' }), { kind: 'webhook' });
  // email keeps only known string keys.
  assert.deepEqual(normalizeTrigger({ kind: 'email', config: { host: 'imap.local', mailbox: 'ops@x', junk: 2 } }), {
    kind: 'email',
    config: { host: 'imap.local', mailbox: 'ops@x' },
  });
});

test('normalizeTrigger: throws on bad kind / bad cron', () => {
  assert.throws(() => normalizeTrigger({ kind: 'nope' }), /trigger.kind/);
  assert.throws(() => normalizeTrigger({ kind: 'schedule', config: { cron: 'x' } }), /cron/);
});

test('webhookPathFor: derives the inbound path; slug override wins over app slug', () => {
  assert.equal(webhookPathFor('reimburse'), '/api/v1/app/reimburse/run');
  assert.equal(
    webhookPathFor('reimburse', { kind: 'webhook', config: { slug: 'custom' } }),
    '/api/v1/app/custom/run',
  );
  // A non-webhook trigger ignores the override and uses the app slug.
  assert.equal(webhookPathFor('reimburse', { kind: 'on-demand' }), '/api/v1/app/reimburse/run');
  // No slug at all → the base path.
  assert.equal(webhookPathFor(undefined), '/api/v1/app/run');
});

test('cronOf: extracts cron only from a valid schedule trigger', () => {
  assert.equal(cronOf({ kind: 'schedule', config: { cron: '0 9 * * *' } }), '0 9 * * *');
  assert.equal(cronOf({ kind: 'schedule', config: { cron: 'bad' } }), null);
  assert.equal(cronOf({ kind: 'on-demand' }), null);
  assert.equal(cronOf(undefined), null);
});
