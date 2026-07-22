import assert from 'node:assert/strict';
import test from 'node:test';

const TOKEN = 'organizational-brain-route-test';

function request(path: string, method = 'GET', body?: unknown, authenticated = true): Request {
  return new Request(`http://console.local/api/v1/organizational-brain${path}`, {
    method,
    headers: {
      ...(authenticated ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function response(value: unknown, status = 200): Response {
  return new Response(value === undefined ? undefined : JSON.stringify(value), { status });
}

const documentSets = [
  {
    id: 1,
    name: 'ogac:bank-one:policies',
    description: 'Policies',
    cc_pair_descriptors: [
      {
        id: 10,
        name: 'CRM',
        connector: { id: 20, name: 'CRM', source: 'salesforce' },
        credential: { id: 7 },
      },
    ],
    is_public: true,
    users: [],
    groups: [],
    federated_connectors: [],
  },
];

test('real organizational-brain routes enforce auth, tenant scope, validation, errors, and lifecycle semantics', async () => {
  const previous = {
    token: process.env.OFFGRID_ADMIN_TOKEN,
    secret: process.env.AUTH_SECRET,
    org: process.env.OFFGRID_ORG,
    policy: process.env.OFFGRID_ORGANIZATIONAL_BRAIN_ACCESS_POLICY,
    url: process.env.ONYX_API_URL,
    onyxToken: process.env.ONYX_API_TOKEN,
    fetch: globalThis.fetch,
  };
  process.env.OFFGRID_ADMIN_TOKEN = TOKEN;
  process.env.AUTH_SECRET = 'organizational-brain-route-secret-32-characters';
  process.env.OFFGRID_ORG = 'bank-one';
  process.env.ONYX_API_URL = 'http://onyx.internal/api';
  process.env.ONYX_API_TOKEN = 'private-onyx-pat';
  const configuredPolicy = JSON.stringify([
    {
      tenantId: 'bank-one',
      roles: ['admin'],
      documentSetSlugs: ['policies'],
      capabilities: ['retrieve', 'ingest', 'manageSources'],
      ingestionConnectionId: 42,
      sourceBindings: [
        {
          id: 'salesforce-main',
          sourceType: 'salesforce',
          providerCredentialId: 7,
          allowedProviderConfigKeys: ['objects'],
        },
      ],
    },
  ]);
  process.env.OFFGRID_ORGANIZATIONAL_BRAIN_ACCESS_POLICY = configuredPolicy;

  let mode: 'normal' | 'provider-error' = 'normal';
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ path, method, body });
    if (mode === 'provider-error' && path === '/api/search') return response({ detail: 'down' }, 503);
    if (path === '/api/search') return response({ results: [] });
    if (path === '/api/onyx-api/ingestion' && method === 'POST') {
      return response({ document_id: 'ogac:bank-one:policy-1', already_existed: false });
    }
    if (path.startsWith('/api/onyx-api/ingestion/') && method === 'DELETE') return response(undefined);
    if (path === '/api/manage/document-set' && method === 'GET') return response(documentSets);
    if (path === '/api/manage/admin/connector/indexing-status') {
      return response([
        {
          source: 'salesforce',
          indexing_statuses: [
            {
              cc_pair_id: 10,
              cc_pair_status: 'ACTIVE',
              docs_indexed: 5,
              in_progress: false,
              in_repeated_error_state: false,
            },
          ],
        },
      ]);
    }
    if (path === '/api/manage/admin/connector' && method === 'POST') return response({ id: 30 });
    if (path === '/api/manage/connector/30/credential/7' && method === 'PUT') {
      return response({ success: true, data: 31 });
    }
    if (path === '/api/manage/admin/document-set' && method === 'PATCH') return response(undefined);
    if (path === '/api/manage/admin/cc-pair/10/status' && method === 'PUT') return response({ message: '200' });
    if (path === '/api/manage/admin/connector/run-once' && method === 'POST') return response({ success: true });
    if (path === '/api/manage/admin/deletion-attempt' && method === 'POST') return response(undefined);
    return response({ detail: `${method} ${path} missing` }, 500);
  }) as typeof fetch;

  try {
    const { POST: search } = await import('../src/app/api/v1/organizational-brain/search/route.ts');
    const { POST: ingest } = await import('../src/app/api/v1/organizational-brain/documents/route.ts');
    const { DELETE: deleteDocument } = await import(
      '../src/app/api/v1/organizational-brain/documents/[documentId]/route.ts'
    );
    const { GET: listSources, POST: createSource } = await import(
      '../src/app/api/v1/organizational-brain/sources/route.ts'
    );
    const { DELETE: deleteSource } = await import(
      '../src/app/api/v1/organizational-brain/sources/[sourceId]/route.ts'
    );
    const { POST: syncSource } = await import(
      '../src/app/api/v1/organizational-brain/sources/[sourceId]/sync/route.ts'
    );
    const { PUT: setState } = await import(
      '../src/app/api/v1/organizational-brain/sources/connections/[connectionId]/state/route.ts'
    );

    const unauthorized = await search(request('/search', 'POST', { query: 'policy' }, false));
    assert.equal(unauthorized.status, 401);
    assert.equal(calls.length, 0, 'authentication rejects before provider I/O');

    const callerScope = await search(
      request('/search', 'POST', { query: 'policy', document_sets: ['ogac:bank-two:secrets'] }),
    );
    assert.equal(callerScope.status, 400);
    assert.equal(calls.length, 0, 'validation rejects caller-provided scope before provider I/O');

    process.env.OFFGRID_ORGANIZATIONAL_BRAIN_ACCESS_POLICY = '[{}]';
    const invalidPolicy = await search(request('/search', 'POST', { query: 'policy' }));
    assert.equal(invalidPolicy.status, 503);
    assert.equal(calls.length, 0, 'invalid server policy fails closed before provider I/O');
    process.env.OFFGRID_ORGANIZATIONAL_BRAIN_ACCESS_POLICY = configuredPolicy;

    const searched = await search(request('/search', 'POST', { query: 'policy' }));
    assert.equal(searched.status, 200);
    assert.deepEqual(calls.at(-1)?.body?.document_sets, ['ogac:bank-one:policies']);

    mode = 'provider-error';
    assert.equal((await search(request('/search', 'POST', { query: 'policy' }))).status, 502);
    mode = 'normal';

    const document = {
      id: 'policy-1',
      title: 'Policy',
      semanticIdentifier: 'Policy v1',
      sections: [{ text: 'Policy text.' }],
      sourceType: 'policy',
      sourceUri: 'https://policies.example/1',
      version: '1',
      checksum: 'a'.repeat(64),
      updatedAt: '2026-07-23T00:00:00Z',
    };
    assert.equal((await ingest(request('/documents', 'POST', document))).status, 201);
    assert.equal(
      (
        await deleteDocument(request('/documents/policy-1', 'DELETE'), {
          params: Promise.resolve({ documentId: 'policy-1' }),
        })
      ).status,
      204,
    );

    const listed = await listSources(request('/sources'));
    assert.equal(listed.status, 200);
    assert.equal(((await listed.json()) as { sources: unknown[] }).sources.length, 1);
    assert.equal(
      (
        await createSource(
          request('/sources', 'POST', {
            name: 'CRM new',
            inputType: 'poll',
            providerConfig: { objects: ['Account'] },
            connectionBindingId: 'salesforce-main',
            documentSetSlug: 'policies',
          }),
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await setState(request('/sources/connections/10/state', 'PUT', { state: 'paused' }), {
          params: Promise.resolve({ connectionId: '10' }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await syncSource(request('/sources/20/sync', 'POST', { fromBeginning: true }), {
          params: Promise.resolve({ sourceId: '20' }),
        })
      ).status,
      202,
    );
    assert.equal(
      (
        await deleteSource(request('/sources/20', 'DELETE'), {
          params: Promise.resolve({ sourceId: '20' }),
        })
      ).status,
      202,
    );
    const writesBeforeForeign = calls.filter((call) => call.method !== 'GET').length;
    const foreign = await deleteSource(request('/sources/99', 'DELETE'), {
      params: Promise.resolve({ sourceId: '99' }),
    });
    assert.equal(foreign.status, 404);
    assert.equal(calls.filter((call) => call.method !== 'GET').length, writesBeforeForeign);
  } finally {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('OFFGRID_ADMIN_TOKEN', previous.token);
    restore('AUTH_SECRET', previous.secret);
    restore('OFFGRID_ORG', previous.org);
    restore('OFFGRID_ORGANIZATIONAL_BRAIN_ACCESS_POLICY', previous.policy);
    restore('ONYX_API_URL', previous.url);
    restore('ONYX_API_TOKEN', previous.onyxToken);
    globalThis.fetch = previous.fetch;
  }
});
