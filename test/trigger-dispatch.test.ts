import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTriggerInput,
  imapConfigFromEnv,
  triggerAvailability,
  whatsappConfigFromEnv,
} from '@/lib/trigger-dispatch';

// Pure-logic unit tests for the Phase 4C trigger dispatch layer: payload → app-run input, the
// air-gap availability gate, and the on-prem config parsers. No I/O.

// ─── buildTriggerInput ────────────────────────────────────────────────────────────────────────
test('buildTriggerInput: webhook honors common primary-text keys', () => {
  assert.equal(buildTriggerInput('webhook', { input: 'hi' }).input, 'hi');
  assert.equal(buildTriggerInput('webhook', { text: 'hi' }).input, 'hi');
  assert.equal(buildTriggerInput('webhook', { message: 'hi' }).input, 'hi');
  assert.equal(buildTriggerInput('webhook', { prompt: 'hi' }).input, 'hi');
  assert.equal(buildTriggerInput('webhook', { content: 'hi' }).input, 'hi');
});

test('buildTriggerInput: webhook carries the full body through, drops functions', () => {
  const out = buildTriggerInput('webhook', { input: 'x', extra: 42, fn: () => 1 });
  const body = out.body as Record<string, unknown>;
  assert.equal(body.input, 'x');
  assert.equal(body.extra, 42);
  assert.equal('fn' in body, false);
});

test('buildTriggerInput: webhook with a bare string body still yields input', () => {
  assert.equal(buildTriggerInput('webhook', 'raw text').input, 'raw text');
});

test('buildTriggerInput: email flattens body/subject/from', () => {
  const out = buildTriggerInput('email', {
    text: 'body here',
    subject: 'Re: hi',
    from: 'a@b.c',
    messageId: '<1@x>',
  });
  assert.equal(out.input, 'body here');
  assert.equal(out.subject, 'Re: hi');
  assert.equal(out.from, 'a@b.c');
  assert.equal(out.messageId, '<1@x>');
});

test('buildTriggerInput: whatsapp flattens text/from', () => {
  const out = buildTriggerInput('whatsapp', { text: 'yo', from: '+15551234' });
  assert.equal(out.input, 'yo');
  assert.equal(out.from, '+15551234');
});

test('buildTriggerInput: clamps oversized text', () => {
  const huge = 'a'.repeat(200_000);
  const out = buildTriggerInput('webhook', { input: huge });
  assert.equal((out.input as string).length, 100_000);
});

// ─── triggerAvailability (the air-gap gate) ─────────────────────────────────────────────────────
test('triggerAvailability: on-demand/webhook/schedule always available + enabled', () => {
  for (const k of ['on-demand', 'webhook', 'schedule'] as const) {
    const a = triggerAvailability(k, {});
    assert.equal(a.state, 'available');
    assert.equal(a.enabled, true);
  }
});

test('triggerAvailability: email is coming-soon with NO env (air-gap default)', () => {
  const a = triggerAvailability('email', {});
  assert.equal(a.state, 'coming-soon');
  assert.equal(a.enabled, false);
});

test('triggerAvailability: email available only with full on-prem IMAP env', () => {
  const env = {
    OFFGRID_EMAIL_IMAP_URL: 'imaps://mail.internal.corp',
    OFFGRID_EMAIL_IMAP_USER: 'bot@corp',
    OFFGRID_EMAIL_IMAP_PASS: 'secret',
  } as NodeJS.ProcessEnv;
  const a = triggerAvailability('email', env);
  assert.equal(a.state, 'available');
  assert.equal(a.enabled, true);
});

test('triggerAvailability: email stays disabled if creds missing', () => {
  const a = triggerAvailability('email', {
    OFFGRID_EMAIL_IMAP_URL: 'imaps://mail.internal.corp',
  } as NodeJS.ProcessEnv);
  assert.equal(a.enabled, false);
});

test('triggerAvailability: whatsapp coming-soon without gateway URL', () => {
  assert.equal(triggerAvailability('whatsapp', {}).state, 'coming-soon');
});

test('triggerAvailability: whatsapp available with on-prem gateway URL', () => {
  const a = triggerAvailability('whatsapp', {
    OFFGRID_WHATSAPP_URL: 'https://wa.internal.corp',
  } as NodeJS.ProcessEnv);
  assert.equal(a.state, 'available');
  assert.equal(a.enabled, true);
});

test('triggerAvailability: unknown kind', () => {
  assert.equal(triggerAvailability('sms', {}).state, 'unknown-kind');
});

// ─── on-prem config parsers ─────────────────────────────────────────────────────────────────────
test('imapConfigFromEnv: disabled when unconfigured', () => {
  assert.equal(imapConfigFromEnv({}).ok, false);
});

test('imapConfigFromEnv: parses imaps:// URL with TLS', () => {
  const r = imapConfigFromEnv({
    OFFGRID_EMAIL_IMAP_URL: 'imaps://mail.internal.corp:993',
    OFFGRID_EMAIL_IMAP_USER: 'bot',
    OFFGRID_EMAIL_IMAP_PASS: 'pw',
  } as NodeJS.ProcessEnv);
  assert.equal(r.ok, true);
  assert.equal(r.config!.host, 'mail.internal.corp:993');
  assert.equal(r.config!.tls, true);
  assert.equal(r.config!.mailbox, 'INBOX');
});

test('imapConfigFromEnv: bare host defaults to TLS', () => {
  const r = imapConfigFromEnv({
    OFFGRID_EMAIL_IMAP_URL: 'mail.internal.corp',
    OFFGRID_EMAIL_IMAP_USER: 'bot',
    OFFGRID_EMAIL_IMAP_PASS: 'pw',
  } as NodeJS.ProcessEnv);
  assert.equal(r.ok, true);
  assert.equal(r.config!.tls, true);
});

test('imapConfigFromEnv: rejects a non-imap scheme (no random web endpoints)', () => {
  const r = imapConfigFromEnv({
    OFFGRID_EMAIL_IMAP_URL: 'https://evil.example.com',
    OFFGRID_EMAIL_IMAP_USER: 'bot',
    OFFGRID_EMAIL_IMAP_PASS: 'pw',
  } as NodeJS.ProcessEnv);
  assert.equal(r.ok, false);
});

test('imapConfigFromEnv: custom mailbox honored', () => {
  const r = imapConfigFromEnv({
    OFFGRID_EMAIL_IMAP_URL: 'imaps://mail.internal.corp',
    OFFGRID_EMAIL_IMAP_USER: 'bot',
    OFFGRID_EMAIL_IMAP_PASS: 'pw',
    OFFGRID_EMAIL_IMAP_MAILBOX: 'Triggers',
  } as NodeJS.ProcessEnv);
  assert.equal(r.config!.mailbox, 'Triggers');
});

test('whatsappConfigFromEnv: disabled when unconfigured', () => {
  assert.equal(whatsappConfigFromEnv({}).ok, false);
});

test('whatsappConfigFromEnv: accepts an on-prem http(s) gateway, strips trailing slash', () => {
  const r = whatsappConfigFromEnv({
    OFFGRID_WHATSAPP_URL: 'https://wa.internal.corp/',
    OFFGRID_WHATSAPP_TOKEN: 't',
    OFFGRID_WHATSAPP_NUMBER: '+15551234',
  } as NodeJS.ProcessEnv);
  assert.equal(r.ok, true);
  assert.equal(r.config!.url, 'https://wa.internal.corp');
  assert.equal(r.config!.token, 't');
  assert.equal(r.config!.number, '+15551234');
});

test('whatsappConfigFromEnv: rejects a non-URL', () => {
  assert.equal(whatsappConfigFromEnv({ OFFGRID_WHATSAPP_URL: 'not a url' } as NodeJS.ProcessEnv).ok, false);
});
