import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  inboundAddressFor,
  inboundConfigFromEnv,
  normalizeInboundEmail,
  tokenFromInboundAddress,
} from '@/lib/inbound-email';

// ─── inboundConfigFromEnv ──────────────────────────────────────────────────────────────────────

test('inboundConfigFromEnv disabled with no domain; strips a leading @', () => {
  assert.equal(inboundConfigFromEnv({} as NodeJS.ProcessEnv).ok, false);
  const r = inboundConfigFromEnv({ OFFGRID_INBOUND_EMAIL_DOMAIN: '@inbound.acme.co' } as NodeJS.ProcessEnv);
  assert.equal(r.ok, true);
  assert.equal(r.domain, 'inbound.acme.co');
});

test('inboundConfigFromEnv rejects a non-host value', () => {
  const r = inboundConfigFromEnv({ OFFGRID_INBOUND_EMAIL_DOMAIN: 'https://x/y' } as NodeJS.ProcessEnv);
  assert.equal(r.ok, false);
});

// ─── address derivation (PURE) ──────────────────────────────────────────────────────────────────

test('inboundAddressFor builds <token>@<domain>; empty inputs → ""', () => {
  assert.equal(inboundAddressFor('wht_abc', 'inbound.acme.co'), 'wht_abc@inbound.acme.co');
  assert.equal(inboundAddressFor('', 'inbound.acme.co'), '');
  assert.equal(inboundAddressFor('wht_abc', ''), '');
});

test('tokenFromInboundAddress extracts the token; enforces the configured domain', () => {
  const d = 'inbound.acme.co';
  assert.equal(tokenFromInboundAddress('wht_abc@inbound.acme.co', d), 'wht_abc');
  assert.equal(tokenFromInboundAddress('Ops <wht_abc@inbound.acme.co>', d), 'wht_abc');
  // "+"-tag form: token is the part after the last '+'
  assert.equal(tokenFromInboundAddress('inbox+wht_abc@inbound.acme.co', d), 'wht_abc');
  // wrong domain → null (an address for another host can never resolve a token)
  assert.equal(tokenFromInboundAddress('wht_abc@evil.example.com', d), null);
  assert.equal(tokenFromInboundAddress('not-an-address', d), null);
  assert.equal(tokenFromInboundAddress('wht_abc@inbound.acme.co', ''), null);
});

// ─── parse → normalized input (PURE), reusing buildTriggerInput('email',…) ────────────────────────

test('normalizeInboundEmail derives the token + the flat email app-run input', () => {
  const out = normalizeInboundEmail(
    {
      from: 'sender@corp',
      to: 'wht_tok@inbound.acme.co',
      subject: 'Please process this',
      text: 'the body',
      messageId: '<m1>',
      date: '2026-01-01',
    },
    'inbound.acme.co',
  );
  assert.equal(out.token, 'wht_tok');
  assert.equal(out.input.input, 'the body'); // primary text = body
  assert.equal(out.input.subject, 'Please process this');
  assert.equal(out.input.from, 'sender@corp');
});

test('normalizeInboundEmail reads the envelope recipient + html fallback + attachment metadata', () => {
  const out = normalizeInboundEmail(
    {
      from: 'a@corp',
      recipient: 'wht_tok@inbound.acme.co', // Resend/SES envelope field
      subject: 's',
      html: '<p>hello <b>world</b></p><script>bad()</script>',
      attachments: [
        { filename: 'r.pdf', content_type: 'application/pdf', content: Buffer.from('PDFDATA').toString('base64') },
      ],
    },
    'inbound.acme.co',
  );
  assert.equal(out.token, 'wht_tok');
  assert.equal(out.input.input, 'hello world'); // html stripped to text, scripts removed
  assert.equal(out.attachments.length, 1);
  assert.equal(out.attachments[0].filename, 'r.pdf');
  assert.equal(out.attachments[0].contentType, 'application/pdf');
  assert.ok(out.attachments[0].size > 0);
});

test('normalizeInboundEmail returns token null when the recipient domain does not match', () => {
  const out = normalizeInboundEmail({ to: 'wht_tok@other.example.com', text: 'x' }, 'inbound.acme.co');
  assert.equal(out.token, null);
});

test('normalizeInboundEmail defensive: missing fields, numeric attachment size, non-array attachments', () => {
  // Empty/missing everything → empty input, null token, no attachments.
  const empty = normalizeInboundEmail({}, 'inbound.acme.co');
  assert.equal(empty.token, null);
  assert.equal(empty.input.input, '');
  assert.equal(empty.attachments.length, 0);

  // Attachment carries an explicit numeric size + name fallback + default content type.
  const withSize = normalizeInboundEmail(
    {
      to: 'wht_x@inbound.acme.co',
      text: 'hi',
      attachments: [{ name: 'f.bin', size: 512 }, 'junk'],
    },
    'inbound.acme.co',
  );
  assert.equal(withSize.attachments.length, 2);
  assert.equal(withSize.attachments[0].filename, 'f.bin');
  assert.equal(withSize.attachments[0].size, 512);
  assert.equal(withSize.attachments[0].contentType, 'application/octet-stream');

  // Non-array attachments field → [].
  const badAtt = normalizeInboundEmail(
    { to: 'wht_x@inbound.acme.co', text: 'hi', attachments: 'nope' },
    'inbound.acme.co',
  );
  assert.equal(badAtt.attachments.length, 0);
});

test('tokenFromInboundAddress: bare local part with no @ → null', () => {
  assert.equal(tokenFromInboundAddress('noatsign', 'inbound.acme.co'), null);
});
