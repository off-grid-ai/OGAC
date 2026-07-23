import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapOnyxSourceState,
  OnyxOrganizationalBrain,
  OnyxOrganizationalBrainError,
} from '../src/lib/adapters/onyx-organizational-brain.ts';
import {
  BrainAuthorizationError,
  resolveBrainAuthorization,
  type BrainDocument,
} from '../src/lib/organizational-brain/contracts.ts';
import { buildBrainProvenanceUri } from '../src/lib/organizational-brain/provenance.ts';

type Call = { url: string; method: string; body?: unknown };

function json(value: unknown, status = 200): Response {
  return new Response(value === undefined ? undefined : JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function boundary(handler: (call: Call) => Response | Promise<Response>): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { calls, fetch: fetchImpl as typeof fetch };
}

const policy = [
  {
    tenantId: 'bank-one',
    roles: ['brain-manager'],
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
  {
    tenantId: 'bank-one',
    roles: ['brain-reader'],
    documentSetSlugs: ['policies'],
    capabilities: ['retrieve'],
  },
] as const;

const manager = resolveBrainAuthorization(
  { tenantId: 'bank-one', subjectId: 'manager@bank.example', role: 'brain-manager' },
  policy,
);
const reader = resolveBrainAuthorization(
  { tenantId: 'bank-one', subjectId: 'reader@bank.example', role: 'brain-reader' },
  policy,
);

function adapter(fetchImpl: typeof fetch): OnyxOrganizationalBrain {
  return new OnyxOrganizationalBrain({
    apiBaseUrl: 'http://onyx.internal/api',
    apiToken: 'private-onyx-pat',
    fetchImpl,
    timeoutMs: 1_000,
  });
}

const document: BrainDocument = {
  id: 'policy/kyc-7',
  title: 'KYC policy',
  semanticIdentifier: 'KYC policy v7',
  sections: [{ heading: 'Verification', text: 'Verify identity before account activation.' }],
  sourceType: 'policy-system',
  sourceUri: 'https://policies.bank.example/kyc/7',
  version: '7',
  checksum: 'b'.repeat(64),
  updatedAt: '2026-07-23T00:00:00.000Z',
  metadata: { classification: 'internal' },
};

test('scoped search always sends server-issued document sets and distinguishes trusted provenance', async () => {
  const trusted = buildBrainProvenanceUri(manager, document);
  const fake = boundary((call) => {
    assert.equal(call.url, 'http://onyx.internal/api/search');
    assert.deepEqual(call.body, {
      query: 'What is the KYC policy?',
      document_sets: ['ogac:bank-one:policies'],
      skip_query_expansion: false,
    });
    return json({
      results: [
        {
          citation_id: 1,
          title: 'KYC policy',
          content: 'Verify identity.',
          link: trusted,
          source_type: 'ingestion_api',
          updated_at: '2026-07-23T00:00:00Z',
        },
        {
          citation_id: 2,
          title: 'Native Salesforce account',
          content: 'Account summary.',
          link: 'https://salesforce.example/account/1',
          source_type: 'salesforce',
          updated_at: null,
        },
      ],
    });
  });

  const result = await adapter(fake.fetch).search(manager, { query: 'What is the KYC policy?' });

  assert.deepEqual(result.citations[0], {
    citationId: 1,
    documentId: 'policy/kyc-7',
    title: 'KYC policy',
    excerpt: 'Verify identity.',
    sourceType: 'ingestion_api',
    providerLink: trusted,
    provenanceUri: trusted,
    version: '7',
    checksum: 'b'.repeat(64),
    updatedAt: '2026-07-23T00:00:00Z',
  });
  assert.equal(result.citations[1]?.provenanceUri, undefined);
  assert.equal(result.citations[1]?.checksum, undefined);
  assert.equal(result.citations[1]?.providerLink, 'https://salesforce.example/account/1');
});

test('ingestion uses the policy connection, namespaces the provider id, and returns original provenance separately', async () => {
  const fake = boundary((call) => {
    if (call.method === 'DELETE') return json(undefined);
    const body = call.body as Record<string, unknown>;
    assert.equal(call.url, 'http://onyx.internal/api/onyx-api/ingestion');
    assert.equal(body.cc_pair_id, 42);
    const ingested = body.document as Record<string, unknown>;
    assert.equal(ingested.id, 'ogac:bank-one:policy/kyc-7');
    assert.equal(ingested.source, 'ingestion_api');
    assert.deepEqual(ingested.metadata, {
      classification: 'internal',
      ogac_tenant_id: 'bank-one',
      ogac_source_type: 'policy-system',
      ogac_version: '7',
      ogac_checksum: 'b'.repeat(64),
      ogac_original_source_uri: 'https://policies.bank.example/kyc/7',
    });
    return json({ document_id: 'ogac:bank-one:policy/kyc-7', already_existed: false });
  });
  const brain = adapter(fake.fetch);

  const receipt = await brain.upsertDocument(manager, document);
  await brain.deleteDocument(manager, document.id);

  assert.equal(receipt.id, document.id);
  assert.equal(receipt.created, true);
  assert.equal(receipt.originalSourceUri, document.sourceUri);
  assert.match(receipt.provenanceUri, /^offgrid:\/\/organizational-brain\/bank-one\/documents\//);
  assert.equal(
    fake.calls[1]?.url,
    'http://onyx.internal/api/onyx-api/ingestion/ogac%3Abank-one%3Apolicy%2Fkyc-7',
  );
});

test('retrieval-only grants fail every ingestion and source-management operation before Onyx network I/O', async () => {
  const fake = boundary(() => json({ detail: 'must not be reached' }, 500));
  const brain = adapter(fake.fetch);
  const sourceInput = {
    name: 'CRM',
    inputType: 'poll' as const,
    providerConfig: { objects: ['Account'] },
    connectionBindingId: 'salesforce-main',
    documentSetSlug: 'policies',
  };

  await assert.rejects(() => brain.upsertDocument(reader, document), BrainAuthorizationError);
  await assert.rejects(() => brain.deleteDocument(reader, document.id), BrainAuthorizationError);
  await assert.rejects(() => brain.listSources(reader), BrainAuthorizationError);
  await assert.rejects(() => brain.createSource(reader, sourceInput), BrainAuthorizationError);
  await assert.rejects(() => brain.setSourceState(reader, '10', 'paused'), BrainAuthorizationError);
  await assert.rejects(() => brain.triggerSourceSync(reader, '20'), BrainAuthorizationError);
  await assert.rejects(() => brain.deleteSource(reader, '20'), BrainAuthorizationError);
  assert.equal(fake.calls.length, 0);
});

function documentSets(): unknown[] {
  const summary = (connectionId: number, tenant: string) => ({
    id: connectionId,
    name: `ogac:${tenant}:CRM`,
    source: 'salesforce',
    access_type: 'public',
  });
  return [
    {
      id: 1,
      name: 'ogac:bank-one:policies',
      description: 'Policies',
      cc_pair_summaries: [summary(10, 'bank-one')],
      is_up_to_date: true,
      is_public: false,
      users: [],
      groups: [],
      federated_connector_summaries: [],
    },
    {
      id: 2,
      name: 'ogac:bank-two:secrets',
      description: 'Foreign',
      cc_pair_summaries: [summary(11, 'bank-two')],
      is_up_to_date: true,
      is_public: true,
      users: [],
      groups: [],
      federated_connector_summaries: [],
    },
  ];
}

test('source lifecycle filters foreign connections and uses exact Onyx v4.4.1 management contracts', async () => {
  const fake = boundary((call) => {
    const path = new URL(call.url).pathname;
    if (call.method === 'GET' && path === '/api/manage/document-set') return json(documentSets());
    if (call.method === 'GET' && path === '/api/manage/admin/cc-pair/10') {
      return json({
        id: 10,
        name: 'ogac:bank-one:CRM',
        connector: { id: 20, name: 'ogac:bank-one:CRM', source: 'salesforce' },
        credential: { id: 7 },
      });
    }
    if (call.method === 'POST' && path === '/api/manage/admin/connector/indexing-status') {
      return json([
        {
          source: 'salesforce',
          indexing_statuses: [
            {
              cc_pair_id: 10,
              cc_pair_status: 'ACTIVE',
              docs_indexed: 12,
              in_progress: false,
              in_repeated_error_state: false,
              last_status: 'success',
              last_success: '2026-07-23T00:00:00Z',
            },
            { cc_pair_id: 11, cc_pair_status: 'ACTIVE', docs_indexed: 999 },
          ],
        },
      ]);
    }
    if (call.method === 'POST' && path === '/api/manage/admin/connector') return json({ id: 30 });
    if (call.method === 'PUT' && path === '/api/manage/connector/30/credential/7') {
      return json({ success: true, data: 31 });
    }
    if (call.method === 'PATCH' && path === '/api/manage/admin/document-set') return json(undefined);
    if (call.method === 'PUT' && path === '/api/manage/admin/cc-pair/10/status') return json({ message: '200' });
    if (call.method === 'POST' && path === '/api/manage/admin/connector/run-once') return json({ success: true });
    if (call.method === 'POST' && path === '/api/manage/admin/deletion-attempt') return json(undefined);
    return json({ detail: `${call.method} ${path} not implemented by fake` }, 500);
  });
  const brain = adapter(fake.fetch);

  const listed = await brain.listSources(manager);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.connectionId, '10');
  assert.equal(listed[0]?.documentCount, 12);
  assert.equal(listed[0]?.connectionConfigured, true);
  assert.equal('credentialReference' in (listed[0] ?? {}), false);
  assert.equal(
    fake.calls.some((call) => call.url.endsWith('/manage/admin/cc-pair/11')),
    false,
    'foreign document-set connections are never hydrated',
  );

  const created = await brain.createSource(manager, {
    name: 'CRM new',
    inputType: 'poll',
    providerConfig: { objects: ['Account', 'Opportunity'] },
    connectionBindingId: 'salesforce-main',
    documentSetSlug: 'policies',
    refreshSeconds: 300,
    pruneSeconds: 3600,
  });
  assert.deepEqual(created, {
    id: '30',
    connectionId: '31',
    name: 'CRM new',
    sourceType: 'salesforce',
    state: 'scheduled',
    documentCount: 0,
    syncInProgress: false,
    repeatedError: false,
    connectionConfigured: true,
  });
  const connectorCreate = fake.calls.find((call) => call.url.endsWith('/manage/admin/connector'));
  assert.deepEqual(connectorCreate?.body, {
    name: 'ogac:bank-one:CRM new',
    source: 'salesforce',
    input_type: 'poll',
    connector_specific_config: { objects: ['Account', 'Opportunity'] },
    refresh_freq: 300,
    prune_freq: 3600,
    access_type: 'public',
    groups: [],
  });
  const documentSetPatch = fake.calls.find((call) => call.method === 'PATCH');
  assert.deepEqual(documentSetPatch?.body, {
    id: 1,
    name: 'ogac:bank-one:policies',
    description: 'Policies',
    cc_pair_ids: [10, 31],
    is_public: false,
    users: [],
    groups: [],
    federated_connectors: [],
  });

  await brain.setSourceState(manager, '10', 'paused');
  await brain.triggerSourceSync(manager, '20', true);
  await brain.deleteSource(manager, '20');
  assert.deepEqual(
    fake.calls.find((call) => call.url.endsWith('/connector/run-once'))?.body,
    { connector_id: 20, credential_ids: [7], from_beginning: true },
  );
  assert.deepEqual(
    fake.calls.find((call) => call.url.endsWith('/deletion-attempt'))?.body,
    { connector_id: 20, credential_id: 7 },
  );
});

test('source creation makes an absent governed tenant document set private', async () => {
  const fake = boundary((call) => {
    const path = new URL(call.url).pathname;
    if (call.method === 'POST' && path === '/api/manage/admin/connector') return json({ id: 30 });
    if (call.method === 'PUT' && path === '/api/manage/connector/30/credential/7') {
      return json({ success: true, data: 31 });
    }
    if (call.method === 'GET' && path === '/api/manage/document-set') return json([]);
    if (call.method === 'POST' && path === '/api/manage/admin/document-set') return json(undefined);
    return json({ detail: `${call.method} ${path} not implemented by fake` }, 500);
  });

  await adapter(fake.fetch).createSource(manager, {
    name: 'CRM new',
    inputType: 'poll',
    providerConfig: { objects: ['Account'] },
    connectionBindingId: 'salesforce-main',
    documentSetSlug: 'policies',
  });

  assert.deepEqual(
    fake.calls.find(
      (call) => call.method === 'POST' && call.url.endsWith('/manage/admin/document-set'),
    )?.body,
    {
      name: 'ogac:bank-one:policies',
      description: 'OGAC governed source set for bank-one',
      cc_pair_ids: [31],
      is_public: false,
      users: [],
      groups: [],
      federated_connectors: [],
    },
  );
});

test('document-set parsing rejects the obsolete full-model shape instead of silently widening compatibility', async () => {
  const fake = boundary((call) => {
    if (call.url.endsWith('/manage/document-set')) {
      return json([
        {
          id: 1,
          name: 'ogac:bank-one:policies',
          description: 'Policies',
          cc_pair_descriptors: [],
          is_public: true,
          users: [],
          groups: [],
          federated_connectors: [],
        },
      ]);
    }
    return json({ detail: 'must not be reached' }, 500);
  });

  await assert.rejects(() => adapter(fake.fetch).listSources(manager), /connection summaries/);
  assert.equal(fake.calls.length, 1);
});

test('source-specific configuration rejects secrets and unknown fields before network', async () => {
  const fake = boundary(() => json({ detail: 'must not be reached' }, 500));
  const brain = adapter(fake.fetch);
  await assert.rejects(
    () =>
      brain.createSource(manager, {
        name: 'CRM',
        inputType: 'poll',
        providerConfig: { api_token: 'secret' },
        connectionBindingId: 'salesforce-main',
        documentSetSlug: 'policies',
      }),
    BrainAuthorizationError,
  );
  await assert.rejects(
    () =>
      brain.createSource(manager, {
        name: 'CRM',
        inputType: 'poll',
        providerConfig: { unexpected: true },
        connectionBindingId: 'salesforce-main',
        documentSetSlug: 'policies',
      }),
    BrainAuthorizationError,
  );
  assert.equal(fake.calls.length, 0);
});

test('Onyx source status mapping covers v4.4.1 lifecycle values and provider aliases', () => {
  assert.deepEqual(
    [
      'INDEXED',
      'ACTIVE',
      'SCHEDULED',
      'INDEXING',
      'INITIAL_INDEXING',
      'PAUSED',
      'DELETING',
      'ERROR',
      'INVALID',
      'REPEATED_ERROR',
      'unknown',
      null,
    ].map(mapOnyxSourceState),
    ['active', 'active', 'scheduled', 'indexing', 'indexing', 'paused', 'deleting', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid'],
  );
});

test('nested source config mutation cannot alter the already-resolved Onyx request payload', async () => {
  let releaseRequest: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const fake = boundary(async (call) => {
    await blocked;
    if (call.url.endsWith('/manage/admin/connector')) return json({ id: 30 });
    return json({ detail: 'stop after inspecting create payload' }, 500);
  });
  const objects = [{ name: 'Account' }];
  const create = adapter(fake.fetch).createSource(manager, {
    name: 'CRM',
    inputType: 'poll',
    providerConfig: { objects },
    connectionBindingId: 'salesforce-main',
    documentSetSlug: 'policies',
  });
  objects[0]!.name = 'Mutated';
  objects.push({ name: 'Opportunity' });
  releaseRequest?.();
  await assert.rejects(() => create);

  assert.deepEqual(
    ((fake.calls[0]?.body as Record<string, unknown>).connector_specific_config as Record<string, unknown>).objects,
    [{ name: 'Account' }],
  );
});

test('invalid and oversized ingestion is rejected before Onyx network I/O', async () => {
  const fake = boundary(() => json({ detail: 'must not be reached' }, 500));
  await assert.rejects(
    () => adapter(fake.fetch).upsertDocument(manager, { ...document, id: 'x'.repeat(513) }),
    /document id/,
  );
  assert.equal(fake.calls.length, 0);
});

test('source creation preserves the original failure when rollback succeeds', async () => {
  const fake = boundary((call) => {
    const path = new URL(call.url).pathname;
    if (call.method === 'POST' && path === '/api/manage/admin/connector') return json({ id: 30 });
    if (call.method === 'PUT' && path === '/api/manage/connector/30/credential/7') {
      return json({ detail: 'association rejected' }, 400);
    }
    if (call.method === 'DELETE' && path === '/api/manage/admin/connector/30') return json({ success: true });
    return json({ detail: 'unexpected' }, 500);
  });

  await assert.rejects(
    () =>
      adapter(fake.fetch).createSource(manager, {
        name: 'CRM',
        inputType: 'poll',
        providerConfig: { objects: ['Account'] },
        connectionBindingId: 'salesforce-main',
        documentSetSlug: 'policies',
      }),
    (error: unknown) => error instanceof OnyxOrganizationalBrainError && error.status === 400,
  );
  assert.equal(fake.calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/connector/30')), true);
});

test('source creation reports the orphan ids when compensating cleanup also fails', async () => {
  const fake = boundary((call) => {
    const path = new URL(call.url).pathname;
    if (call.method === 'POST' && path === '/api/manage/admin/connector') return json({ id: 30 });
    if (call.method === 'PUT' && path === '/api/manage/connector/30/credential/7') {
      return json({ success: true, data: 31 });
    }
    if (call.method === 'GET' && path === '/api/manage/document-set') return json(documentSets());
    if (call.method === 'PATCH' && path === '/api/manage/admin/document-set') {
      return json({ detail: 'document set update failed' }, 500);
    }
    if (call.method === 'DELETE') return json({ detail: 'cleanup failed' }, 500);
    return json({ detail: 'unexpected' }, 500);
  });

  await assert.rejects(
    () =>
      adapter(fake.fetch).createSource(manager, {
        name: 'CRM',
        inputType: 'poll',
        providerConfig: { objects: ['Account'] },
        connectionBindingId: 'salesforce-main',
        documentSetSlug: 'policies',
      }),
    (error: unknown) => {
      assert.ok(error instanceof OnyxOrganizationalBrainError);
      assert.match(error.message, /connector 30 cleanup also failed/);
      assert.deepEqual(error.detail, {
        creation: 'Onyx request failed with 500',
        cleanup: 'association cleanup: Onyx request failed with 500; connector cleanup: Onyx request failed with 500',
        orphanConnectorId: 30,
        orphanConnectionId: 31,
      });
      return true;
    },
  );
});

test('adapter bounds timeout and malformed provider responses', async () => {
  const abortingFetch = ((_input: URL | RequestInfo, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })) as typeof fetch;
  const timed = new OnyxOrganizationalBrain({
    apiBaseUrl: 'http://onyx.internal/api',
    apiToken: 'private-onyx-pat',
    fetchImpl: abortingFetch,
    timeoutMs: 5,
  });
  await assert.rejects(() => timed.search(manager, { query: 'policy' }), /timed out/);

  const malformed = boundary(() => new Response('{not-json', { status: 200 }));
  await assert.rejects(() => adapter(malformed.fetch).search(manager, { query: 'policy' }), /malformed JSON/);
});

test('foreign source mutation returns not found after a scoped read and performs no write', async () => {
  const fake = boundary((call) => {
    if (call.method === 'GET' && call.url.endsWith('/manage/document-set')) return json(documentSets());
    if (call.method === 'GET' && call.url.endsWith('/manage/admin/cc-pair/10')) {
      return json({
        id: 10,
        name: 'ogac:bank-one:CRM',
        connector: { id: 20, name: 'ogac:bank-one:CRM', source: 'salesforce' },
        credential: { id: 7 },
      });
    }
    return json({ detail: 'write must not be reached' }, 500);
  });

  await assert.rejects(
    () => adapter(fake.fetch).deleteSource(manager, '21'),
    (error: unknown) => error instanceof OnyxOrganizationalBrainError && error.status === 404,
  );
  assert.deepEqual(fake.calls.map((call) => call.method), ['GET', 'GET']);
});

test('constructor and delete boundary reject unsafe timeout and document ids before network', async () => {
  const fake = boundary(() => json({ detail: 'must not be reached' }, 500));
  for (const timeoutMs of [0, -1, 300_001, Number.POSITIVE_INFINITY, 1.5]) {
    assert.throws(
      () =>
        new OnyxOrganizationalBrain({
          apiBaseUrl: 'http://onyx.internal/api',
          apiToken: 'private-onyx-pat',
          fetchImpl: fake.fetch,
          timeoutMs,
        }),
      /timeout/,
    );
  }
  await assert.rejects(() => adapter(fake.fetch).deleteDocument(manager, 'unsafe\u0000id'), /document id/);
  await assert.rejects(() => adapter(fake.fetch).deleteDocument(manager, 'x'.repeat(513)), /document id/);
  assert.equal(fake.calls.length, 0);
});
