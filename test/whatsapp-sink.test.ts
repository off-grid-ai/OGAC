import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWhatsAppSend,
  isWhatsAppSinkConfigured,
  sendWhatsApp,
} from '@/lib/adapters/sinks/whatsapp';

const GW = { OFFGRID_WHATSAPP_URL: 'http://wa-gateway.lan:3000' };

// ─── payload shaping (PURE) ──────────────────────────────────────────────────────────────────────

test('buildWhatsAppSend normalizes the recipient (strips spaces/dashes, keeps +)', () => {
  assert.deepEqual(buildWhatsAppSend('+91 98765-43210', 'hi'), { to: '+919876543210', text: 'hi' });
  assert.deepEqual(buildWhatsAppSend('  918888  ', 'x'), { to: '918888', text: 'x' });
});

// ─── config gate (reuses the trigger's pure authority) ───────────────────────────────────────────

test('isWhatsAppSinkConfigured follows OFFGRID_WHATSAPP_URL', () => {
  assert.equal(isWhatsAppSinkConfigured({}), false);
  assert.equal(isWhatsAppSinkConfigured({ OFFGRID_WHATSAPP_URL: 'notaurl' }), false);
  assert.equal(isWhatsAppSinkConfigured(GW), true);
});

// ─── send (I/O — fetch + env are the ONLY mocked boundary) ────────────────────────────────────────

test('sendWhatsApp honestly reports NOT CONFIGURED when the gateway URL is unset', async () => {
  const r = await sendWhatsApp('+9199', 'hi', {}, async () => new Response(''));
  assert.equal(r.configured, false);
  assert.match(r.reason, /disabled|not configured/i);
});

test('sendWhatsApp refuses without a recipient (configured but no `to`)', async () => {
  const r = await sendWhatsApp('  ', 'hi', GW, async () => new Response(''));
  assert.equal(r.ok, false);
  assert.equal(r.configured, true);
  assert.match(r.reason, /recipient/);
});

test('sendWhatsApp POSTs to {url}/send with to+text, reports sent, forwards the bearer token', async () => {
  let captured: { url: string; body: string; auth: string | null } | null = null;
  const r = await sendWhatsApp(
    '+91 99999',
    'your run is done',
    { ...GW, OFFGRID_WHATSAPP_TOKEN: 'gw-tok' },
    async (url, init) => {
      captured = {
        url: String(url),
        body: String(init!.body),
        auth: new Headers(init!.headers).get('authorization'),
      };
      return new Response('', { status: 200 });
    },
  );
  assert.equal(r.ok, true);
  assert.equal(r.configured, true);
  assert.equal(captured!.url, 'http://wa-gateway.lan:3000/send');
  assert.equal(captured!.auth, 'Bearer gw-tok');
  const parsed = JSON.parse(captured!.body);
  assert.equal(parsed.to, '+9199999');
  assert.equal(parsed.text, 'your run is done');
});

test('sendWhatsApp reports a non-2xx gateway response as a failure with the status', async () => {
  const r = await sendWhatsApp('+9199', 'x', GW, async () => new Response('bad number', { status: 422 }));
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.match(r.reason, /422/);
  assert.match(r.reason, /bad number/);
});

test('sendWhatsApp reports a transport error (never throws)', async () => {
  const r = await sendWhatsApp('+9199', 'x', GW, async () => {
    throw new Error('ECONNREFUSED');
  });
  assert.equal(r.ok, false);
  assert.equal(r.configured, true);
  assert.match(r.reason, /ECONNREFUSED/);
});
