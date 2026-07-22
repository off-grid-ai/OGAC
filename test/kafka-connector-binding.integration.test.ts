import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const ORG = 'test-kafka-connector-binding';
const FOREIGN_ORG = 'test-kafka-connector-binding-foreign';
const dbUp = await dbReachable();

function schemaHints(schemaRegistryUrl: string): Record<string, unknown> {
  return {
    kafka: {
      schemaRegistryUrl,
      schemaSubject: 'enterprise.risk-signals-value',
      schemaVersion: 4,
      schemaId: 29,
      schemaSha256: createHash('sha256').update('{"type":"object"}').digest('hex'),
      tenantField: 'orgId',
    },
  };
}

function securityBinding(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    tls: false,
    sasl: 'scram-sha-512',
    username: 'enterprise-reader',
    password: 'vault-only-password',
    schemaRegistryAuthorization: 'Bearer vault-only-registry-token',
    ...overrides,
  });
}

test(
  'resolves one tenant-owned Kafka binding from real connector/domain stores and vaulted policy',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const vault = new Map<string, string>();
    const vaultGets: string[] = [];
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://vault');
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
      if (request.method === 'GET') {
        vaultGets.push(key);
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
    const vaultUrl = `http://127.0.0.1:${port}`;

    const previousBaoUrl = process.env.OFFGRID_OPENBAO_URL;
    const previousBaoToken = process.env.OFFGRID_OPENBAO_TOKEN;
    process.env.OFFGRID_OPENBAO_URL = vaultUrl;
    process.env.OFFGRID_OPENBAO_TOKEN = 'test-vault-token';
    t.after(() => {
      if (previousBaoUrl === undefined) delete process.env.OFFGRID_OPENBAO_URL;
      else process.env.OFFGRID_OPENBAO_URL = previousBaoUrl;
      if (previousBaoToken === undefined) delete process.env.OFFGRID_OPENBAO_TOKEN;
      else process.env.OFFGRID_OPENBAO_TOKEN = previousBaoToken;
    });

    const { createConnector, deleteConnector, listConnectors } = await import('@/lib/store');
    const { createDomain, deleteDomain, listDomains } = await import('@/lib/data-domains-store');
    const { persistConnectorSecret, connectorSecretKey } = await import('@/lib/connector-secrets');
    const { KafkaConnectorBindingError, resolveKafkaConnectorBinding } =
      await import('@/lib/adapters/kafka-connector-binding');

    async function clean(orgId: string): Promise<void> {
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

    const connector = await createConnector({
      name: 'Enterprise risk signals',
      type: 'kafka',
      endpoint: 'kafka://127.0.0.1:8948',
      auth: 'api-key',
      description: 'Governed event source',
      custom: true,
      orgId: ORG,
    });
    const domain = await createDomain(
      {
        label: 'Enterprise risk signals',
        aliases: ['machine and conversation risk events'],
        connectorId: connector.id,
        resource: 'enterprise.risk-signals',
        opHints: schemaHints('http://127.0.0.1:8946'),
      },
      ORG,
    );
    const secret = securityBinding();
    await persistConnectorSecret(connector.id, secret);

    const resolved = await resolveKafkaConnectorBinding({
      orgId: ORG,
      connectorId: connector.id,
      domainId: domain.id,
    });
    assert.deepEqual(resolved, {
      version: 1,
      orgId: ORG,
      connectorId: connector.id,
      domainId: domain.id,
      brokers: ['127.0.0.1:8948'],
      topic: 'enterprise.risk-signals',
      schemaRegistryUrl: 'http://127.0.0.1:8946',
      schema: {
        subject: 'enterprise.risk-signals-value',
        version: 4,
        id: 29,
        sha256: createHash('sha256').update('{"type":"object"}').digest('hex'),
      },
      tenantField: 'orgId',
      security: {
        tls: false,
        sasl: 'scram-sha-512',
        username: 'enterprise-reader',
        password: 'vault-only-password',
        schemaRegistryAuthorization: 'Bearer vault-only-registry-token',
      },
    });
    assert.equal(vault.get(connectorSecretKey(connector.id)), secret);
    assert.deepEqual(vaultGets, [connectorSecretKey(connector.id)]);

    const beforeOwnershipDenials = vaultGets.length;
    await assert.rejects(
      resolveKafkaConnectorBinding({
        orgId: FOREIGN_ORG,
        connectorId: connector.id,
        domainId: domain.id,
      }),
      (error: unknown) =>
        error instanceof KafkaConnectorBindingError && error.code === 'unknown-source',
    );
    const otherConnector = await createConnector({
      name: 'Different source',
      type: 'kafka',
      endpoint: 'kafka://127.0.0.1:8948',
      orgId: ORG,
    });
    await assert.rejects(
      resolveKafkaConnectorBinding({
        orgId: ORG,
        connectorId: otherConnector.id,
        domainId: domain.id,
      }),
      (error: unknown) =>
        error instanceof KafkaConnectorBindingError && error.code === 'unapproved-scope',
    );
    assert.equal(
      vaultGets.length,
      beforeOwnershipDenials,
      'tenant and domain ownership denials happen before any secret read',
    );

    const restConnector = await createConnector({
      name: 'Not Kafka',
      type: 'rest',
      endpoint: 'https://example.test',
      orgId: ORG,
    });
    await assert.rejects(
      resolveKafkaConnectorBinding({
        orgId: ORG,
        connectorId: restConnector.id,
        domainId: domain.id,
      }),
      (error: unknown) => error instanceof KafkaConnectorBindingError && error.code === 'not-kafka',
    );

    const missingCredentialDomain = await createDomain(
      {
        label: 'Uncredentialed events',
        connectorId: otherConnector.id,
        resource: 'enterprise.uncredentialed',
        opHints: schemaHints('http://127.0.0.1:8946'),
      },
      ORG,
    );
    await assert.rejects(
      resolveKafkaConnectorBinding({
        orgId: ORG,
        connectorId: otherConnector.id,
        domainId: missingCredentialDomain.id,
      }),
      (error: unknown) =>
        error instanceof KafkaConnectorBindingError && error.code === 'missing-credential',
    );

    const invalidScopeDomain = await createDomain(
      {
        label: 'Invalid schema binding',
        connectorId: connector.id,
        resource: 'enterprise.invalid-schema',
        opHints: {
          kafka: {
            ...(schemaHints('http://127.0.0.1:8946').kafka as Record<string, unknown>),
            callerBrokerOverride: 'evil.example:9092',
          },
        },
      },
      ORG,
    );
    const beforeScopeDenial = vaultGets.length;
    await assert.rejects(
      resolveKafkaConnectorBinding({
        orgId: ORG,
        connectorId: connector.id,
        domainId: invalidScopeDomain.id,
      }),
      (error: unknown) =>
        error instanceof KafkaConnectorBindingError && error.code === 'invalid-scope',
    );
    assert.equal(vaultGets.length, beforeScopeDenial, 'invalid scope fails before secret I/O');

    const tlsConnector = await createConnector({
      name: 'TLS policy mismatch',
      type: 'kafka',
      endpoint: 'kafkas://127.0.0.1:9093',
      orgId: ORG,
    });
    const tlsDomain = await createDomain(
      {
        label: 'TLS policy mismatch',
        connectorId: tlsConnector.id,
        resource: 'enterprise.tls-mismatch',
        opHints: schemaHints('https://registry.internal'),
      },
      ORG,
    );
    await persistConnectorSecret(tlsConnector.id, securityBinding({ tls: false }));
    await assert.rejects(
      resolveKafkaConnectorBinding({
        orgId: ORG,
        connectorId: tlsConnector.id,
        domainId: tlsDomain.id,
      }),
      (error: unknown) =>
        error instanceof KafkaConnectorBindingError && error.code === 'invalid-credential',
    );

    const badSecretConnector = await createConnector({
      name: 'Malformed vault binding',
      type: 'kafka',
      endpoint: 'kafka://127.0.0.1:9094',
      orgId: ORG,
    });
    const badSecretDomain = await createDomain(
      {
        label: 'Malformed vault binding',
        connectorId: badSecretConnector.id,
        resource: 'enterprise.bad-secret',
        opHints: schemaHints('http://127.0.0.1:8946'),
      },
      ORG,
    );
    const secretCanary = 'must-never-appear-in-binding-errors';
    await persistConnectorSecret(
      badSecretConnector.id,
      securityBinding({ unsupportedSecretField: secretCanary }),
    );
    await assert.rejects(
      resolveKafkaConnectorBinding({
        orgId: ORG,
        connectorId: badSecretConnector.id,
        domainId: badSecretDomain.id,
      }),
      (error: unknown) => {
        assert(error instanceof KafkaConnectorBindingError);
        assert.equal(error.code, 'invalid-credential');
        assert.doesNotMatch(error.message, new RegExp(secretCanary));
        return true;
      },
    );

    await persistConnectorSecret(badSecretConnector.id, `{${secretCanary}`);
    await assert.rejects(
      resolveKafkaConnectorBinding({
        orgId: ORG,
        connectorId: badSecretConnector.id,
        domainId: badSecretDomain.id,
      }),
      (error: unknown) => {
        assert(error instanceof KafkaConnectorBindingError);
        assert.equal(error.code, 'invalid-credential');
        assert.doesNotMatch(error.message, new RegExp(secretCanary));
        return true;
      },
    );
  },
);
