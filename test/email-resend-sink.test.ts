import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildResendPayload,
  isResendSinkConfigured,
  RESEND_ENDPOINT,
  resendConfigFromEnv,
  resolveResendApiKey,
  sendViaResend,
} from '@/lib/adapters/sinks/email-resend';

// ─── resendConfigFromEnv — needs a From (RESEND_FROM or OFFGRID_SMTP_FROM), no secret handling ─────

test('resendConfigFromEnv is disabled with no From address', () => {
  const r = resendConfigFromEnv({} as NodeJS.ProcessEnv);
  assert.equal(r.ok, false);
  assert.match(r.reason, /RESEND_FROM/);
});

test('resendConfigFromEnv accepts RESEND_FROM, then falls back to OFFGRID_SMTP_FROM', () => {
  assert.equal(resendConfigFromEnv({ RESEND_FROM: 'a@x' } as NodeJS.ProcessEnv).config!.from, 'a@x');
  assert.equal(
    resendConfigFromEnv({ OFFGRID_SMTP_FROM: 'b@y' } as NodeJS.ProcessEnv).config!.from,
    'b@y',
  );
});

// ─── resolveResendApiKey — env fallback (vault unreachable in unit env) ────────────────────────────

test('resolveResendApiKey falls back to RESEND_API_KEY env when the vault has nothing', async () => {
  const key = await resolveResendApiKey({ RESEND_API_KEY: 're_test_123' } as NodeJS.ProcessEnv);
  assert.equal(key, 're_test_123');
});

test('resolveResendApiKey returns null when neither vault nor env has a key', async () => {
  const key = await resolveResendApiKey({} as NodeJS.ProcessEnv);
  assert.equal(key, null);
});

test('isResendSinkConfigured requires BOTH a From and a key', async () => {
  assert.equal(await isResendSinkConfigured({ RESEND_FROM: 'a@x' } as NodeJS.ProcessEnv), false);
  assert.equal(await isResendSinkConfigured({ RESEND_API_KEY: 'k' } as NodeJS.ProcessEnv), false);
  assert.equal(
    await isResendSinkConfigured({ RESEND_FROM: 'a@x', RESEND_API_KEY: 'k' } as NodeJS.ProcessEnv),
    true,
  );
});

// ─── buildResendPayload — PURE, deterministic, injection-safe ──────────────────────────────────────

test('buildResendPayload shapes to/subject/text, splits recipients, sanitizes headers', () => {
  const p = buildResendPayload('Off Grid <bot@corp>', {
    to: 'a@x, b@y ; c@z',
    subject: 'Digest\r\ninjected: header',
    text: 'hello',
  });
  assert.deepEqual(p.to, ['a@x', 'b@y', 'c@z']);
  assert.equal(p.subject, 'Digest injected: header'); // CRLF collapsed (no header injection)
  assert.equal(p.from, 'Off Grid <bot@corp>');
  assert.equal(p.text, 'hello');
});

test('buildResendPayload derives injection-safe HTML + tags + base64 attachments', () => {
  const p = buildResendPayload(
    'bot@corp',
    {
      to: 'a@x',
      subject: 's',
      text: 'line1\nline2\n\npara2 <script>',
      attachments: [{ filename: 'r.pdf', contentType: 'application/pdf', bytes: new TextEncoder().encode('PDF') }],
    },
    { html: true, replyTo: 'reply@corp', tags: { 'src name!': 'app run#1' } },
  );
  assert.match(p.html!, /<p>line1<br>line2<\/p>/);
  assert.match(p.html!, /&lt;script&gt;/); // escaped, never raw
  assert.equal(p.reply_to, 'reply@corp');
  assert.deepEqual(p.tags, [{ name: 'src_name_', value: 'app_run_1' }]); // sanitized to [A-Za-z0-9_-]
  assert.equal(p.attachments![0].filename, 'r.pdf');
  assert.equal(p.attachments![0].content, Buffer.from('PDF').toString('base64'));
});

// ─── sendViaResend — governed send against an IN-PROCESS Resend-API STUB (not a mock of our code) ──

function stubResend(captured: { body?: unknown; auth?: string }, opts: { status?: number; id?: string; error?: string } = {}) {
  const status = opts.status ?? 200;
  const impl: typeof fetch = async (url, init) => {
    assert.equal(String(url), RESEND_ENDPOINT);
    captured.auth = (init?.headers as Record<string, string>).Authorization;
    captured.body = JSON.parse(String(init?.body));
    const payload = status < 300 ? { id: opts.id ?? 'msg_1' } : { message: opts.error ?? 'bad' };
    return new Response(JSON.stringify(payload), { status });
  };
  return impl;
}

test('sendViaResend sends: correct endpoint, Bearer auth, shaped body → { ok, id }', async () => {
  const captured: { body?: unknown; auth?: string } = {};
  const res = await sendViaResend(
    { to: 'ceo@corp', subject: 'PAN report', text: 'body' },
    { html: true },
    { RESEND_FROM: 'bot@corp', RESEND_API_KEY: 're_live_key' } as NodeJS.ProcessEnv,
    stubResend(captured, { id: 'msg_42' }),
  );
  assert.equal(res.ok, true);
  assert.equal(res.id, 'msg_42');
  assert.equal(captured.auth, 'Bearer re_live_key');
  assert.deepEqual((captured.body as { to: string[] }).to, ['ceo@corp']);
});

test('sendViaResend honest-degrades to configured:false when no From/key (no fetch)', async () => {
  let called = false;
  const impl: typeof fetch = async () => {
    called = true;
    return new Response('{}');
  };
  const res = await sendViaResend({ to: 'a@x', subject: 's', text: 't' }, {}, {} as NodeJS.ProcessEnv, impl);
  assert.equal(res.configured, false);
  assert.equal(res.ok, false);
  assert.equal(called, false, 'no wire call when unconfigured');
});

test('sendViaResend refuses without a recipient (configured but no `to`)', async () => {
  const res = await sendViaResend(
    { to: '', subject: 's', text: 't' },
    {},
    { RESEND_FROM: 'a@x', RESEND_API_KEY: 'k' } as NodeJS.ProcessEnv,
    stubResend({}),
  );
  assert.equal(res.configured, true);
  assert.equal(res.ok, false);
  assert.match(res.reason, /no recipient/i);
});

test('sendViaResend handles a network throw honestly', async () => {
  const impl: typeof fetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  const res = await sendViaResend(
    { to: 'a@x', subject: 's', text: 't' },
    {},
    { RESEND_FROM: 'a@x', RESEND_API_KEY: 'k' } as NodeJS.ProcessEnv,
    impl,
  );
  assert.equal(res.ok, false);
  assert.match(res.reason, /ECONNREFUSED/);
});

test('sendViaResend: non-JSON error body + missing id degrade gracefully', async () => {
  const nonJsonErr: typeof fetch = async () => new Response('gateway timeout', { status: 504 });
  const r1 = await sendViaResend(
    { to: 'a@x', subject: 's', text: 't' },
    {},
    { RESEND_FROM: 'a@x', RESEND_API_KEY: 'k' } as NodeJS.ProcessEnv,
    nonJsonErr,
  );
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /504.*gateway timeout/);

  const okNoId: typeof fetch = async () => new Response('not json', { status: 200 });
  const r2 = await sendViaResend(
    { to: 'a@x', subject: 's', text: 't' },
    {},
    { RESEND_FROM: 'a@x', RESEND_API_KEY: 'k' } as NodeJS.ProcessEnv,
    okNoId,
  );
  assert.equal(r2.ok, true);
  assert.equal(r2.id, undefined);
});

test('buildResendPayload without opts: no html/reply_to/tags/attachments', () => {
  const p = buildResendPayload('a@x', { to: 'b@y', subject: 's', text: 't' });
  assert.equal(p.html, undefined);
  assert.equal(p.reply_to, undefined);
  assert.equal(p.tags, undefined);
  assert.equal(p.attachments, undefined);
});

test('sendViaResend surfaces a Resend API error honestly (no fake success)', async () => {
  const res = await sendViaResend(
    { to: 'a@x', subject: 's', text: 't' },
    {},
    { RESEND_FROM: 'a@x', RESEND_API_KEY: 'k' } as NodeJS.ProcessEnv,
    stubResend({}, { status: 422, error: 'domain not verified' }),
  );
  assert.equal(res.ok, false);
  assert.match(res.reason, /422.*domain not verified/);
});
