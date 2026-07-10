import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// FULL round-trip INTEGRATION test for the connector-credential vault seam, end to end:
//   create (credential-free endpoint) → persistConnectorSecret → the row's endpoint has NO password
//   → the secret lives in the vault (not the DB) → resolveConnectorSecret reads it back
//   → connector-exec.resolveTargetCreds splices it back into the runtime URL
//   → deleteConnector removes the vault secret (no orphan).
//
// This exercises the REAL secrets adapter fetch code (baoSet/baoGet/baoRemove, KV v2 paths) against
// a REAL in-process HTTP server standing in for OpenBao — NOT a mock of our own functions. The only
// substitution is the vault BACKEND (a tiny in-memory KV that answers the exact v2 routes the adapter
// calls), which is the honest analogue of `cd deploy && make secrets`. Needs a real Postgres for the
// row I/O; skips green when Postgres is down.
//
// OFFGRID_OPENBAO_URL MUST be set before the secrets adapter module is first imported (it reads the
// env at module-eval). We set it here at file top, then use dynamic import() inside the test so the
// adapter binds to our stub server.

const ORG = 'test-int-connector-vault';
const dbUp = await dbReachable();

// ── In-memory KV v2 store speaking the routes the adapter uses ─────────────────────────────────────
const kv = new Map<string, string>();
let server: Server;
let baseUrl = '';

function startVault(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // sys/health — adapter probe.
      if (url.pathname === '/v1/sys/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ sealed: false }));
        return;
      }
      // KV v2 data path: /v1/secret/data/<encoded-key>
      const m = url.pathname.match(/^\/v1\/secret\/data\/(.+)$/);
      if (m) {
        const key = decodeURIComponent(m[1]);
        if (req.method === 'GET') {
          if (!kv.has(key)) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { data: { value: kv.get(key) } } }));
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            const parsed = JSON.parse(body || '{}');
            kv.set(key, parsed?.data?.value);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ data: { version: 1 } }));
          });
          return;
        }
        if (req.method === 'DELETE') {
          kv.delete(key);
          res.writeHead(204);
          res.end();
          return;
        }
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      // Bind the adapter to our stub BEFORE it is first imported anywhere below.
      process.env.OFFGRID_OPENBAO_URL = baseUrl;
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

test('connector credential round-trips through the vault; endpoint stays clean; delete purges it', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async (t) => {
  const { createConnector, deleteConnector, listConnectors } = await import('@/lib/store');
  const {
    persistConnectorSecret,
    resolveConnectorSecret,
    getConnectorSecretRef,
    connectorSecretKey,
  } = await import('@/lib/connector-secrets');

  t.after(async () => {
    for (const c of await listConnectors(ORG)) await deleteConnector(c.id, ORG);
  });

  // 1. Create with a credential-FREE endpoint (what the POST route stores after the pure split).
  const created = await createConnector({
    name: 'Vaulted Core Banking',
    type: 'postgres',
    endpoint: 'postgres://reader@db.internal:5432/corebank',
    auth: 'api-key',
    custom: true,
    orgId: ORG,
  });

  // 2. Push the secret to the vault + stamp the row (what the route does after createConnector).
  const password = 'Sup3rSecret!';
  const ref = await persistConnectorSecret(created.id, password);
  assert.equal(ref, connectorSecretKey(created.id));

  // 3. The DB row's endpoint carries NO password; the row references the vault key.
  const listed = (await listConnectors(ORG)).find((c) => c.id === created.id)!;
  assert.ok(listed);
  assert.ok(!listed.endpoint.includes(password), 'the password is NOT in the DB endpoint');
  assert.equal(listed.endpoint, 'postgres://reader@db.internal:5432/corebank');
  assert.equal(await getConnectorSecretRef(created.id), ref);

  // 4. The secret really lives in the vault (our stub KV), keyed by the ref.
  assert.equal(kv.get(ref!), password, 'the password is stored in the vault, not the DB');

  // 5. resolveConnectorSecret reads it back from the vault by id.
  assert.equal(await resolveConnectorSecret(created.id), password);

  // 6. connector-exec re-injects it into the runtime URL (endpoint on the row stays clean).
  const { detectDialect } = await import('@/lib/connector-exec');
  const { spliceCredential } = await import('@/lib/connector-policy');
  assert.equal(detectDialect('postgres', listed.endpoint), 'postgres');
  const runtimeUrl = spliceCredential('postgres', listed.endpoint, await resolveConnectorSecret(created.id) ?? '');
  const u = new URL(runtimeUrl);
  assert.equal(decodeURIComponent(u.password), password, 'exec splices the vaulted secret back in');
  assert.equal(u.username, 'reader');

  // 7. Delete purges the vault secret — no orphan left behind.
  await deleteConnector(created.id, ORG);
  assert.equal(kv.has(ref!), false, 'the vault secret is removed on connector delete');
  assert.equal(await resolveConnectorSecret(created.id), null);
});
