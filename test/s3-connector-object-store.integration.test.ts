import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createS3ObjectStore } from '@/lib/adapters/s3-object-store';

test('parameterized S3 port signs and performs a real list, put, get, and delete HTTP journey', async (t) => {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const methods: string[] = [];
  const server = createServer(async (req, res) => {
    methods.push(req.method ?? '');
    assert.match(req.headers.authorization ?? '', /^AWS4-HMAC-SHA256 /);
    const url = new URL(req.url ?? '/', 'http://boundary');
    const key = decodeURIComponent(url.pathname.replace(/^\/claims-archive\/?/, ''));
    if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      res.setHeader('content-type', 'application/xml');
      return res.end(
        `<ListBucketResult><IsTruncated>false</IsTruncated>${[...objects.entries()]
          .map(
            ([name, value]) =>
              `<Contents><Key>${name}</Key><Size>${value.body.length}</Size><LastModified>2026-07-23T00:00:00Z</LastModified><ETag>"etag"</ETag></Contents>`,
          )
          .join('')}</ListBucketResult>`,
      );
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(key, {
        body: Buffer.concat(chunks),
        type: req.headers['content-type'] ?? 'application/octet-stream',
      });
      res.statusCode = 200;
      return res.end();
    }
    if (req.method === 'GET') {
      const object = objects.get(key);
      if (!object) {
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader('content-type', object.type);
      return res.end(object.body);
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.statusCode = 204;
      return res.end();
    }
    res.statusCode = 405;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const store = createS3ObjectStore({
    endpoint: `http://127.0.0.1:${address.port}`,
    credential: async () => ({ kind: 's3', accessKey: 'access', secretKey: 'secret' }),
  });

  await store.putObject(
    'claims-archive',
    'settled/claim-12.txt',
    Buffer.from('retained'),
    'text/plain',
  );
  const listing = await store.listObjects('claims-archive', { prefix: 'settled/' });
  assert.deepEqual(
    listing.objects.map((object) => object.key),
    ['settled/claim-12.txt'],
  );
  assert.equal(
    (await store.getObject('claims-archive', 'settled/claim-12.txt'))?.bytes.toString(),
    'retained',
  );
  assert.equal(await store.deleteObject('claims-archive', 'settled/claim-12.txt'), true);
  assert.deepEqual(methods, ['PUT', 'GET', 'GET', 'DELETE']);
});

test('parameterized S3 port refuses credential-bearing and non-http endpoints', () => {
  assert.throws(
    () => createS3ObjectStore({ endpoint: 'ftp://object.example' }),
    /credential-free http/,
  );
  assert.throws(
    () => createS3ObjectStore({ endpoint: 'https://user:secret@object.example' }),
    /credential-free http/,
  );
  assert.throws(
    () => createS3ObjectStore({ endpoint: 'https://object.example?bucket=escape' }),
    /credential-free http/,
  );
});
