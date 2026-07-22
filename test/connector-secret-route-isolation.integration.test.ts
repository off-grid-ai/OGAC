import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const DEFAULT_ORG = 'default';
const VICTIM_ORG = 'test-connector-secret-route-victim';
const LIFECYCLE_ORG = 'test-connector-secret-route-lifecycle';
const TOKEN = 'connector-secret-route-admin';
const SCHEMA_SHA = createHash('sha256').update('{"type":"object"}').digest('hex');
const dbUp = await dbReachable();

function kafkaInput(name: string) {
  return {
    name,
    description: 'Approved enterprise events.',
    bootstrapEndpoint: '127.0.0.1:19092',
    schemaRegistryEndpoint: 'http://127.0.0.1:18083',
    topic: `enterprise.${name.toLowerCase().replaceAll(' ', '-')}`,
    schemaSubject: 'enterprise.events-value',
    schemaVersion: 1,
    schemaId: 12,
    schemaSha256: SCHEMA_SHA,
    tenantField: 'orgId',
    tls: false,
    sasl: 'none' as const,
    registryAuth: 'none' as const,
  };
}

test(
  'generic Secrets APIs cannot mutate connector-owned credentials across lifecycle or tenant boundaries',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const vault = new Map<string, string>();
    const vaultMutations: string[] = [];
    const server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://vault').pathname;
      const match = path.match(/^\/v1\/secret\/(?:data|metadata)\/(.+)$/);
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
        vaultMutations.push(`set:${key}`);
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
        vaultMutations.push(`delete:${key}`);
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
    process.env.AUTH_SECRET = 'test-connector-secret-route-auth';
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

    const {
      ConnectorSecretScopeError,
      LEGACY_CONNECTOR_SECRET_REMEDIATION,
      connectorSecretKey,
      persistConnectorSecret,
      resolveConnectorSecret,
    } = await import('@/lib/connector-secrets');
    const { connectorSecretRelativeKey } = await import('@/lib/connector-secret-policy');
    const { createKafkaSource, deleteKafkaSource, getKafkaSource } =
      await import('@/lib/adapters/kafka-source-onboarding');
    const { resolveConnectorTarget, testConnection } = await import('@/lib/connector-exec');
    const { serializeObjectStoreCredential } = await import('@/lib/connector-policy');
    const { createConnector, deleteConnector, listConnectors } = await import('@/lib/store');
    const { deleteDomain, listDomains } = await import('@/lib/data-domains-store');
    const { db } = await import('@/db');
    const { connectors } = await import('@/db/schema');
    const { and, eq } = await import('drizzle-orm');
    const secretsRoute = await import('@/app/api/v1/admin/secrets/route');
    const versionsRoute = await import('@/app/api/v1/admin/secrets/versions/route');

    async function clean(orgId: string) {
      for (const domain of await listDomains(orgId)) await deleteDomain(domain.id, orgId);
      for (const connector of await listConnectors(orgId)) {
        await deleteConnector(connector.id, orgId);
      }
    }
    await clean(VICTIM_ORG);
    await clean(LIFECYCLE_ORG);
    const defaultConnectorIds: string[] = [];
    t.after(async () => {
      for (const domain of await listDomains(DEFAULT_ORG)) {
        if (defaultConnectorIds.includes(domain.connectorId))
          await deleteDomain(domain.id, DEFAULT_ORG);
      }
      for (const id of defaultConnectorIds) await deleteConnector(id, DEFAULT_ORG);
      await clean(VICTIM_ORG);
      await clean(LIFECYCLE_ORG);
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

    async function expectReserved(response: Response) {
      assert.equal(response.status, 409);
      const body = (await response.json()) as { error?: string; manageAt?: string };
      assert.match(body.error ?? '', /managed from their data source/i);
      assert.equal(body.manageAt, '/data/sources');
    }

    const owned = await createKafkaSource(kafkaInput('Default governed signals'), DEFAULT_ORG);
    defaultConnectorIds.push(owned.connectorId);
    const victim = await createKafkaSource(kafkaInput('Victim governed signals'), VICTIM_ORG);
    const ownedKey = connectorSecretKey(owned.connectorId, DEFAULT_ORG);
    const victimKey = connectorSecretKey(victim.connectorId, VICTIM_ORG);
    const ownedSecretBefore = vault.get(ownedKey);
    const victimSecretBefore = vault.get(victimKey);
    assert.ok(ownedSecretBefore);
    assert.ok(victimSecretBefore);
    const mutationsBeforeAttacks = vaultMutations.length;

    await expectReserved(
      await secretsRoute.POST(
        request('/api/v1/admin/secrets', {
          method: 'POST',
          body: JSON.stringify({ key: ownedKey, value: 'same-tenant-overwrite' }),
        }),
      ),
    );
    await expectReserved(
      await secretsRoute.DELETE(
        request(`/api/v1/admin/secrets?key=${encodeURIComponent(ownedKey)}`, {
          method: 'DELETE',
        }),
      ),
    );
    await expectReserved(
      await versionsRoute.POST(
        request('/api/v1/admin/secrets/versions', {
          method: 'POST',
          body: JSON.stringify({ key: ownedKey, action: 'destroy', versions: [1] }),
        }),
      ),
    );
    await expectReserved(
      await versionsRoute.GET(
        request(`/api/v1/admin/secrets/versions?key=${encodeURIComponent(ownedKey)}`),
      ),
    );

    await expectReserved(
      await secretsRoute.POST(
        request('/api/v1/admin/secrets', {
          method: 'POST',
          body: JSON.stringify({ key: victimKey, value: 'foreign-overwrite' }),
        }),
      ),
    );
    await expectReserved(
      await secretsRoute.DELETE(
        request(`/api/v1/admin/secrets?key=${encodeURIComponent(victimKey)}`, {
          method: 'DELETE',
        }),
      ),
    );
    await expectReserved(
      await versionsRoute.POST(
        request('/api/v1/admin/secrets/versions', {
          method: 'POST',
          body: JSON.stringify({ key: victimKey, action: 'destroy', versions: [1] }),
        }),
      ),
    );

    assert.equal(vaultMutations.length, mutationsBeforeAttacks, 'attacks never reached OpenBao');
    assert.equal(vault.get(ownedKey), ownedSecretBefore);
    assert.equal(vault.get(victimKey), victimSecretBefore);
    assert.equal(
      (await getKafkaSource(owned.connectorId, DEFAULT_ORG)).connectorId,
      owned.connectorId,
    );
    assert.equal(
      (await getKafkaSource(victim.connectorId, VICTIM_ORG)).connectorId,
      victim.connectorId,
    );

    const normalSecretCreate = await secretsRoute.POST(
      request('/api/v1/admin/secrets', {
        method: 'POST',
        body: JSON.stringify({ key: 'tools/demo-token', value: 'ordinary-secret' }),
      }),
    );
    assert.equal(normalSecretCreate.status, 201);
    assert.equal(vault.get('tools/demo-token'), 'ordinary-secret');
    const normalSecretDelete = await secretsRoute.DELETE(
      request('/api/v1/admin/secrets?key=tools%2Fdemo-token', { method: 'DELETE' }),
    );
    assert.equal(normalSecretDelete.status, 200);
    assert.equal(vault.has('tools/demo-token'), false);

    const defaultConnector = await createConnector({
      name: 'Default REST source',
      type: 'rest',
      endpoint: 'https://example.test/api',
      orgId: DEFAULT_ORG,
    });
    defaultConnectorIds.push(defaultConnector.id);
    const defaultRef = await persistConnectorSecret(
      defaultConnector.id,
      DEFAULT_ORG,
      'default-token-v1',
    );
    assert.equal(defaultRef, connectorSecretRelativeKey(defaultConnector.id));
    assert.equal(
      await resolveConnectorSecret(defaultConnector.id, DEFAULT_ORG),
      'default-token-v1',
    );
    await persistConnectorSecret(defaultConnector.id, DEFAULT_ORG, 'default-token-v2');
    assert.deepEqual(
      await resolveConnectorTarget({
        id: defaultConnector.id,
        orgId: DEFAULT_ORG,
        type: defaultConnector.type,
        endpoint: defaultConnector.endpoint,
      }),
      {
        type: 'rest',
        endpoint: 'https://example.test/api',
        authHeader: { authorization: 'Bearer default-token-v2' },
        credentialError: null,
      },
    );
    await deleteConnector(defaultConnector.id, DEFAULT_ORG);
    assert.equal(vault.has(defaultRef ?? ''), false);

    const objectConnector = await createConnector({
      name: 'Tenant object source',
      type: 's3',
      endpoint: 'https://objects.example.test',
      orgId: LIFECYCLE_ORG,
    });
    const objectRef = await persistConnectorSecret(
      objectConnector.id,
      LIFECYCLE_ORG,
      serializeObjectStoreCredential({ accessKey: 'access-v1', secretKey: 'secret-v1' }),
    );
    assert.equal(objectRef, `${LIFECYCLE_ORG}/connectors/${objectConnector.id}/credential`);
    assert.match(
      (await resolveConnectorSecret(objectConnector.id, LIFECYCLE_ORG)) ?? '',
      /access-v1/,
    );
    await persistConnectorSecret(
      objectConnector.id,
      LIFECYCLE_ORG,
      serializeObjectStoreCredential({ accessKey: 'access-v2', secretKey: 'secret-v2' }),
    );
    assert.match(
      (await resolveConnectorSecret(objectConnector.id, LIFECYCLE_ORG)) ?? '',
      /access-v2/,
    );
    await deleteConnector(objectConnector.id, LIFECYCLE_ORG);
    assert.equal(vault.has(objectRef ?? ''), false);

    const legacy = await createConnector({
      name: 'Legacy non-default source',
      type: 'rest',
      endpoint: 'https://legacy.example.test',
      orgId: LIFECYCLE_ORG,
    });
    const legacyRef = connectorSecretRelativeKey(legacy.id);
    vault.set(legacyRef, 'legacy-global-token');
    await db
      .update(connectors)
      .set({ secretRef: legacyRef })
      .where(and(eq(connectors.id, legacy.id), eq(connectors.orgId, LIFECYCLE_ORG)));
    await assert.rejects(
      resolveConnectorSecret(legacy.id, LIFECYCLE_ORG),
      (error: unknown) =>
        error instanceof ConnectorSecretScopeError &&
        error.message === LEGACY_CONNECTOR_SECRET_REMEDIATION,
    );
    const legacyProbe = await testConnection({
      id: legacy.id,
      orgId: LIFECYCLE_ORG,
      type: legacy.type,
      endpoint: legacy.endpoint,
    });
    assert.equal(legacyProbe.ok, false);
    assert.equal(legacyProbe.message, LEGACY_CONNECTOR_SECRET_REMEDIATION);
    await deleteConnector(legacy.id, LIFECYCLE_ORG);
    vault.delete(legacyRef);

    await deleteKafkaSource(owned.connectorId, DEFAULT_ORG);
    await deleteKafkaSource(victim.connectorId, VICTIM_ORG);
  },
);
