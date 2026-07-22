import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { AppSpec } from '@/lib/app-model';
import type { KafkaEnterpriseSourcePort } from '@/lib/adapters/kafka-enterprise-source';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const ORG = 'test-kafka-connector-query-runtime';
const FOREIGN_ORG = 'test-kafka-connector-query-runtime-foreign';
const SCHEMA_ID = 41;
const SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['orgId', 'signalId', 'severity'],
  properties: {
    orgId: { type: 'string' },
    signalId: { type: 'string' },
    severity: { type: 'string', enum: ['high', 'low'] },
  },
});
const dbUp = await dbReachable();

function encodedRecord(value: Record<string, unknown>): Buffer {
  const envelope = Buffer.alloc(5);
  envelope[0] = 0;
  envelope.writeUInt32BE(SCHEMA_ID, 1);
  return Buffer.concat([envelope, Buffer.from(JSON.stringify(value))]);
}

test(
  'canonical App connector-query consumes a governed Kafka source with tenant, schema and actor provenance',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const vault = new Map<string, string>();
    const vaultGets: string[] = [];
    let schemaMode: 'exact' | 'mismatch' = 'exact';
    let schemaRequests = 0;
    let kafkaMetadataReads = 0;
    let kafkaWindowReads = 0;
    const registryAuthorization = 'Bearer registry-runtime-secret';
    const vaultPasswordCanary = 'kafka-runtime-vault-canary';

    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://boundary');
      const vaultMatch = url.pathname.match(/^\/v1\/secret\/data\/(.+)$/);
      if (vaultMatch) {
        const key = decodeURIComponent(vaultMatch[1]);
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
          if (!value) {
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
      }

      if (url.pathname === '/subjects/enterprise.risk-signals-value/versions/4') {
        schemaRequests += 1;
        assert.equal(request.headers.authorization, registryAuthorization);
        response.setHeader('content-type', 'application/json');
        return response.end(
          JSON.stringify({
            subject: 'enterprise.risk-signals-value',
            version: 4,
            id: schemaMode === 'exact' ? SCHEMA_ID : SCHEMA_ID + 1,
            schemaType: 'JSON',
            schema: SCHEMA,
          }),
        );
      }

      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = server.address() as AddressInfo;
    const boundaryUrl = `http://127.0.0.1:${port}`;

    const previousBaoUrl = process.env.OFFGRID_OPENBAO_URL;
    const previousBaoToken = process.env.OFFGRID_OPENBAO_TOKEN;
    process.env.OFFGRID_OPENBAO_URL = boundaryUrl;
    process.env.OFFGRID_OPENBAO_TOKEN = 'test-vault-token';
    t.after(() => {
      if (previousBaoUrl === undefined) delete process.env.OFFGRID_OPENBAO_URL;
      else process.env.OFFGRID_OPENBAO_URL = previousBaoUrl;
      if (previousBaoToken === undefined) delete process.env.OFFGRID_OPENBAO_TOKEN;
      else process.env.OFFGRID_OPENBAO_TOKEN = previousBaoToken;
    });

    const { createConnector, deleteConnector, listConnectors } = await import('@/lib/store');
    const { createDomain, deleteDomain, listDomains } = await import('@/lib/data-domains-store');
    const { persistConnectorSecret } = await import('@/lib/connector-secrets');
    const { defaultDeps, executeStep } = await import('@/lib/app-run');

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
      endpoint: 'kafka://127.0.0.1:19092',
      auth: 'api-key',
      description: 'Governed App runtime source',
      custom: true,
      orgId: ORG,
    });
    const domain = await createDomain(
      {
        label: 'Enterprise risk signals',
        connectorId: connector.id,
        resource: 'enterprise.risk-signals',
        opHints: {
          kafka: {
            schemaRegistryUrl: boundaryUrl,
            schemaSubject: 'enterprise.risk-signals-value',
            schemaVersion: 4,
            schemaId: SCHEMA_ID,
            schemaSha256: createHash('sha256').update(SCHEMA).digest('hex'),
            tenantField: 'orgId',
          },
        },
      },
      ORG,
    );
    await persistConnectorSecret(
      connector.id,
      ORG,
      JSON.stringify({
        version: 1,
        tls: false,
        sasl: 'plain',
        username: 'runtime-reader',
        password: vaultPasswordCanary,
        schemaRegistryAuthorization: registryAuthorization,
      }),
    );

    const portFactory = (): KafkaEnterpriseSourcePort => ({
      async topicPartitions(topic) {
        kafkaMetadataReads += 1;
        assert.equal(topic, 'enterprise.risk-signals');
        return [{ partition: 0, lowOffset: '40', highOffset: '43' }];
      },
      async readWindows(input) {
        kafkaWindowReads += 1;
        assert.equal(input.topic, 'enterprise.risk-signals');
        assert.match(input.groupId, /^offgrid-source-[a-f0-9]{24}$/);
        assert.deepEqual(input.windows, [{ partition: 0, fromOffset: '42', toOffset: '42' }]);
        return [
          {
            partition: 0,
            offset: '42',
            key: Buffer.from('risk-42'),
            timestamp: '1784764800000',
            value: encodedRecord({ orgId: ORG, signalId: 'RSK-42', severity: 'high' }),
          },
        ];
      },
    });
    const dependencies = defaultDeps({
      kafkaSource: {
        portFactory,
        now: () => new Date('2026-07-23T02:00:00.000Z'),
        correlationId: () => 'runtime-correlation-42',
      },
    });
    const step = {
      id: 'read-risk-signals',
      label: 'Read risk signals',
      kind: 'connector-query' as const,
      domain: domain.id,
      op: 'read' as const,
      params: {
        partitionWindows: [{ partition: 0, fromOffset: '42', toOffset: '42' }],
      },
    };
    const spec: AppSpec = {
      id: 'app_risk_triage',
      orgId: ORG,
      ownerId: 'owner_test',
      title: 'Risk triage',
      summary: 'Uses governed enterprise events.',
      visibility: 'org',
      published: true,
      trigger: { kind: 'on-demand' },
      steps: [step],
      edges: [],
    };

    const result = await executeStep(
      spec,
      step,
      [],
      { orgId: ORG, actor: 'signed-in-operator', runId: 'run_kafka_runtime' },
      dependencies,
    );
    assert.equal(result.status, 'done');
    assert.match(result.detail ?? '', /via kafka/);
    const appEvidence = result.output ?? '';
    assert.match(appEvidence, /RSK-42/);
    assert.match(appEvidence, /"topic":"enterprise\.risk-signals"/);
    assert.match(appEvidence, /"partition":0/);
    assert.match(appEvidence, /"offset":"42"/);
    assert.match(appEvidence, /"schema":\{"subject":"enterprise\.risk-signals-value"/);
    assert.match(appEvidence, /"schemaSha256":"[a-f0-9]{64}"/);
    assert.match(appEvidence, /"correlationId":"runtime-correlation-42"/);
    assert.match(appEvidence, /"actorId":"signed-in-operator"/);
    assert.match(appEvidence, /"consumedAt":"2026-07-23T02:00:00.000Z"/);
    assert.ok(appEvidence.includes(`"connectorId":"${connector.id}"`));
    assert.ok(appEvidence.includes(`"domainId":"${domain.id}"`));
    assert.doesNotMatch(
      appEvidence,
      /runtime-reader|registry-runtime-secret|kafka-runtime-vault-canary/,
    );
    assert.equal(schemaRequests, 1);
    assert.equal(kafkaMetadataReads, 1);
    assert.equal(kafkaWindowReads, 1);

    const beforeOverride = {
      vault: vaultGets.length,
      schema: schemaRequests,
      metadata: kafkaMetadataReads,
      windows: kafkaWindowReads,
    };
    const callerActorOverride = await executeStep(
      { ...spec, steps: [{ ...step, params: { ...step.params, actorId: 'caller-forged' } }] },
      { ...step, params: { ...step.params, actorId: 'caller-forged' } },
      [],
      { orgId: ORG, actor: 'signed-in-operator', runId: 'run_actor_override' },
      dependencies,
    );
    assert.equal(callerActorOverride.status, 'error');
    assert.match(callerActorOverride.detail ?? '', /params contains unsupported fields/);
    assert.deepEqual(
      {
        vault: vaultGets.length,
        schema: schemaRequests,
        metadata: kafkaMetadataReads,
        windows: kafkaWindowReads,
      },
      beforeOverride,
      'caller actor override is rejected before secret or source I/O',
    );

    const foreignResult = await executeStep(
      spec,
      step,
      [],
      { orgId: FOREIGN_ORG, actor: 'foreign-operator', runId: 'run_foreign' },
      dependencies,
    );
    assert.equal(foreignResult.status, 'error');
    assert.match(foreignResult.detail ?? '', /no data-domain binds/);
    assert.equal(schemaRequests, beforeOverride.schema, 'tenant denial happens before source I/O');

    schemaMode = 'mismatch';
    const schemaDenied = await executeStep(
      spec,
      step,
      [],
      { orgId: ORG, actor: 'signed-in-operator', runId: 'run_schema_denied' },
      dependencies,
    );
    assert.equal(schemaDenied.status, 'error');
    assert.match(schemaDenied.detail ?? '', /Schema Registry identity does not match/);
    assert.equal(
      kafkaMetadataReads,
      beforeOverride.metadata,
      'schema denial happens before Kafka I/O',
    );
    assert.equal(schemaDenied.output, undefined, 'a denied source never fabricates App output');

    schemaMode = 'exact';
    const fallbackActor = await executeStep(
      spec,
      step,
      [],
      { orgId: ORG, runId: 'run_fallback_actor' },
      dependencies,
    );
    assert.equal(fallbackActor.status, 'done');
    assert.match(fallbackActor.output ?? '', /"actorId":"app-run:run_fallback_actor"/);
  },
);
