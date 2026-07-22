import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWebhookPayload,
  isWebhookSinkConfigured,
  persistWebhookSecret,
  postWebhook,
  removeWebhookSecret,
  resolveWebhookSecret,
  serializeWebhookBody,
  signWebhookBody,
  signatureHeaderValue,
  webhookConfigFromStep,
  WEBHOOK_SIGNATURE_HEADER,
} from '@/lib/adapters/sinks/webhook';

// ─── config (PURE) ──────────────────────────────────────────────────────────────────────────────

test('webhookConfigFromStep requires an http(s) url', () => {
  assert.equal(webhookConfigFromStep(undefined).ok, false);
  assert.equal(webhookConfigFromStep({}).ok, false);
  assert.equal(webhookConfigFromStep({ url: '   ' }).ok, false);
  assert.equal(webhookConfigFromStep({ url: 'ftp://x' }).ok, false);
  assert.equal(webhookConfigFromStep({ url: 'file:///etc' }).ok, false);
  const ok = webhookConfigFromStep({ url: 'https://hooks.corp/in', event: ' inc.created ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.config!.url, 'https://hooks.corp/in');
  assert.equal(ok.config!.event, 'inc.created');
});

test('webhookConfigFromStep trims a blank event to undefined', () => {
  const r = webhookConfigFromStep({ url: 'http://svc.local/hook', event: '   ' });
  assert.equal(r.config!.event, undefined);
});

// ─── payload + signature (PURE + deterministic) ────────────────────────────────────────────────

test('buildWebhookPayload is deterministic + defaults the event name', () => {
  const p = buildWebhookPayload(
    { runId: 'apprun_1', orgId: 'acme', appId: 'app_1', outcome: 'done' },
    '2026-07-22T00:00:00.000Z',
  );
  assert.deepEqual(p, {
    event: 'offgrid.app_run',
    sentAt: '2026-07-22T00:00:00.000Z',
    runId: 'apprun_1',
    orgId: 'acme',
    appId: 'app_1',
    outcome: 'done',
  });
});

test('signWebhookBody matches an independent HMAC-SHA256 over the exact body bytes', () => {
  const payload = buildWebhookPayload(
    { runId: 'r', orgId: 'o', appId: 'a', outcome: 'x', event: 'e' },
    '2026-01-01T00:00:00.000Z',
  );
  const body = serializeWebhookBody(payload);
  const sig = signWebhookBody(body, 'topsecret');
  const expected = createHmac('sha256', 'topsecret').update(body).digest('hex');
  assert.equal(sig, expected);
  assert.equal(signatureHeaderValue(sig), `sha256=${expected}`);
});

// ─── vaulted signing secret (real OpenBao adapter — no live vault in test → env fallback path) ────

test('resolveWebhookSecret falls back to OFFGRID_WEBHOOK_SECRET env when the vault has nothing', async () => {
  // No OFFGRID_OPENBAO_URL in test → the vault get returns undefined → env fallback is used.
  assert.equal(await resolveWebhookSecret({ OFFGRID_WEBHOOK_SECRET: 'env-key' }), 'env-key');
  assert.equal(await resolveWebhookSecret({}), null);
  assert.equal(await resolveWebhookSecret({ OFFGRID_WEBHOOK_SECRET: '   ' }), null);
});

test('persistWebhookSecret throws honestly when the vault backend is not reachable/writable', async () => {
  // With no OpenBao configured the KV write throws — surfaced, never a silent fake success.
  await assert.rejects(() => persistWebhookSecret('s'), /OpenBao|writable/);
});

test('removeWebhookSecret is best-effort — never throws even when the vault is unreachable', async () => {
  await removeWebhookSecret(); // must resolve without throwing
});

test('isWebhookSinkConfigured requires BOTH a valid url AND a resolvable secret', async () => {
  assert.equal(await isWebhookSinkConfigured({}, {}), false); // no url
  assert.equal(await isWebhookSinkConfigured({ url: 'https://hooks.corp/in' }, {}), false); // no secret
  assert.equal(
    await isWebhookSinkConfigured({ url: 'https://hooks.corp/in' }, { OFFGRID_WEBHOOK_SECRET: 's' }),
    true,
  );
});

// ─── send (I/O — fetch + env are the ONLY mocked boundary) ────────────────────────────────────────

const INPUT = { runId: 'apprun_9', orgId: 'acme', appId: 'app_z', outcome: 'the outcome' };

test('postWebhook honestly reports NOT CONFIGURED when the url is missing', async () => {
  const r = await postWebhook({}, INPUT, () => new Date(), {}, async () => new Response(''));
  assert.equal(r.configured, false);
  assert.match(r.reason, /not configured/i);
});

test('postWebhook refuses (not configured) when there is no signing secret', async () => {
  const r = await postWebhook(
    { url: 'https://hooks.corp/in' },
    INPUT,
    () => new Date(),
    {}, // no OFFGRID_WEBHOOK_SECRET → no secret (vault import will fail/return nothing under test)
    async () => new Response(''),
  );
  assert.equal(r.configured, false);
  assert.match(r.reason, /signing secret/);
});

test('postWebhook POSTs a signed payload the receiver can verify, reports delivered', async () => {
  let captured: { url: string; headers: Headers; body: string } | null = null;
  const secret = 'env-secret';
  const r = await postWebhook(
    { url: 'https://hooks.corp/in', event: 'inc.created' },
    INPUT,
    () => new Date('2026-07-22T12:00:00.000Z'),
    { OFFGRID_WEBHOOK_SECRET: secret },
    async (url, init) => {
      captured = {
        url: String(url),
        headers: new Headers(init!.headers),
        body: String(init!.body),
      };
      return new Response('ok', { status: 200 });
    },
  );
  assert.equal(r.ok, true);
  assert.equal(r.configured, true);
  assert.equal(r.status, 200);
  assert.equal(captured!.url, 'https://hooks.corp/in');
  // The signature header verifies against the exact body bytes with the same secret.
  const sigHeader = captured!.headers.get(WEBHOOK_SIGNATURE_HEADER);
  const expected = `sha256=${createHmac('sha256', secret).update(captured!.body).digest('hex')}`;
  assert.equal(sigHeader, expected);
  // The body carries the governed outcome + the operator's event name.
  const parsed = JSON.parse(captured!.body);
  assert.equal(parsed.outcome, 'the outcome');
  assert.equal(parsed.event, 'inc.created');
  assert.equal(captured!.headers.get('x-offgrid-event'), 'inc.created');
});

test('postWebhook reports a non-2xx endpoint response as a failure with the status', async () => {
  const r = await postWebhook(
    { url: 'https://hooks.corp/in' },
    INPUT,
    () => new Date(),
    { OFFGRID_WEBHOOK_SECRET: 's' },
    async () => new Response('nope', { status: 503 }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.configured, true);
  assert.equal(r.status, 503);
  assert.match(r.reason, /503/);
});

test('postWebhook reports a transport error (never throws)', async () => {
  const r = await postWebhook(
    { url: 'https://hooks.corp/in' },
    INPUT,
    () => new Date(),
    { OFFGRID_WEBHOOK_SECRET: 's' },
    async () => {
      throw new Error('ECONNREFUSED');
    },
  );
  assert.equal(r.ok, false);
  assert.equal(r.configured, true);
  assert.match(r.reason, /ECONNREFUSED/);
});
