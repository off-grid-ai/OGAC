import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const ORG = 'test-kafka-source-onboarding';
const FOREIGN_ORG = 'test-kafka-source-onboarding-foreign';
const SHA = 'b'.repeat(64);
const TOKEN = 'kafka-source-onboarding-admin';
const dbUp = await dbReachable();

function sourceInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Enterprise risk signals',
    description: 'Approved risk events for governed apps.',
    bootstrapEndpoint: '127.0.0.1:19092',
    schemaRegistryEndpoint: 'http://127.0.0.1:18083',
    topic: 'enterprise.risk-signals',
    schemaSubject: 'enterprise.risk-signals-value',
    schemaVersion: 4,
    schemaId: 29,
    schemaSha256: SHA,
    tenantField: 'orgId',
    tls: false,
    sasl: 'plain',
    username: 'reader',
    password: 'vault-only-password',
    registryAuth: 'bearer',
    registryToken: 'registry-only-token',
    ...overrides,
  };
}

test(
  'creates, reads, rotates, compensates, and deletes the real governed Kafka owners',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const vault = new Map<string, string>();
    let failNextWrite = false;
    let failNextDelete = false;
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://vault');
      const match = url.pathname.match(/^\/v1\/secret\/data\/(.+)$/);
      if (!match) {
        response.statusCode = 404;
        return response.end();
      }
      const key = decodeURIComponent(match[1]);
      if (request.method === 'POST') {
        if (failNextWrite) {
          failNextWrite = false;
          response.statusCode = 503;
          return response.end();
        }
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
        if (failNextDelete) {
          failNextDelete = false;
          response.statusCode = 503;
          return response.end();
        }
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
    const previousUrl = process.env.OFFGRID_OPENBAO_URL;
    const previousToken = process.env.OFFGRID_OPENBAO_TOKEN;
    const previousAdminToken = process.env.OFFGRID_ADMIN_TOKEN;
    const previousOrg = process.env.OFFGRID_ORG;
    const previousAuthSecret = process.env.AUTH_SECRET;
    process.env.OFFGRID_OPENBAO_URL = `http://127.0.0.1:${port}`;
    process.env.OFFGRID_OPENBAO_TOKEN = 'test-token';
    process.env.OFFGRID_ADMIN_TOKEN = TOKEN;
    process.env.OFFGRID_ORG = ORG;
    process.env.AUTH_SECRET = 'test-kafka-source-onboarding-auth-secret';
    t.after(() => {
      if (previousUrl === undefined) delete process.env.OFFGRID_OPENBAO_URL;
      else process.env.OFFGRID_OPENBAO_URL = previousUrl;
      if (previousToken === undefined) delete process.env.OFFGRID_OPENBAO_TOKEN;
      else process.env.OFFGRID_OPENBAO_TOKEN = previousToken;
      if (previousAdminToken === undefined) delete process.env.OFFGRID_ADMIN_TOKEN;
      else process.env.OFFGRID_ADMIN_TOKEN = previousAdminToken;
      if (previousOrg === undefined) delete process.env.OFFGRID_ORG;
      else process.env.OFFGRID_ORG = previousOrg;
      if (previousAuthSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previousAuthSecret;
    });

    const { listConnectors, deleteConnector } = await import('@/lib/store');
    const { listDomains, deleteDomain } = await import('@/lib/data-domains-store');
    const { connectorSecretKey } = await import('@/lib/connector-secrets');
    const { createKafkaSource, getKafkaSource, updateKafkaSource, KafkaSourceOnboardingError } =
      await import('@/lib/adapters/kafka-source-onboarding');
    const collectionRoute = await import('@/app/api/v1/admin/kafka-sources/route');
    const sourceRoute = await import('@/app/api/v1/admin/kafka-sources/[id]/route');
    const genericConnectorRoute = await import('@/app/api/v1/admin/connectors/[id]/route');

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

    async function clean(orgId: string) {
      for (const domain of await listDomains(orgId)) await deleteDomain(domain.id, orgId);
      for (const connector of await listConnectors(orgId)) {
        await deleteConnector(connector.id, orgId);
      }
    }
    await clean(ORG);
    await clean(FOREIGN_ORG);
    t.after(async () => {
      await clean(ORG);
      await clean(FOREIGN_ORG);
    });

    const createResponse = await collectionRoute.POST(
      request('/api/v1/admin/kafka-sources', {
        method: 'POST',
        body: JSON.stringify(sourceInput()),
      }),
    );
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()) as Awaited<ReturnType<typeof createKafkaSource>>;
    assert.equal(created.name, 'Enterprise risk signals');
    assert.equal(created.bootstrapEndpoint, 'kafka://127.0.0.1:19092');
    assert.equal(created.topic, 'enterprise.risk-signals');
    assert.deepEqual(created.security, {
      tls: false,
      sasl: 'plain',
      hasSaslCredentials: true,
      registryAuth: 'bearer',
      hasRegistryCredential: true,
    });
    assert.equal(JSON.stringify(created).includes('vault-only-password'), false);
    assert.equal(JSON.stringify(created).includes('registry-only-token'), false);

    const getResponse = await sourceRoute.GET(
      request(`/api/v1/admin/kafka-sources/${created.connectorId}`),
      { params: Promise.resolve({ id: created.connectorId }) },
    );
    assert.equal(getResponse.status, 200);
    const responseText = await getResponse.text();
    assert.equal(responseText.includes('vault-only-password'), false);
    assert.equal(responseText.includes('registry-only-token'), false);

    const connectors = await listConnectors(ORG);
    const domains = await listDomains(ORG);
    assert.equal(connectors.length, 1);
    assert.equal(domains.length, 1);
    assert.equal(domains[0].connectorId, created.connectorId);
    assert.equal(domains[0].resource, 'enterprise.risk-signals');
    const key = connectorSecretKey(created.connectorId, ORG);
    assert.deepEqual(JSON.parse(vault.get(key)!), {
      version: 1,
      tls: false,
      sasl: 'plain',
      username: 'reader',
      password: 'vault-only-password',
      schemaRegistryAuthorization: 'Bearer registry-only-token',
    });

    await assert.rejects(
      getKafkaSource(created.connectorId, FOREIGN_ORG),
      (error: unknown) =>
        error instanceof KafkaSourceOnboardingError && error.code === 'unknown-source',
    );

    const preserved = await updateKafkaSource(
      created.connectorId,
      sourceInput({
        name: 'Enterprise operating signals',
        topic: 'enterprise.operating-signals',
        username: '',
        password: '',
        registryToken: '',
      }),
      ORG,
    );
    assert.equal(preserved.name, 'Enterprise operating signals');
    assert.equal(preserved.topic, 'enterprise.operating-signals');
    assert.match(vault.get(key)!, /vault-only-password/);

    for (const handler of [genericConnectorRoute.PATCH, genericConnectorRoute.DELETE]) {
      const response = await handler(
        request(`/api/v1/admin/connectors/${created.connectorId}`, {
          method: handler === genericConnectorRoute.PATCH ? 'PATCH' : 'DELETE',
          ...(handler === genericConnectorRoute.PATCH
            ? { body: JSON.stringify({ name: 'Bypass' }) }
            : {}),
        }),
        { params: Promise.resolve({ id: created.connectorId }) },
      );
      assert.equal(response.status, 409, 'generic Kafka mutation is refused');
    }

    const beforeUnsupported = (await listConnectors(ORG)).length;
    const unsupported = await collectionRoute.POST(
      request('/api/v1/admin/kafka-sources', {
        method: 'POST',
        body: JSON.stringify({ ...sourceInput(), consumerGroup: 'caller-owned' }),
      }),
    );
    assert.equal(unsupported.status, 400);
    assert.equal((await listConnectors(ORG)).length, beforeUnsupported);

    const beforeFailedUpdate = await getKafkaSource(created.connectorId, ORG);
    const beforeFailedSecret = vault.get(key);
    failNextWrite = true;
    await assert.rejects(
      updateKafkaSource(
        created.connectorId,
        sourceInput({
          name: 'Must roll back',
          topic: 'enterprise.must-roll-back',
          username: 'next-reader',
          password: 'next-password',
          registryToken: 'next-token',
        }),
        ORG,
      ),
      (error: unknown) =>
        error instanceof KafkaSourceOnboardingError && error.code === 'source-unavailable',
    );
    assert.deepEqual(await getKafkaSource(created.connectorId, ORG), beforeFailedUpdate);
    assert.equal(vault.get(key), beforeFailedSecret);

    failNextWrite = true;
    await assert.rejects(createKafkaSource(sourceInput({ name: 'No partial source' }), ORG));
    assert.equal((await listConnectors(ORG)).length, 1);
    assert.equal((await listDomains(ORG)).length, 1);

    failNextDelete = true;
    const refusedDelete = await sourceRoute.DELETE(
      request(`/api/v1/admin/kafka-sources/${created.connectorId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: created.connectorId }) },
    );
    assert.equal(refusedDelete.status, 502);
    assert.equal((await listConnectors(ORG)).length, 1);
    assert.equal((await listDomains(ORG)).length, 1);
    assert.equal(vault.has(key), true);

    const deleteResponse = await sourceRoute.DELETE(
      request(`/api/v1/admin/kafka-sources/${created.connectorId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: created.connectorId }) },
    );
    assert.equal(deleteResponse.status, 200);
    assert.equal((await listConnectors(ORG)).length, 0);
    assert.equal((await listDomains(ORG)).length, 0);
    assert.equal(vault.has(key), false);
  },
);
