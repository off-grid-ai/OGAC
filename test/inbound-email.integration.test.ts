import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the forward-to-address inbound mapping, end to end against REAL Postgres + an
// in-process OpenBao KV stub (same honest analogue as the webhook-triggers integration test). Proves
// the security-critical property: an inbound email's recipient address resolves — through the PURE
// address-derivation + the SHARED webhook-trigger seam (READ only) — to the correct bound trigger, and
// only within the configured domain. Also covers the resend_domains store CRUD (store only
// {domain,status,records}, org-scoped). The route's governed dispatch is covered by the build + the
// existing app-run/agent-run tests; node --test can't import Next route handlers.

const ORG = 'test-int-inbound';
const OTHER = 'test-int-inbound-other';
const DOMAIN = 'inbound.acme.co';
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
      process.env.OFFGRID_INBOUND_EMAIL_DOMAIN = DOMAIN;
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

test('inbound email → trigger mapping: address derives the bound trigger, domain-scoped', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async () => {
  const triggers = await import('@/lib/webhook-triggers');
  const { inboundAddressFor, inboundConfigFromEnv, normalizeInboundEmail } = await import('@/lib/inbound-email');

  // Mint a trigger for an app (reusing the webhook-trigger seam — the SAME token backs both ingresses).
  const { trigger } = await triggers.createWebhookTrigger({
    orgId: ORG, targetKind: 'app', targetId: 'app_inbound_demo', label: 'inbound demo',
  });

  const cfg = inboundConfigFromEnv();
  assert.equal(cfg.ok, true);
  const address = inboundAddressFor(trigger.token, cfg.domain!);
  assert.equal(address, `${trigger.token}@${DOMAIN}`);

  // A provider POSTs the parsed email; the recipient resolves to OUR token, and the lookup finds the
  // exact bound trigger (org + target intact) — the full mapping the receive route relies on.
  const parsed = normalizeInboundEmail(
    { from: 'client@corp', to: address, subject: 'Do the thing', text: 'process this please' },
    cfg.domain!,
  );
  assert.equal(parsed.token, trigger.token);
  assert.equal(parsed.input.input, 'process this please');

  const looked = await triggers.getWebhookTriggerByToken(parsed.token!);
  assert.ok(looked, 'the derived token resolves a real trigger row');
  assert.equal(looked!.id, trigger.id);
  assert.equal(looked!.orgId, ORG);
  assert.equal(looked!.targetId, 'app_inbound_demo');

  // An address for a DIFFERENT host never resolves a token (domain guard).
  const wrongHost = normalizeInboundEmail(
    { to: `${trigger.token}@evil.example.com`, text: 'x' },
    cfg.domain!,
  );
  assert.equal(wrongHost.token, null);

  // cleanup
  await triggers.deleteWebhookTrigger(trigger.id, ORG);
});

test('resend_domains store: upsert/list/get/delete, org-scoped, stores only {domain,status,records}', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async () => {
  const store = await import('@/lib/resend-domains-store');
  const domain = {
    id: 'dom_int_1',
    domain: 'mail.acme.co',
    status: 'pending' as const,
    region: 'us-east-1',
    records: [{ purpose: 'SPF' as const, type: 'TXT', name: 'send.mail.acme.co', value: 'v=spf1 ~all' }],
  };

  await store.upsertResendDomain(ORG, domain);
  const list = await store.listResendDomains(ORG);
  assert.ok(list.find((d) => d.id === 'dom_int_1'), 'visible to owning org');
  assert.equal(list.find((d) => d.id === 'dom_int_1')!.records[0].purpose, 'SPF');

  // Upsert again with a new status → status + records refresh (verify flow).
  await store.upsertResendDomain(ORG, { ...domain, status: 'verified' });
  const got = await store.getResendDomain('dom_int_1', ORG);
  assert.equal(got!.status, 'verified');

  // org isolation: OTHER can't see or delete it.
  assert.equal((await store.listResendDomains(OTHER)).find((d) => d.id === 'dom_int_1'), undefined);
  assert.equal(await store.getResendDomain('dom_int_1', OTHER), null);
  assert.equal(await store.deleteResendDomainRow('dom_int_1', OTHER), false);

  // owner delete works.
  assert.equal(await store.deleteResendDomainRow('dom_int_1', ORG), true);
  assert.equal(await store.getResendDomain('dom_int_1', ORG), null);
});
