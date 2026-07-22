import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createGreatExpectationsLifecycleAdapter } from '../src/lib/adapters/great-expectations-lifecycle.ts';

const context = { orgId: 'org_bharat', actor: 'admin@bharatunion.example' };
const expectation = { type: 'expect_column_values_to_not_be_null', kwargs: { column: 'pan' } };
const suite = {
  name: 'kyc',
  description: 'KYC quality',
  expectations: [expectation],
  version: 1,
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
};
const run = {
  id: 'run_1',
  suiteName: 'kyc',
  suiteVersion: 1,
  success: true,
  evaluated: 1,
  failed: 0,
  outcomes: [{ type: expectation.type, success: true, unexpectedCount: 0, detail: 'passed' }],
  startedAt: '2026-07-23T00:00:00.000Z',
  completedAt: '2026-07-23T00:00:01.000Z',
  engine: 'great-expectations',
  engineVersion: '1.8.0',
  dataSourceId: null,
  assetName: null,
};

async function startServer(
  options: { operations?: Record<string, boolean>; malformed?: boolean } = {},
) {
  const requests: Array<{
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: unknown;
  }> = [];
  const operations = options.operations ?? {
    profile: true,
    validate: true,
    'suite.list': true,
    'suite.read': true,
    'suite.create': true,
    'suite.update': true,
    'suite.delete': true,
    'history.list': true,
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const body = bodyText ? JSON.parse(bodyText) : null;
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/capabilities') {
        res.end(
          JSON.stringify({
            status: 'ok',
            engine: 'great-expectations',
            engineVersion: '1.8.0',
            operations,
          }),
        );
      } else if (options.malformed) {
        res.end(JSON.stringify({ unexpected: true }));
      } else if (req.method === 'POST' && req.url === '/v1/profiles') {
        res.end(
          JSON.stringify({
            dataSourceId: 'warehouse',
            assetName: 'customers',
            profiledAt: '2026-07-23T00:00:00.000Z',
            sampledRows: 2,
            columns: [
              {
                name: 'pan',
                inferredType: 'string',
                rowCount: 2,
                nullCount: 0,
                distinctCount: 2,
                min: null,
                max: null,
              },
            ],
          }),
        );
      } else if (req.method === 'GET' && req.url === '/v1/suites') {
        res.end(JSON.stringify({ suites: [suite] }));
      } else if (req.method === 'GET' && req.url === '/v1/suites/kyc') {
        res.end(JSON.stringify(suite));
      } else if (req.method === 'POST' && req.url === '/v1/suites') {
        res.statusCode = 201;
        res.end(JSON.stringify(suite));
      } else if (req.method === 'PATCH' && req.url === '/v1/suites/kyc') {
        res.end(JSON.stringify({ ...suite, version: 2 }));
      } else if (req.method === 'DELETE' && req.url === '/v1/suites/kyc?expectedVersion=2') {
        res.statusCode = 204;
        res.end();
      } else if (req.method === 'POST' && req.url === '/v1/validations') {
        res.statusCode = 201;
        res.end(JSON.stringify(run));
      } else if (req.method === 'GET' && req.url?.startsWith('/v1/validations?')) {
        res.end(JSON.stringify({ runs: [run], nextCursor: 'next_1' }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test('real HTTP adapter drives profile, suite CRUD, validation, and history with server-owned tenant auth', async () => {
  const remote = await startServer();
  const adapter = createGreatExpectationsLifecycleAdapter({
    baseUrl: remote.url,
    token: 'service-secret',
  });
  try {
    const manifest = await adapter.capabilities(context);
    assert.equal(manifest.engine, 'great-expectations');
    assert.equal(manifest.operations.profile, true);

    assert.equal(
      (
        await adapter.profile(context, {
          dataSourceId: 'warehouse',
          assetName: 'customers',
          sampleLimit: 100,
        })
      ).ok,
      true,
    );
    assert.equal((await adapter.listSuites(context)).ok, true);
    assert.equal((await adapter.getSuite(context, 'kyc')).ok, true);
    assert.equal(
      (
        await adapter.createSuite(context, {
          name: 'kyc',
          description: 'KYC quality',
          expectations: [expectation],
        })
      ).ok,
      true,
    );
    assert.equal(
      (await adapter.updateSuite(context, 'kyc', { expectedVersion: 1, description: 'tightened' }))
        .ok,
      true,
    );
    assert.equal((await adapter.deleteSuite(context, 'kyc', 2)).ok, true);
    assert.equal(
      (
        await adapter.runValidation(context, {
          suiteName: 'kyc',
          batch: { kind: 'inline', rows: [{ pan: 'ABCDE1234F' }] },
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await adapter.history(context, {
          suiteName: 'kyc',
          dataSourceId: 'warehouse',
          limit: 25,
          cursor: 'cursor_1',
        })
      ).ok,
      true,
    );

    const productRequests = remote.requests.filter((request) => request.url !== '/v1/capabilities');
    assert.equal(productRequests.length, 8);
    assert.equal(
      productRequests.every((request) => request.headers.authorization === 'Bearer service-secret'),
      true,
    );
    assert.equal(
      productRequests.every((request) => request.headers['x-offgrid-org-id'] === context.orgId),
      true,
    );
    assert.equal(
      productRequests.every((request) => request.headers['x-offgrid-actor'] === context.actor),
      true,
    );
    assert.match(productRequests.at(-1)?.url ?? '', /suiteName=kyc/);
    assert.doesNotMatch(JSON.stringify(productRequests), /other-org/);
  } finally {
    await remote.close();
  }
});

test('adapter does not call an operation the remote manifest did not advertise', async () => {
  const remote = await startServer({ operations: { profile: false } });
  const adapter = createGreatExpectationsLifecycleAdapter({
    baseUrl: remote.url,
    token: 'service-secret',
  });
  try {
    const result = await adapter.profile(context, {
      dataSourceId: 'warehouse',
      assetName: 'customers',
      sampleLimit: 100,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, 'unavailable');
    assert.deepEqual(
      remote.requests.map((request) => request.url),
      ['/v1/capabilities'],
    );
  } finally {
    await remote.close();
  }
});

test('adapter fails closed before network I/O when tenant or service auth is missing', async () => {
  const remote = await startServer();
  try {
    const noToken = createGreatExpectationsLifecycleAdapter({ baseUrl: remote.url, token: '' });
    assert.equal((await noToken.listSuites(context)).ok, false);
    const invalidTenant = createGreatExpectationsLifecycleAdapter({
      baseUrl: remote.url,
      token: 'service-secret',
    });
    assert.equal((await invalidTenant.listSuites({ orgId: '../escape', actor: '' })).ok, false);
    assert.equal(remote.requests.length, 0);
  } finally {
    await remote.close();
  }
});

test('adapter rejects malformed success payloads instead of trusting upstream', async () => {
  const remote = await startServer({ malformed: true });
  const adapter = createGreatExpectationsLifecycleAdapter({
    baseUrl: remote.url,
    token: 'service-secret',
  });
  try {
    const result = await adapter.getSuite(context, 'kyc');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, 'upstream');
      assert.equal(result.status, 502);
      assert.match(result.message, /malformed/);
    }
  } finally {
    await remote.close();
  }
});

test('adapter reports a provider outage as an upstream 502, not an unsupported capability', async () => {
  const remote = await startServer();
  const adapter = createGreatExpectationsLifecycleAdapter({
    baseUrl: remote.url,
    token: 'service-secret',
  });
  await remote.close();

  const result = await adapter.listSuites(context);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, 'upstream');
    assert.equal(result.status, 502);
    assert.match(result.message, /unreachable/);
  }
});
