import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createS3ObjectStore } from '../src/lib/adapters/s3-object-store.ts';
import { queryBoundS3ObjectSource } from '../src/lib/adapters/s3-object-query.ts';
import type { ConnectorObjectBinding } from '../src/lib/adapters/s3-connector-binding.ts';

interface FixtureObject {
  body: Buffer;
  contentType: string;
  headSize?: number;
  headContentType?: string;
  omitEtag?: boolean;
}

test('governed object query signs real S3 HTTP and returns bounded content with full provenance', async (t) => {
  const objects = new Map<string, FixtureObject>([
    ['approved/case-1.json', { body: Buffer.from('{"case":1}'), contentType: 'application/json' }],
    ['approved/notes.txt', { body: Buffer.from('retained note'), contentType: 'text/plain' }],
    [
      'approved/drift.json',
      { body: Buffer.from('{"drift":true}'), contentType: 'application/json', headSize: 5 },
    ],
    ['approved/etag-drift.txt', { body: Buffer.from('same-size'), contentType: 'text/plain' }],
    ['approved/bad.json', { body: Buffer.from('not-json'), contentType: 'application/json' }],
    ['approved/binary.pdf', { body: Buffer.from('%PDF'), contentType: 'application/pdf' }],
    [
      'approved/no-etag.txt',
      { body: Buffer.from('unversioned'), contentType: 'text/plain', omitEtag: true },
    ],
    [
      'approved/large.txt',
      { body: Buffer.from('not downloaded'), contentType: 'text/plain', headSize: 512 * 1024 + 1 },
    ],
    ...[1, 2, 3].map(
      (number) =>
        [
          `approved/aggregate/${number}.txt`,
          { body: Buffer.alloc(400 * 1024, String(number)), contentType: 'text/plain' },
        ] as const,
    ),
  ]);
  const requests: string[] = [];
  const headCounts = new Map<string, number>();
  let maliciousListing = false;
  let missingListing = false;
  const server = createServer((req, res) => {
    assert.match(req.headers.authorization ?? '', /^AWS4-HMAC-SHA256 /);
    const url = new URL(req.url ?? '/', 'http://boundary');
    requests.push(`${req.method} ${url.pathname}${url.search}`);
    if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const selected = [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .slice(0, 20);
      res.setHeader('content-type', 'application/xml');
      return res.end(
        `<ListBucketResult><IsTruncated>false</IsTruncated>${selected
          .map(
            ([key, object]) =>
              `<Contents><Key>${key}</Key><Size>${object.body.length}</Size><LastModified>2026-07-23T00:00:00Z</LastModified><ETag>etag-${key}</ETag></Contents>`,
          )
          .join(
            '',
          )}${maliciousListing ? '<Contents><Key>private/escape.txt</Key><Size>1</Size><LastModified>2026-07-23T00:00:00Z</LastModified><ETag>bad</ETag></Contents>' : ''}${missingListing ? '<Contents><Key>approved/partial/missing.txt</Key><Size>4</Size><LastModified>2026-07-23T00:00:00Z</LastModified><ETag>missing</ETag></Contents>' : ''}</ListBucketResult>`,
      );
    }
    const key = decodeURIComponent(url.pathname.replace(/^\/claims-archive\//, ''));
    const object = objects.get(key);
    if (!object) {
      res.statusCode = 404;
      return res.end();
    }
    if (req.method === 'HEAD') {
      const headCount = (headCounts.get(key) ?? 0) + 1;
      headCounts.set(key, headCount);
      res.setHeader('content-length', String(object.headSize ?? object.body.length));
      res.setHeader('content-type', object.headContentType ?? object.contentType);
      res.setHeader('last-modified', 'Wed, 23 Jul 2026 00:00:00 GMT');
      if (!object.omitEtag) {
        res.setHeader(
          'etag',
          key === 'approved/etag-drift.txt' && headCount > 1 ? 'etag-replaced' : `etag-${key}`,
        );
      }
      return res.end();
    }
    if (req.method === 'GET') {
      res.setHeader('content-type', object.contentType);
      return res.end(object.body);
    }
    res.statusCode = 405;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const binding: ConnectorObjectBinding = {
    connector: { id: 'con_s3', name: 'Claims archive' },
    scope: {
      connectorId: 'con_s3',
      domainId: 'dom_claims',
      domainLabel: 'Claim evidence',
      bucket: 'claims-archive',
      prefix: 'approved/',
    },
    store: createS3ObjectStore({
      endpoint: `http://127.0.0.1:${address.port}`,
      credential: async () => ({ kind: 's3', accessKey: 'access', secretKey: 'secret' }),
    }),
  };

  const one = await queryBoundS3ObjectSource(binding, { params: { key: 'case-1.json' } });
  assert.equal(one.ok, true);
  if (one.ok) {
    const row = one.result.rows[0] as {
      key: string;
      content: string;
      provenance: { key: string; etag: string; sha256: string };
    };
    assert.equal(row.key, 'case-1.json');
    assert.equal(row.content, '{"case":1}');
    assert.equal(row.provenance.key, 'approved/case-1.json');
    assert.equal(row.provenance.etag, 'etag-approved/case-1.json');
    assert.equal(row.provenance.sha256.length, 64);
  }

  requests.length = 0;
  const count = await queryBoundS3ObjectSource(binding, { op: 'count', limit: 2 });
  assert.equal(count.ok, true);
  assert.deepEqual(
    requests.map((request) => request.split(' ', 1)[0]),
    ['GET'],
  );

  requests.length = 0;
  const escape = await queryBoundS3ObjectSource(binding, { params: { key: '../private.txt' } });
  assert.equal(escape.ok, false);
  assert.deepEqual(requests, [], 'scope denial must happen before S3');

  requests.length = 0;
  maliciousListing = true;
  const mixed = await queryBoundS3ObjectSource(binding, { limit: 20 });
  assert.equal(mixed.ok, false);
  if (!mixed.ok) assert.equal(mixed.error.code, 'scope-denied');
  assert.equal(requests.length, 1, 'mixed listing must fail before HEAD/GET');
  maliciousListing = false;

  requests.length = 0;
  const large = await queryBoundS3ObjectSource(binding, { params: { key: 'large.txt' } });
  assert.equal(large.ok, false);
  if (!large.ok) assert.equal(large.error.code, 'object-too-large');
  assert.deepEqual(
    requests.map((request) => request.split(' ', 1)[0]),
    ['HEAD'],
  );

  requests.length = 0;
  const unsupported = await queryBoundS3ObjectSource(binding, {
    params: { key: 'binary.pdf' },
  });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.error.code, 'content-denied');
  assert.deepEqual(
    requests.map((request) => request.split(' ', 1)[0]),
    ['HEAD'],
  );

  requests.length = 0;
  const noEtag = await queryBoundS3ObjectSource(binding, { params: { key: 'no-etag.txt' } });
  assert.equal(noEtag.ok, false);
  if (!noEtag.ok) assert.equal(noEtag.error.code, 'source-changed');
  assert.deepEqual(
    requests.map((request) => request.split(' ', 1)[0]),
    ['HEAD'],
  );

  requests.length = 0;
  const malformed = await queryBoundS3ObjectSource(binding, { params: { key: 'bad.json' } });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.error.code, 'content-denied');
  assert.deepEqual(
    requests.map((request) => request.split(' ', 1)[0]),
    ['HEAD', 'GET', 'HEAD'],
  );

  requests.length = 0;
  const aggregate = await queryBoundS3ObjectSource(binding, { params: { prefix: 'aggregate' } });
  assert.equal(aggregate.ok, false);
  if (!aggregate.ok) assert.equal(aggregate.error.code, 'aggregate-too-large');
  assert.deepEqual(
    requests.map((request) => request.split(' ', 1)[0]),
    ['GET', 'HEAD', 'HEAD', 'HEAD'],
    'aggregate rejection must happen before any object body is downloaded',
  );

  requests.length = 0;
  missingListing = true;
  const partial = await queryBoundS3ObjectSource(binding, { params: { prefix: 'partial' } });
  assert.equal(partial.ok, false);
  if (!partial.ok) assert.equal(partial.error.code, 'source-unavailable');
  assert.deepEqual(
    requests.map((request) => request.split(' ', 1)[0]),
    ['GET', 'HEAD'],
    'partial metadata failure must discard the entire result before any body is downloaded',
  );
  missingListing = false;

  requests.length = 0;
  const drift = await queryBoundS3ObjectSource(binding, { params: { key: 'drift.json' } });
  assert.equal(drift.ok, false);
  if (!drift.ok) assert.equal(drift.error.code, 'source-changed');
  assert.deepEqual(
    requests.map((request) => request.split(' ', 1)[0]),
    ['HEAD', 'GET', 'HEAD'],
  );

  requests.length = 0;
  const etagDrift = await queryBoundS3ObjectSource(binding, { params: { key: 'etag-drift.txt' } });
  assert.equal(etagDrift.ok, false);
  if (!etagDrift.ok) assert.equal(etagDrift.error.code, 'source-changed');
  assert.deepEqual(
    requests.map((request) => request.split(' ', 1)[0]),
    ['HEAD', 'GET', 'HEAD'],
  );
});
