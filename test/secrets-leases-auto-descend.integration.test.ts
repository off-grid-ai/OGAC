import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

// INTEGRATION: the Leases page used to stop at the FIRST folder a listing returned — for the
// dynamic-DB engine that is `database/`, three hops above where an actual lease lives
// (`database/creds/<role>/<id>`), so landing on the root read as empty even with a real, revocable
// lease two levels down. This drives the REAL route (src/app/api/v1/admin/secrets/leases/route.ts
// GET/DELETE) against a fake vault that implements the actual sys/leases/lookup LIST semantics,
// proving the auto-descend walks through single-child namespaces and stops the moment there is
// something real to show — either a leaf lease or a genuine branch (more than one entry).
//
// One test, one server, one module import: the route module caches OFFGRID_OPENBAO_URL as a
// top-level const on first import (see src/lib/adapters/secrets.ts), so re-pointing it at a second
// fake server mid-file would silently keep hitting the FIRST server's (by-then-closed) port. Every
// scenario below instead mutates the SAME in-memory lease set behind the one server + one import.

const TOKEN = 'secrets-leases-auto-descend-admin';
const DEFAULT_ORG = 'default';

function childrenOf(keys: Iterable<string>, prefix: string): string[] {
  const out = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    out.add(slash === -1 ? rest : rest.slice(0, slash + 1));
  }
  return [...out];
}

test('leases auto-descend: walks single-child namespaces, stops at a leaf or a real branch, and revoke stays real', async (t) => {
  const leaseIds = new Set(['database/creds/demo-readonly/abc123']);

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://vault');
    const rootList = url.pathname === '/v1/sys/leases/lookup' && request.method === 'GET';
    const nestedList = url.pathname.match(/^\/v1\/sys\/leases\/lookup\/(.+)$/);
    if (rootList || (nestedList && request.method === 'GET')) {
      const prefix = nestedList ? `${decodeURIComponent(nestedList[1])}/` : '';
      response.setHeader('content-type', 'application/json');
      return response.end(JSON.stringify({ data: { keys: childrenOf(leaseIds, prefix) } }));
    }
    if (url.pathname === '/v1/sys/leases/lookup' && request.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as { lease_id?: string };
      if (!body.lease_id || !leaseIds.has(body.lease_id)) {
        response.statusCode = 404;
        return response.end();
      }
      response.setHeader('content-type', 'application/json');
      return response.end(JSON.stringify({ data: { id: body.lease_id, ttl: 3600, renewable: true } }));
    }
    if (url.pathname === '/v1/sys/leases/revoke' && request.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as { lease_id?: string };
      leaseIds.delete(body.lease_id ?? '');
      response.statusCode = 204;
      return response.end();
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;

  const previous = {
    url: process.env.OFFGRID_OPENBAO_URL,
    token: process.env.OFFGRID_OPENBAO_TOKEN,
    admin: process.env.OFFGRID_ADMIN_TOKEN,
    org: process.env.OFFGRID_ORG,
    auth: process.env.AUTH_SECRET,
  };
  process.env.OFFGRID_OPENBAO_URL = `http://127.0.0.1:${port}`;
  process.env.OFFGRID_OPENBAO_TOKEN = 'test-token';
  process.env.OFFGRID_ADMIN_TOKEN = TOKEN;
  process.env.OFFGRID_ORG = DEFAULT_ORG;
  process.env.AUTH_SECRET = 'test-secrets-leases-auto-descend-auth';
  t.after(() => {
    for (const [key, value] of Object.entries({
      OFFGRID_OPENBAO_URL: previous.url,
      OFFGRID_OPENBAO_TOKEN: previous.token,
      OFFGRID_ADMIN_TOKEN: previous.admin,
      OFFGRID_ORG: previous.org,
      AUTH_SECRET: previous.auth,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const leasesRoute = await import('@/app/api/v1/admin/secrets/leases/route');

  function req(path: string, init?: RequestInit) {
    return new Request(`http://console.local${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  }

  // Scenario 1: a lone lease three folders below the root surfaces on the ROOT listing.
  {
    const res = await leasesRoute.GET(req('/api/v1/admin/secrets/leases?prefix='));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { prefix: string; leases: { id: string }[] };
    assert.equal(body.prefix, 'database/creds/demo-readonly/');
    assert.deepEqual(body.leases.map((l) => l.id), ['database/creds/demo-readonly/abc123']);
  }

  // Scenario 2: a SECOND sibling lease turns that final hop into a real branch (two leaves) — the
  // walk stops there rather than guessing between them.
  leaseIds.add('database/creds/demo-readonly/def456');
  {
    const res = await leasesRoute.GET(req('/api/v1/admin/secrets/leases?prefix='));
    const body = (await res.json()) as { prefix: string; leases: { id: string }[] };
    assert.equal(body.prefix, 'database/creds/demo-readonly/');
    assert.deepEqual(
      body.leases.map((l) => l.id).sort(),
      ['database/creds/demo-readonly/abc123', 'database/creds/demo-readonly/def456'],
    );
  }

  // Scenario 3: revoking one of the two leaves is REAL (the fake vault's own store shrinks), and a
  // re-list at the landed prefix reflects it — a failure here would show a lease that no longer
  // exists, exactly the "failure presents as content" class of bug this surface must avoid.
  const del = await leasesRoute.DELETE(
    req('/api/v1/admin/secrets/leases?id=database%2Fcreds%2Fdemo-readonly%2Fdef456', {
      method: 'DELETE',
    }),
  );
  assert.equal(del.status, 200);
  assert.equal(leaseIds.has('database/creds/demo-readonly/def456'), false);
  {
    const res = await leasesRoute.GET(
      req(`/api/v1/admin/secrets/leases?prefix=${encodeURIComponent('database/creds/demo-readonly/')}`),
    );
    const body = (await res.json()) as { leases: { id: string }[] };
    assert.deepEqual(body.leases.map((l) => l.id), ['database/creds/demo-readonly/abc123']);
  }

  // A malformed lease id is rejected before it ever reaches the vault (fails closed).
  const bad = await leasesRoute.DELETE(
    req('/api/v1/admin/secrets/leases?id=..%2Fetc', { method: 'DELETE' }),
  );
  assert.equal(bad.status, 400);
});
