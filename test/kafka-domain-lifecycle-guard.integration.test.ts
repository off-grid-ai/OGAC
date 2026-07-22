import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const ORG = 'test-kafka-domain-lifecycle-guard';
const FOREIGN_ORG = 'test-kafka-domain-lifecycle-guard-foreign';
const TOKEN = 'kafka-domain-lifecycle-admin';
const SHA = 'c'.repeat(64);
const dbUp = await dbReachable();

function sourceInput(name: string) {
  return {
    name,
    description: 'Approved enterprise events.',
    bootstrapEndpoint: '127.0.0.1:19092',
    schemaRegistryEndpoint: 'http://127.0.0.1:18083',
    topic: 'enterprise.lifecycle-events',
    schemaSubject: 'enterprise.lifecycle-events-value',
    schemaVersion: 1,
    schemaId: 12,
    schemaSha256: SHA,
    tenantField: 'orgId',
    tls: false,
    sasl: 'none',
    registryAuth: 'none',
  };
}

test(
  'generic DataDomain routes cannot bypass a governed Kafka source lifecycle',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const vault = new Map<string, string>();
    const server = createServer(async (request, response) => {
      const match = new URL(request.url ?? '/', 'http://vault').pathname.match(
        /^\/v1\/secret\/data\/(.+)$/,
      );
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
      if (request.method === 'GET') {
        const value = vault.get(key);
        if (value === undefined) {
          response.statusCode = 404;
          return response.end();
        }
        response.setHeader('content-type', 'application/json');
        return response.end(JSON.stringify({ data: { data: { value } } }));
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
    process.env.OFFGRID_ORG = ORG;
    process.env.AUTH_SECRET = 'test-kafka-domain-lifecycle-auth-secret';
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

    const { createKafkaSource } = await import('@/lib/adapters/kafka-source-onboarding');
    const { createConnector, deleteConnector, listConnectors, listIngestJobs, updateConnector } =
      await import('@/lib/store');
    const { createDomain, deleteDomain, getDomain, listDomains, updateDomain } =
      await import('@/lib/data-domains-store');
    const collectionRoute = await import('@/app/api/v1/admin/data-domains/route');
    const detailRoute = await import('@/app/api/v1/admin/data-domains/[id]/route');
    const syncRoute = await import('@/app/api/v1/admin/connectors/[id]/sync/route');
    const { getConnector } = await import('@/lib/connector-detail');

    async function clean(orgId: string) {
      for (const domain of await listDomains(orgId)) await deleteDomain(domain.id, orgId);
      for (const connector of await listConnectors(orgId))
        await deleteConnector(connector.id, orgId);
    }
    await clean(ORG);
    await clean(FOREIGN_ORG);
    t.after(async () => {
      await clean(ORG);
      await clean(FOREIGN_ORG);
    });

    function request(path: string, init?: RequestInit) {
      return new Request(`http://console.local${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          ...(init?.headers ?? {}),
        },
      });
    }

    const governed = await createKafkaSource(sourceInput('Governed operating signals'), ORG);
    const foreign = await createKafkaSource(sourceInput('Foreign operating signals'), FOREIGN_ORG);
    const createBypass = await collectionRoute.POST(
      request('/api/v1/admin/data-domains', {
        method: 'POST',
        body: JSON.stringify({
          label: 'Attacker topic',
          connectorId: governed.connectorId,
          resource: 'attacker.topic',
          opHints: { kafka: { callerPolicy: true } },
        }),
      }),
    );
    assert.equal(createBypass.status, 409);
    assert.equal((await createBypass.json()).manageAt, '/api/v1/admin/kafka-sources');
    assert.equal(
      (await listDomains(ORG)).filter((domain) => domain.connectorId === governed.connectorId)
        .length,
      1,
    );

    const missingDomainOwner = await createKafkaSource(sourceInput('Missing domain owner'), ORG);
    await deleteDomain(missingDomainOwner.domainId, ORG);
    const recreateBypass = await collectionRoute.POST(
      request('/api/v1/admin/data-domains', {
        method: 'POST',
        body: JSON.stringify({
          label: 'Attacker replacement domain',
          connectorId: missingDomainOwner.connectorId,
          resource: 'attacker.replacement-topic',
        }),
      }),
    );
    assert.equal(recreateBypass.status, 409);
    assert.equal((await recreateBypass.json()).manageAt, '/api/v1/admin/kafka-sources');
    assert.equal(
      (await listDomains(ORG)).filter(
        (domain) => domain.connectorId === missingDomainOwner.connectorId,
      ).length,
      0,
    );

    // Ownership is the immutable lifecycle marker, not runtime validity. Even a source whose
    // endpoint and domain hints are damaged must be repaired through the governed Kafka lifecycle.
    await updateConnector(governed.connectorId, { endpoint: 'malformed-endpoint' }, ORG);
    await updateDomain(governed.domainId, { opHints: { malformed: true } }, ORG);
    const governedDomainBefore = await getDomain(governed.domainId, ORG);

    const patchBypass = await detailRoute.PATCH(
      request(`/api/v1/admin/data-domains/${governed.domainId}`, {
        method: 'PATCH',
        body: JSON.stringify({ resource: 'attacker.replacement', opHints: null }),
      }),
      { params: Promise.resolve({ id: governed.domainId }) },
    );
    assert.equal(patchBypass.status, 409);
    assert.deepEqual(await getDomain(governed.domainId, ORG), governedDomainBefore);

    const deleteBypass = await detailRoute.DELETE(
      request(`/api/v1/admin/data-domains/${governed.domainId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: governed.domainId }) },
    );
    assert.equal(deleteBypass.status, 409);
    assert.ok(await getDomain(governed.domainId, ORG));

    const foreignCreate = await collectionRoute.POST(
      request('/api/v1/admin/data-domains', {
        method: 'POST',
        body: JSON.stringify({
          label: 'Foreign source escape',
          connectorId: foreign.connectorId,
          resource: 'enterprise.foreign',
        }),
      }),
    );
    assert.equal(foreignCreate.status, 404);
    const foreignPatch = await detailRoute.PATCH(
      request(`/api/v1/admin/data-domains/${governed.domainId}`, {
        method: 'PATCH',
        body: JSON.stringify({ connectorId: foreign.connectorId }),
      }),
      { params: Promise.resolve({ id: governed.domainId }) },
    );
    assert.equal(foreignPatch.status, 409, 'current governed owner wins before target inspection');
    const foreignDelete = await detailRoute.DELETE(
      request(`/api/v1/admin/data-domains/${foreign.domainId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: foreign.domainId }) },
    );
    assert.equal(foreignDelete.status, 404);

    const rest = await createConnector({
      name: 'Customer API',
      type: 'rest',
      endpoint: 'https://example.test/customers',
      orgId: ORG,
    });
    const normalCreate = await collectionRoute.POST(
      request('/api/v1/admin/data-domains', {
        method: 'POST',
        body: JSON.stringify({
          label: 'Customer records',
          connectorId: rest.id,
          resource: 'customers',
        }),
      }),
    );
    assert.equal(normalCreate.status, 201);
    const normalDomain = (await normalCreate.json()) as { id: string };
    const normalPatch = await detailRoute.PATCH(
      request(`/api/v1/admin/data-domains/${normalDomain.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resource: 'customers-active' }),
      }),
      { params: Promise.resolve({ id: normalDomain.id }) },
    );
    assert.equal(normalPatch.status, 200);
    const foreignTargetPatch = await detailRoute.PATCH(
      request(`/api/v1/admin/data-domains/${normalDomain.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ connectorId: foreign.connectorId }),
      }),
      { params: Promise.resolve({ id: normalDomain.id }) },
    );
    assert.equal(foreignTargetPatch.status, 404);
    assert.equal((await getDomain(normalDomain.id, ORG))?.resource, 'customers-active');
    const normalDelete = await detailRoute.DELETE(
      request(`/api/v1/admin/data-domains/${normalDomain.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: normalDomain.id }) },
    );
    assert.equal(normalDelete.status, 200);

    const governedBeforeSync = await getConnector(governed.connectorId, ORG);
    const governedSync = await syncRoute.POST(
      request(`/api/v1/admin/connectors/${governed.connectorId}/sync`, { method: 'POST' }),
      { params: Promise.resolve({ id: governed.connectorId }) },
    );
    assert.equal(governedSync.status, 409);
    assert.equal((await governedSync.json()).manageAt, '/api/v1/admin/kafka-sources');
    assert.deepEqual(await getConnector(governed.connectorId, ORG), governedBeforeSync);
    assert.ok(
      !(await listIngestJobs(ORG)).some((job) => job.connectorId === governed.connectorId),
      'generic sync did not create history for the governed Kafka source',
    );

    const foreignBeforeSync = await getConnector(foreign.connectorId, FOREIGN_ORG);
    const foreignSync = await syncRoute.POST(
      request(`/api/v1/admin/connectors/${foreign.connectorId}/sync`, { method: 'POST' }),
      { params: Promise.resolve({ id: foreign.connectorId }) },
    );
    assert.equal(foreignSync.status, 404);
    assert.deepEqual(await getConnector(foreign.connectorId, FOREIGN_ORG), foreignBeforeSync);
    assert.ok(
      !(await listIngestJobs(FOREIGN_ORG)).some((job) => job.connectorId === foreign.connectorId),
      "generic sync did not create another tenant's history",
    );

    const restBeforeSync = await getConnector(rest.id, ORG);
    const restSync = await syncRoute.POST(
      request(`/api/v1/admin/connectors/${rest.id}/sync`, { method: 'POST' }),
      { params: Promise.resolve({ id: rest.id }) },
    );
    assert.equal(restSync.status, 202);
    assert.equal((await restSync.json()).connectorId, rest.id);
    const restAfterSync = await getConnector(rest.id, ORG);
    assert.equal(restBeforeSync?.lastSync, null);
    assert.ok(restAfterSync?.lastSync, 'normal REST sync stamps its connector');
    assert.ok(
      (await listIngestJobs(ORG)).some((job) => job.connectorId === rest.id),
      'normal REST sync records its ingest history',
    );

    const metadataKafka = await createConnector({
      name: 'Kafka metadata fixture',
      type: 'kafka',
      endpoint: 'kafka://metadata.internal:9092',
      orgId: ORG,
    });
    const metadataCreate = await collectionRoute.POST(
      request('/api/v1/admin/data-domains', {
        method: 'POST',
        body: JSON.stringify({
          label: 'Metadata-only topic',
          connectorId: metadataKafka.id,
          resource: 'metadata.topic',
        }),
      }),
    );
    assert.equal(metadataCreate.status, 201);
    const metadataDomain = (await metadataCreate.json()) as { id: string };
    assert.equal(
      (
        await detailRoute.PATCH(
          request(`/api/v1/admin/data-domains/${metadataDomain.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ resource: 'metadata.topic.v2' }),
          }),
          { params: Promise.resolve({ id: metadataDomain.id }) },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await detailRoute.DELETE(
          request(`/api/v1/admin/data-domains/${metadataDomain.id}`, { method: 'DELETE' }),
          { params: Promise.resolve({ id: metadataDomain.id }) },
        )
      ).status,
      200,
    );
  },
);
