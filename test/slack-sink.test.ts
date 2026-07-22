import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSlackPayload,
  isSlackSinkConfigured,
  persistSlackWebhookUrl,
  postSlack,
  removeSlackWebhookUrl,
  resolveSlackWebhookUrl,
} from '@/lib/adapters/sinks/slack';

// ─── payload shaping (PURE) ──────────────────────────────────────────────────────────────────────

test('buildSlackPayload fixes the bot username (no impersonation) + passes the text through', () => {
  const p = buildSlackPayload({ text: 'run done' });
  assert.equal(p.text, 'run done');
  assert.equal(p.username, 'Off Grid AI');
  assert.equal(p.channel, undefined);
});

test('buildSlackPayload passes a valid #channel / @user override, drops anything else', () => {
  assert.equal(buildSlackPayload({ text: 't', channel: '#ops-alerts' }).channel, '#ops-alerts');
  assert.equal(buildSlackPayload({ text: 't', channel: '@mac' }).channel, '@mac');
  assert.equal(buildSlackPayload({ text: 't', channel: 'ops-alerts' }).channel, undefined);
  assert.equal(buildSlackPayload({ text: 't', channel: '#a b' }).channel, undefined);
  assert.equal(buildSlackPayload({ text: 't', channel: '   ' }).channel, undefined);
});

// ─── vaulted webhook URL (real OpenBao adapter — no live vault in test → env fallback path) ───────

test('resolveSlackWebhookUrl falls back to SLACK_WEBHOOK_URL env when the vault has nothing', async () => {
  const url = 'https://hooks.slack.com/services/T/B/x';
  assert.equal(await resolveSlackWebhookUrl({ SLACK_WEBHOOK_URL: url }), url);
  assert.equal(await resolveSlackWebhookUrl({}), null);
  assert.equal(await resolveSlackWebhookUrl({ SLACK_WEBHOOK_URL: '  ' }), null);
});

test('persistSlackWebhookUrl throws honestly when the vault backend is not reachable/writable', async () => {
  await assert.rejects(() => persistSlackWebhookUrl('https://hooks.slack.com/x'), /OpenBao|writable/);
});

test('removeSlackWebhookUrl is best-effort — never throws even when the vault is unreachable', async () => {
  await removeSlackWebhookUrl();
});

test('isSlackSinkConfigured follows the resolvable webhook URL', async () => {
  assert.equal(await isSlackSinkConfigured({}), false);
  assert.equal(
    await isSlackSinkConfigured({ SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x' }),
    true,
  );
});

// ─── send (I/O — fetch + env are the ONLY mocked boundary) ────────────────────────────────────────

test('postSlack honestly reports NOT CONFIGURED when no webhook URL is set', async () => {
  const r = await postSlack({ text: 'x' }, {}, async () => new Response('ok'));
  assert.equal(r.configured, false);
  assert.match(r.reason, /not configured/i);
});

test('postSlack refuses an empty body (configured but nothing to say)', async () => {
  const r = await postSlack(
    { text: '   ' },
    { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x' },
    async () => new Response('ok'),
  );
  assert.equal(r.ok, false);
  assert.equal(r.configured, true);
  assert.match(r.reason, /non-empty/);
});

test('postSlack posts the message + reports success on 200 "ok"', async () => {
  let captured: { url: string; body: string } | null = null;
  const r = await postSlack(
    { text: 'the outcome', channel: '#ops' },
    { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x' },
    async (url, init) => {
      captured = { url: String(url), body: String(init!.body) };
      return new Response('ok', { status: 200 });
    },
  );
  assert.equal(r.ok, true);
  assert.equal(r.configured, true);
  assert.equal(captured!.url, 'https://hooks.slack.com/services/T/B/x');
  const parsed = JSON.parse(captured!.body);
  assert.equal(parsed.text, 'the outcome');
  assert.equal(parsed.channel, '#ops');
  assert.equal(parsed.username, 'Off Grid AI');
});

test('postSlack treats a non-200 as a failure with the status', async () => {
  const r = await postSlack(
    { text: 'x' },
    { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x' },
    async () => new Response('invalid_payload', { status: 400 }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.reason, /invalid_payload/);
});

test('postSlack treats a 200 with a non-"ok" body as a failure', async () => {
  const r = await postSlack(
    { text: 'x' },
    { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x' },
    async () => new Response('channel_not_found', { status: 200 }),
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /channel_not_found/);
});

test('postSlack tolerates a response whose body cannot be read (treats as non-ok failure)', async () => {
  const r = await postSlack(
    { text: 'x' },
    { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x' },
    async () =>
      // A Response whose .text() rejects — the sink's .catch(()=>'') keeps it from throwing.
      ({
        ok: true,
        status: 200,
        text: () => Promise.reject(new Error('stream error')),
      }) as unknown as Response,
  );
  assert.equal(r.ok, false); // empty body !== "ok" → honest failure, never a fake success
});

test('postSlack reports a transport error (never throws)', async () => {
  const r = await postSlack(
    { text: 'x' },
    { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/x' },
    async () => {
      throw new Error('ETIMEDOUT');
    },
  );
  assert.equal(r.ok, false);
  assert.equal(r.configured, true);
  assert.match(r.reason, /ETIMEDOUT/);
});
