import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

// INTEGRATION: the Secrets Keys surface used to dead-end at a folder row ("connectors/ · namespace")
// with no way to see what was inside it — real secrets living one level deep (e.g.
// `org_suraksha/connectors/coreins`) were invisible on the page that exists to manage them. This
// drives the REAL route (src/app/api/v1/admin/secrets/route.ts GET) against a fake KV v2 vault that
// implements actual LIST semantics (children-of-prefix), so it proves the fix end-to-end: write
// nested keys through the real write path, list the root (folders only), drill into a folder via
// `?folder=`, and confirm the returned keys are still the SAME org-relative addresses the delete /
// version-history routes expect.

const TOKEN = 'secrets-folder-listing-admin';
const DEFAULT_ORG = 'default';

/** Immediate children of `prefix` among `keys` — KV v2 metadata LIST semantics: a name for a
 * further-nested key is truncated to its next segment and marked as a folder ("segment/"). */
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

test('the Secrets Keys route lists a folder\'s real children through ?folder=, not just its label', async (t) => {
  const vault = new Map<string, string>();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://vault');
    if (url.searchParams.get('list') === 'true') {
      const m = url.pathname.match(/^\/v1\/secret\/metadata(?:\/(.+))?$/);
      if (!m) {
        response.statusCode = 404;
        return response.end();
      }
      const prefix = m[1] ? `${decodeURIComponent(m[1])}/` : '';
      const keys = childrenOf(vault.keys(), prefix);
      response.setHeader('content-type', 'application/json');
      return response.end(JSON.stringify({ data: { keys } }));
    }
    const match = url.pathname.match(/^\/v1\/secret\/data\/(.+)$/);
    if (!match) {
      response.statusCode = 404;
      return response.end();
    }
    const key = decodeURIComponent(match[1]);
    if (request.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as {
        data?: { value?: string };
      };
      vault.set(key, body.data?.value ?? '');
      response.setHeader('content-type', 'application/json');
      return response.end(JSON.stringify({ data: { version: 1 } }));
    }
    if (request.method === 'DELETE') {
      vault.delete(key);
      response.statusCode = 204;
      return response.end();
    }
    response.statusCode = 405;
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
  process.env.AUTH_SECRET = 'test-secrets-folder-listing-auth';
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

  const secretsRoute = await import('@/app/api/v1/admin/secrets/route');

  function req(path: string, init?: RequestInit) {
    return new Request(`http://console.local${path}`, {
      ...init,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  }

  async function write(key: string, value: string) {
    const res = await secretsRoute.POST(
      req('/api/v1/admin/secrets', { method: 'POST', body: JSON.stringify({ key, value }) }),
    );
    assert.equal(res.status, 201, `write ${key} should succeed`);
  }

  await write('connectors/coreins', 'demo-value-1');
  await write('connectors/policyadmin', 'demo-value-2');
  await write('tools/cibil', 'demo-value-3');
  await write('root-secret', 'demo-value-4');

  // Root listing: two folders + one leaf — never the leaves buried inside those folders.
  const root = (await (await secretsRoute.GET(req('/api/v1/admin/secrets'))).json()) as {
    keys: { key: string; folder: boolean }[];
    folder: string;
  };
  assert.equal(root.folder, '');
  assert.deepEqual(
    root.keys.map((k) => k.key).sort(),
    ['connectors/', 'root-secret', 'tools/'].sort(),
  );
  assert.equal(
    root.keys.find((k) => k.key === 'connectors/')?.folder,
    true,
  );

  // Drilling into the folder reveals its real children, addressed by their FULL org-relative path —
  // the same path `delete`/version-history already expect — not a bare leaf name that would resolve
  // to the wrong key once handed back to those routes.
  const inside = (await (
    await secretsRoute.GET(req('/api/v1/admin/secrets?folder=connectors%2F'))
  ).json()) as { keys: { key: string; folder: boolean }[]; folder: string };
  assert.equal(inside.folder, 'connectors/');
  assert.deepEqual(
    inside.keys.map((k) => k.key).sort(),
    ['connectors/coreins', 'connectors/policyadmin'],
  );
  assert.ok(inside.keys.every((k) => k.folder === false));

  // A key returned from inside the folder deletes the SAME object a root-level caller would name —
  // proving the reconstructed path is not just cosmetic.
  const del = await secretsRoute.DELETE(
    req('/api/v1/admin/secrets?key=connectors%2Fcoreins', { method: 'DELETE' }),
  );
  assert.equal(del.status, 200);
  assert.equal(vault.has('connectors/coreins'), false);
  assert.equal(vault.has('connectors/policyadmin'), true);

  // A malformed folder (path traversal, missing trailing slash) is rejected, never forwarded to the
  // vault — the validation is the tenant-isolation boundary, so it must fail closed.
  const bad1 = await secretsRoute.GET(req('/api/v1/admin/secrets?folder=..%2F'));
  assert.equal(bad1.status, 400);
  const bad2 = await secretsRoute.GET(req('/api/v1/admin/secrets?folder=connectors'));
  assert.equal(bad2.status, 400);
});
