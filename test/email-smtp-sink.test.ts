import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildMimeMessage,
  isEmailSinkConfigured,
  sendEmail,
  smtpConfigFromEnv,
} from '@/lib/adapters/sinks/email-smtp';

// ─── smtpConfigFromEnv — air-gap: disabled unless the operator set an explicit on-prem host ───────

test('smtpConfigFromEnv is DISABLED with no OFFGRID_SMTP_URL (never a default/cloud host)', () => {
  const r = smtpConfigFromEnv({} as NodeJS.ProcessEnv);
  assert.equal(r.ok, false);
  assert.match(r.reason, /not configured/i);
  assert.equal(isEmailSinkConfigured({} as NodeJS.ProcessEnv), false);
});

test('smtpConfigFromEnv requires a From address', () => {
  const r = smtpConfigFromEnv({ OFFGRID_SMTP_URL: 'smtp://mail.corp:587' } as NodeJS.ProcessEnv);
  assert.equal(r.ok, false);
  assert.match(r.reason, /OFFGRID_SMTP_FROM/);
});

test('smtpConfigFromEnv parses an smtps:// URL as implicit TLS on 465', () => {
  const r = smtpConfigFromEnv({
    OFFGRID_SMTP_URL: 'smtps://mail.corp',
    OFFGRID_SMTP_FROM: 'bot@corp',
  } as NodeJS.ProcessEnv);
  assert.equal(r.ok, true);
  assert.equal(r.config!.host, 'mail.corp');
  assert.equal(r.config!.port, 465);
  assert.equal(r.config!.tls, true);
  assert.equal(r.config!.from, 'bot@corp');
});

test('smtpConfigFromEnv parses a bare host:port (default no-implicit-TLS on 587) + auth', () => {
  const r = smtpConfigFromEnv({
    OFFGRID_SMTP_URL: 'mail.corp:587',
    OFFGRID_SMTP_FROM: 'bot@corp',
    OFFGRID_SMTP_USER: 'u',
    OFFGRID_SMTP_PASS: 'p',
  } as NodeJS.ProcessEnv);
  assert.equal(r.ok, true);
  assert.equal(r.config!.host, 'mail.corp');
  assert.equal(r.config!.port, 587);
  assert.equal(r.config!.tls, false);
  assert.equal(r.config!.user, 'u');
  assert.equal(r.config!.pass, 'p');
});

test('smtpConfigFromEnv rejects a non-smtp scheme (can not point at a web endpoint)', () => {
  const r = smtpConfigFromEnv({
    OFFGRID_SMTP_URL: 'https://evil.example.com',
    OFFGRID_SMTP_FROM: 'bot@corp',
  } as NodeJS.ProcessEnv);
  assert.equal(r.ok, false);
  assert.match(r.reason, /not a valid host or smtp/i);
});

// ─── buildMimeMessage — PURE, deterministic ───────────────────────────────────────────────────────

test('buildMimeMessage builds a plain-text message with sanitized headers', () => {
  const mime = buildMimeMessage('bot@corp', {
    to: 'ceo@corp',
    subject: 'Weekly digest\r\ninjected: header', // CRLF must be stripped (no header injection)
    text: 'Line one\n.hidden line', // leading-dot line must be dot-stuffed
  }, { date: 'Mon, 01 Jan 2024 00:00:00 +0000' });
  assert.match(mime, /^From: bot@corp\r\n/);
  assert.match(mime, /To: ceo@corp\r\n/);
  assert.match(mime, /Subject: Weekly digest injected: header\r\n/); // CRLF collapsed to a space
  assert.ok(!/Subject:.*\r\ninjected/.test(mime), 'header injection must be neutralised');
  assert.match(mime, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(mime, /\r\n\.\.hidden line/); // dot-stuffed
});

test('buildMimeMessage builds multipart/mixed with a base64 attachment', () => {
  const mime = buildMimeMessage('bot@corp', {
    to: 'ops@corp',
    subject: 'Report',
    text: 'See attached.',
    attachments: [{ filename: 'run.pdf', contentType: 'application/pdf', bytes: new TextEncoder().encode('PDFDATA') }],
  }, { date: 'Mon, 01 Jan 2024 00:00:00 +0000', boundary: 'BOUND' });
  assert.match(mime, /Content-Type: multipart\/mixed; boundary="BOUND"/);
  assert.match(mime, /--BOUND\r\nContent-Type: text\/plain/);
  assert.match(mime, /--BOUND\r\nContent-Type: application\/pdf; name="run.pdf"/);
  assert.match(mime, /Content-Disposition: attachment; filename="run.pdf"/);
  assert.match(mime, new RegExp(Buffer.from('PDFDATA').toString('base64')));
  assert.match(mime, /--BOUND--$/);
});

// ─── sendEmail — honest degrade when unconfigured (no socket opened) ──────────────────────────────

test('sendEmail returns configured:false (no fake success, no socket) when SMTP env is absent', async () => {
  const r = await sendEmail({ to: 'x@y', subject: 's', text: 't' }, {} as NodeJS.ProcessEnv);
  assert.equal(r.ok, false);
  assert.equal(r.configured, false);
  assert.match(r.reason, /not configured/i);
});

test('sendEmail refuses to send without a recipient (configured but no `to`)', async () => {
  const r = await sendEmail(
    { to: '', subject: 's', text: 't' },
    { OFFGRID_SMTP_URL: 'smtp://mail.corp', OFFGRID_SMTP_FROM: 'bot@corp' } as NodeJS.ProcessEnv,
  );
  assert.equal(r.ok, false);
  assert.equal(r.configured, true);
  assert.match(r.reason, /no recipient/i);
});
