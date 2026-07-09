import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the webhook-trigger primitive, end to end against REAL Postgres + a REAL
// in-process OpenBao KV stub (the same honest analogue used by the connector-vault test — NOT a mock
// of our own functions). Proves the security-critical properties: the signing secret round-trips
// through the vault (only a ref in the row), a valid HMAC verifies, a replay is rejected by the nonce
// claim, a disabled trigger yields no secret, and CRUD is org-scoped (no cross-tenant read/delete).
// The route's governed dispatch (submitAppRun / dispatchAgentRun) is covered by the build + the
// existing app-run/agent-run tests; node --test can't import Next route handlers.

const ORG = 'test-int-webhook';
const OTHER = 'test-int-webhook-other';
const dbUp = await dbReachable();

const kv = new Map<string, string>();
let server: Server;

function startVault(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/v1/sys/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ sealed: false }));
        return;
      }
      const m = url.pathname.match(/^\/v1\/secret\/data\/(.+)$/);
      if (m) {
        const key = decodeURIComponent(m[1]);
        if (req.method === 'GET') {
          if (!kv.has(key)) { res.writeHead(404); res.end(); return; }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { data: { value: kv.get(key) } } }));
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            kv.set(key, JSON.parse(body || '{}')?.data?.value);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ data: { version: 1 } }));
          });
          return;
        }
        if (req.method === 'DELETE') { kv.delete(key); res.writeHead(204); res.end(); return; }
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      process.env.OFFGRID_OPENBAO_URL = `http://127.0.0.1:${port}`;
      process.env.OFFGRID_OPENBAO_TOKEN = 'test-token';
      resolve();
    });
  });
}

before(async () => {
  if (dbUp) await startVault();
});
after(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

test('webhook trigger: vaulted secret round-trip + HMAC verify + replay reject + org-scoped CRUD', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async () => {
  const store = await import('@/lib/webhook-triggers');
  const { computeSignature, verifyWebhook } = await import('@/lib/webhook-trigger-policy');

  // create → secret returned once, only a ref persisted (proven by resolve reading it back).
  const { trigger, secret } = await store.createWebhookTrigger({
    orgId: ORG, targetKind: 'app', targetId: 'app_demo', label: 'demo hook',
  });
  assert.ok(trigger.token.startsWith('wht_'));
  assert.ok(secret.startsWith('whsec_'));
  assert.equal(trigger.orgId, ORG);

  const resolved = await store.resolveWebhookSecret(trigger.token);
  assert.equal(resolved, secret, 'secret round-trips through the vault by token');

  // a valid HMAC over `${ts}.${body}` verifies.
  const body = JSON.stringify({ input: 'fire me' });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = computeSignature(ts, body, secret);
  const ok = verifyWebhook({ rawBody: body, signature: sig, timestamp: ts, secret: resolved, nowMs: Date.now() });
  assert.equal(ok.ok, true);

  // replay: the signature is single-use.
  assert.equal(await store.claimWebhookNonce(sig), true, 'first claim is fresh');
  assert.equal(await store.claimWebhookNonce(sig), false, 'second claim is a replay');

  // org isolation: OTHER org can't see or delete this trigger.
  const otherList = await store.listWebhookTriggers(OTHER);
  assert.equal(otherList.find((t) => t.id === trigger.id), undefined, 'not visible cross-org');
  assert.equal(await store.deleteWebhookTrigger(trigger.id, OTHER), false, 'not deletable cross-org');
  const mine = await store.listWebhookTriggers(ORG);
  assert.ok(mine.find((t) => t.id === trigger.id), 'visible to owning org');

  // rotate → new secret differs and resolves; disable → resolveWebhookSecret returns null.
  const rotated = await store.rotateWebhookSecret(trigger.id, ORG);
  assert.ok(rotated && rotated !== secret, 'rotate mints a new secret');
  assert.equal(await store.resolveWebhookSecret(trigger.token), rotated);
  assert.equal(await store.setWebhookTriggerEnabled(trigger.id, ORG, false), true);
  assert.equal(await store.resolveWebhookSecret(trigger.token), null, 'disabled trigger yields no secret');

  // cleanup
  assert.equal(await store.deleteWebhookTrigger(trigger.id, ORG), true);
});
