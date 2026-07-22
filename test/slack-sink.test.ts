import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSlackPayload, postSlack } from '@/lib/adapters/sinks/slack';

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
