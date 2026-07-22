import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const ORG = 'test-s3-object-route';
const FOREIGN_ORG = 'test-s3-object-route-foreign';
const TOKEN = 's3-route-admin';
const dbUp = await dbReachable();
const vault = new Map<string, string>();
const objects = new Map<string, { body: Buffer; contentType: string }>();
const s3Requests: string[] = [];
const vaultWrites: string[] = [];
let server: Server;
let baseUrl = '';

function xmlListing(): string {
  return `<ListBucketResult><IsTruncated>false</IsTruncated>
    <Contents><Key>approved/evidence.txt</Key><Size>8</Size><LastModified>2026-07-23T00:00:00Z</LastModified><ETag>"ok"</ETag></Contents>
    <Contents><Key>private/foreign.txt</Key><Size>7</Size><LastModified>2026-07-23T00:00:00Z</LastModified><ETag>"foreign"</ETag></Contents>
  </ListBucketResult>`;
}

function startBoundary(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://boundary');
      const vaultMatch = url.pathname.match(/^\/v1\/secret\/data\/(.+)$/);
      if (url.pathname === '/v1/sys/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ sealed: false }));
      }
      if (vaultMatch) {
        const key = decodeURIComponent(vaultMatch[1]);
        if (req.method === 'GET') {
          if (!vault.has(key)) {
            res.statusCode = 404;
            return res.end();
          }
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ data: { data: { value: vault.get(key) } } }));
        }
        if (req.method === 'POST') {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as {
            data?: { value?: string };
          };
          vault.set(key, body.data?.value ?? '');
          vaultWrites.push(key);
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ data: { version: 1 } }));
        }
        if (req.method === 'DELETE') {
          vault.delete(key);
          res.statusCode = 204;
          return res.end();
        }
      }

      if (!url.pathname.startsWith('/s3/')) {
        res.statusCode = 404;
        return res.end();
      }
      s3Requests.push(`${req.method} ${url.pathname}${url.search}`);
      assert.match(req.headers.authorization ?? '', /^AWS4-HMAC-SHA256 /);
      const path = decodeURIComponent(url.pathname.slice('/s3/claims-archive/'.length));
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        res.setHeader('content-type', 'application/xml');
        return res.end(xmlListing());
      }
      if (req.method === 'HEAD' && path === 'approved/too-large.bin') {
        res.setHeader('content-length', String(5 * 1024 * 1024 + 1));
        res.setHeader('content-type', 'application/octet-stream');
        return res.end();
      }
      const existing = objects.get(path);
      if (req.method === 'HEAD') {
        if (!existing) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('content-length', String(existing.body.length));
        res.setHeader('content-type', existing.contentType);
        res.setHeader('last-modified', 'Wed, 23 Jul 2026 00:00:00 GMT');
        return res.end();
      }
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        objects.set(path, {
          body: Buffer.concat(chunks),
          contentType: req.headers['content-type'] ?? 'application/octet-stream',
        });
        res.statusCode = 200;
        return res.end();
      }
      if (req.method === 'GET') {
        if (!existing) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('content-type', existing.contentType);
        return res.end(existing.body);
      }
      if (req.method === 'DELETE') {
        objects.delete(path);
        res.statusCode = 204;
        return res.end();
      }
      res.statusCode = 405;
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      process.env.OFFGRID_OPENBAO_URL = baseUrl;
      process.env.OFFGRID_OPENBAO_TOKEN = 'test-token';
      process.env.OFFGRID_ADMIN_TOKEN = TOKEN;
      process.env.OFFGRID_ORG = ORG;
      resolve();
    });
  });
}

before(async () => {
  if (dbUp) await startBoundary();
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://console.local${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
  });
}

test(
  'connector object route confines every operation to one tenant-approved prefix',
  {
    skip: dbUp ? false : SKIP_MESSAGE,
  },
  async (t) => {
    const { createConnector, deleteConnector } = await import('@/lib/store');
    const { createDomain, deleteDomain } = await import('@/lib/data-domains-store');
    const { persistConnectorSecret } = await import('@/lib/connector-secrets');
    const { serializeObjectStoreCredential } = await import('@/lib/connector-policy');
    const route = await import('@/app/api/v1/admin/connectors/[id]/objects/route');

    const connector = await createConnector({
      name: 'Claims archive',
      type: 's3',
      endpoint: `${baseUrl}/s3`,
      auth: 'api-key',
      description: 'Test S3 boundary',
      custom: true,
      orgId: ORG,
    });
    const foreignConnector = await createConnector({
      name: 'Foreign archive',
      type: 's3',
      endpoint: `${baseUrl}/s3`,
      auth: 'api-key',
      description: 'Foreign S3 boundary',
      custom: true,
      orgId: FOREIGN_ORG,
    });
    const domain = await createDomain(
      { label: 'Claim evidence', connectorId: connector.id, resource: 'claims-archive/approved' },
      ORG,
    );
    const foreignDomain = await createDomain(
      {
        label: 'Private contracts',
        connectorId: foreignConnector.id,
        resource: 'claims-archive/private',
      },
      FOREIGN_ORG,
    );
    await persistConnectorSecret(
      connector.id,
      serializeObjectStoreCredential({ accessKey: 'access', secretKey: 'secret' }),
    );
    await persistConnectorSecret(
      foreignConnector.id,
      serializeObjectStoreCredential({ accessKey: 'foreign', secretKey: 'foreign-secret' }),
    );
    t.after(async () => {
      await deleteDomain(domain.id, ORG);
      await deleteDomain(foreignDomain.id, FOREIGN_ORG);
      await deleteConnector(connector.id, ORG);
      await deleteConnector(foreignConnector.id, FOREIGN_ORG);
    });

    const beforeNegative = s3Requests.length;
    const wrongConnector = await route.GET(
      request(`/api/v1/admin/connectors/${foreignConnector.id}/objects?domain=${foreignDomain.id}`),
      { params: Promise.resolve({ id: foreignConnector.id }) },
    );
    assert.equal(wrongConnector.status, 404);
    const foreignBinding = await route.GET(
      request(`/api/v1/admin/connectors/${connector.id}/objects?domain=${foreignDomain.id}`),
      { params: Promise.resolve({ id: connector.id }) },
    );
    assert.equal(foreignBinding.status, 403);
    assert.equal(
      s3Requests.length,
      beforeNegative,
      'foreign org/binding rejection must not touch S3',
    );

    for (const [method, suffix] of [
      ['GET', `&prefix=../private`],
      ['GET', `&key=../private.txt`],
      ['POST', `&key=../private.txt`],
      ['DELETE', `&key=../private.txt`],
    ] as const) {
      const beforeEscape = s3Requests.length;
      const req = request(
        `/api/v1/admin/connectors/${connector.id}/objects?domain=${domain.id}${suffix}`,
        method === 'POST'
          ? { method, headers: { 'content-type': 'text/plain' }, body: 'no' }
          : { method },
      );
      const handler =
        method === 'POST' ? route.POST : method === 'DELETE' ? route.DELETE : route.GET;
      const response = await handler(req, { params: Promise.resolve({ id: connector.id }) });
      assert.equal(response.status, 400, `${method} ${suffix}`);
      assert.equal(s3Requests.length, beforeEscape, `${method} escape must not touch S3`);
    }

    const uploaded = await route.POST(
      request(
        `/api/v1/admin/connectors/${connector.id}/objects?domain=${domain.id}&key=evidence.txt`,
        {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: 'retained',
        },
      ),
      { params: Promise.resolve({ id: connector.id }) },
    );
    assert.equal(uploaded.status, 201);
    assert.equal(objects.get('approved/evidence.txt')?.body.toString(), 'retained');

    const deniedReplace = await route.POST(
      request(
        `/api/v1/admin/connectors/${connector.id}/objects?domain=${domain.id}&key=evidence.txt`,
        { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'accidental' },
      ),
      { params: Promise.resolve({ id: connector.id }) },
    );
    assert.equal(deniedReplace.status, 409);
    assert.equal(objects.get('approved/evidence.txt')?.body.toString(), 'retained');

    const replaced = await route.POST(
      request(
        `/api/v1/admin/connectors/${connector.id}/objects?domain=${domain.id}&key=evidence.txt&replace=1`,
        { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'replaced' },
      ),
      { params: Promise.resolve({ id: connector.id }) },
    );
    assert.equal(replaced.status, 201);
    assert.equal(objects.get('approved/evidence.txt')?.body.toString(), 'replaced');

    const listed = await route.GET(
      request(`/api/v1/admin/connectors/${connector.id}/objects?domain=${domain.id}`),
      { params: Promise.resolve({ id: connector.id }) },
    );
    assert.equal(listed.status, 200);
    const listBody = (await listed.json()) as { objects: Array<{ key: string }> };
    assert.deepEqual(
      listBody.objects.map((object) => object.key),
      ['evidence.txt'],
    );

    const downloaded = await route.GET(
      request(
        `/api/v1/admin/connectors/${connector.id}/objects?domain=${domain.id}&key=evidence.txt&download=1`,
      ),
      { params: Promise.resolve({ id: connector.id }) },
    );
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
    assert.match(downloaded.headers.get('content-disposition') ?? '', /^attachment;/);
    assert.equal(await downloaded.text(), 'replaced');

    const beforeLarge = s3Requests.length;
    const tooLarge = await route.GET(
      request(
        `/api/v1/admin/connectors/${connector.id}/objects?domain=${domain.id}&key=too-large.bin&download=1`,
      ),
      { params: Promise.resolve({ id: connector.id }) },
    );
    assert.equal(tooLarge.status, 413);
    assert.equal(
      s3Requests.length,
      beforeLarge + 1,
      'large download performs HEAD only, never GET',
    );
    assert.match(s3Requests.at(-1) ?? '', /^HEAD /);

    const deleted = await route.DELETE(
      request(
        `/api/v1/admin/connectors/${connector.id}/objects?domain=${domain.id}&key=evidence.txt`,
        { method: 'DELETE' },
      ),
      { params: Promise.resolve({ id: connector.id }) },
    );
    assert.equal(deleted.status, 200);
    assert.equal(objects.has('approved/evidence.txt'), false);
  },
);

test(
  'connector PATCH trusts the persisted type and scopes credential rotation before any vault write',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { createConnector, deleteConnector } = await import('@/lib/store');
    const { getConnector } = await import('@/lib/connector-detail');
    const { getConnectorSecretRef, persistConnectorSecret } = await import('@/lib/connector-secrets');
    const { parseObjectStoreCredential, serializeObjectStoreCredential } = await import('@/lib/connector-policy');
    const connectorRoute = await import('@/app/api/v1/admin/connectors/[id]/route');

    const ownedS3 = await createConnector({
      name: 'Owned object source', type: 's3', endpoint: `${baseUrl}/s3`, auth: 'api-key', custom: true, orgId: ORG,
    });
    const ownedRest = await createConnector({
      name: 'Owned API', type: 'rest', endpoint: 'https://api.example.com', auth: 'none', custom: true, orgId: ORG,
    });
    const foreignS3 = await createConnector({
      name: 'Foreign object source', type: 's3', endpoint: `${baseUrl}/foreign`, auth: 'api-key', custom: true, orgId: FOREIGN_ORG,
    });
    await persistConnectorSecret(
      ownedS3.id,
      serializeObjectStoreCredential({ accessKey: 'old-access', secretKey: 'old-secret' }),
    );
    await persistConnectorSecret(
      foreignS3.id,
      serializeObjectStoreCredential({ accessKey: 'foreign-access', secretKey: 'foreign-secret' }),
    );
    t.after(async () => {
      await deleteConnector(ownedS3.id, ORG);
      await deleteConnector(ownedRest.id, ORG);
      await deleteConnector(foreignS3.id, FOREIGN_ORG);
    });

    const rotated = await connectorRoute.PATCH(
      request(`/api/v1/admin/connectors/${ownedS3.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint: `${baseUrl}/s3`,
          accessKey: 'new-access',
          secretKey: 'new-secret',
        }),
      }),
      { params: Promise.resolve({ id: ownedS3.id }) },
    );
    assert.equal(rotated.status, 200, 'an S3 rotation does not require browser-supplied type');
    const ownedRef = await getConnectorSecretRef(ownedS3.id);
    assert.deepEqual(parseObjectStoreCredential(vault.get(ownedRef ?? '') ?? null), {
      accessKey: 'new-access',
      secretKey: 'new-secret',
    });

    const writesBeforeSpoofs = vaultWrites.length;
    const spoofS3 = await connectorRoute.PATCH(
      request(`/api/v1/admin/connectors/${ownedRest.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 's3', endpoint: `${baseUrl}/s3`, accessKey: 'stolen', secretKey: 'stolen',
        }),
      }),
      { params: Promise.resolve({ id: ownedRest.id }) },
    );
    assert.equal(spoofS3.status, 400);
    assert.equal((await getConnector(ownedRest.id, ORG))?.type, 'rest');

    const spoofRest = await connectorRoute.PATCH(
      request(`/api/v1/admin/connectors/${ownedS3.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'rest', endpoint: 'https://api.example.com' }),
      }),
      { params: Promise.resolve({ id: ownedS3.id }) },
    );
    assert.equal(spoofRest.status, 400);
    assert.equal((await getConnector(ownedS3.id, ORG))?.type, 's3');

    const foreignBefore = await getConnector(foreignS3.id, FOREIGN_ORG);
    const foreign = await connectorRoute.PATCH(
      request(`/api/v1/admin/connectors/${foreignS3.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint: `${baseUrl}/hijacked`, accessKey: 'hijacked', secretKey: 'hijacked',
        }),
      }),
      { params: Promise.resolve({ id: foreignS3.id }) },
    );
    assert.equal(foreign.status, 404);
    assert.deepEqual(await getConnector(foreignS3.id, FOREIGN_ORG), foreignBefore);
    assert.equal(vaultWrites.length, writesBeforeSpoofs, 'spoofed and foreign edits never touch the vault');
  },
);
