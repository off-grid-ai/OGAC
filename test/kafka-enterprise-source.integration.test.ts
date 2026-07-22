import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  KAFKA_SOURCE_MAX_BYTES,
  kafkaConsumerGroup,
  kafkaSchemaSha256,
  parseKafkaSourceReadRequest,
  type ResolvedKafkaSourceBinding,
} from '../src/lib/kafka-enterprise-source.ts';
import {
  KafkaEnterpriseSourceBoundaryError,
  readKafkaEnterpriseSource,
  type KafkaEnterpriseSourcePort,
  type RawKafkaSourceRecord,
} from '../src/lib/adapters/kafka-enterprise-source.ts';

const SCHEMA = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['orgId', 'eventId', 'machineId', 'riskScore'],
  properties: {
    orgId: { type: 'string', const: 'org_factory' },
    eventId: { type: 'string', minLength: 8 },
    machineId: { type: 'string', pattern: '^M-[0-9]{3}$' },
    riskScore: { type: 'number', minimum: 0, maximum: 1 },
  },
});

function binding(schemaRegistryUrl: string): ResolvedKafkaSourceBinding {
  return {
    version: 1,
    orgId: 'org_factory',
    connectorId: 'factory_redpanda',
    domainId: 'machine_risk_signals',
    brokers: ['127.0.0.1:19092'],
    topic: 'factory.machine-risk',
    schemaRegistryUrl,
    schema: {
      subject: 'factory.machine-risk-value',
      version: 4,
      id: 29,
      sha256: kafkaSchemaSha256(SCHEMA),
    },
    tenantField: 'orgId',
    security: {
      tls: true,
      sasl: 'scram-sha-512',
      username: 'vaulted-reader',
      password: 'vaulted-password',
      schemaRegistryAuthorization: 'Bearer vaulted-registry-token',
    },
  };
}

function wire(schemaId: number, value: Record<string, unknown>): Buffer {
  const prefix = Buffer.alloc(5);
  prefix[0] = 0;
  prefix.writeUInt32BE(schemaId, 1);
  return Buffer.concat([prefix, Buffer.from(JSON.stringify(value))]);
}

function record(
  offset: string,
  value: Record<string, unknown>,
  overrides: Partial<RawKafkaSourceRecord> = {},
): RawKafkaSourceRecord {
  return {
    partition: 0,
    offset,
    key: Buffer.from(`machine:${offset}`),
    timestamp: String(Date.parse('2026-07-23T02:00:00.000Z') + Number(offset)),
    value: wire(29, value),
    ...overrides,
  };
}

function sourceValue(eventId: string): Record<string, unknown> {
  return { orgId: 'org_factory', eventId, machineId: 'M-042', riskScore: 0.91 };
}

test('reads a complete schema-bound tenant window through real Schema Registry HTTP', async (t) => {
  const calls: Array<{ url: string; authorization: string | undefined }> = [];
  const server = createServer((req, response) => {
    calls.push({
      url: req.url ?? '/',
      authorization:
        typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    });
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        subject: 'factory.machine-risk-value',
        version: 4,
        id: 29,
        schemaType: 'JSON',
        schema: SCHEMA,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === 'object');
  const resolved = binding(`http://127.0.0.1:${address.port}`);
  let boundByFactory: ResolvedKafkaSourceBinding | undefined;
  const portCalls: unknown[] = [];
  const port: KafkaEnterpriseSourcePort = {
    async topicPartitions(topic, signal) {
      portCalls.push({ topic, aborted: signal.aborted });
      return [{ partition: 0, lowOffset: '40', highOffset: '44' }];
    },
    async readWindows(input) {
      portCalls.push(input);
      return [record('41', sourceValue('evt-0041')), record('42', sourceValue('evt-0042'))];
    },
  };
  const result = await readKafkaEnterpriseSource(
    {
      request: parseKafkaSourceReadRequest({
        orgId: 'org_factory',
        connectorId: 'factory_redpanda',
        domainId: 'machine_risk_signals',
        op: 'read',
        limit: 2,
        params: {
          partitionWindows: [{ partition: 0, fromOffset: '41', toOffset: '42' }],
          correlationId: 'machine-risk:M-042',
        },
      }),
      binding: resolved,
      actor: { orgId: 'org_factory', actorId: 'plant-supervisor@factory.test' },
    },
    {
      portFactory(trustedBinding) {
        boundByFactory = trustedBinding;
        return port;
      },
      now: () => new Date('2026-07-23T02:05:00.000Z'),
    },
  );

  assert.equal(boundByFactory, resolved);
  assert.deepEqual(calls, [
    {
      url: '/subjects/factory.machine-risk-value/versions/4',
      authorization: 'Bearer vaulted-registry-token',
    },
  ]);
  assert.deepEqual(portCalls[0], { topic: 'factory.machine-risk', aborted: false });
  assert.equal((portCalls[1] as { groupId: string }).groupId, kafkaConsumerGroup(resolved));
  assert.deepEqual(
    result.records.map(
      ({ partition, offset, key, keyEncoding, schema, correlationId, actorId, value }) => ({
        partition,
        offset,
        key,
        keyEncoding,
        schema,
        correlationId,
        actorId,
        value,
      }),
    ),
    [
      {
        partition: 0,
        offset: '41',
        key: Buffer.from('machine:41').toString('base64'),
        keyEncoding: 'base64',
        schema: resolved.schema,
        correlationId: 'machine-risk:M-042',
        actorId: 'plant-supervisor@factory.test',
        value: sourceValue('evt-0041'),
      },
      {
        partition: 0,
        offset: '42',
        key: Buffer.from('machine:42').toString('base64'),
        keyEncoding: 'base64',
        schema: resolved.schema,
        correlationId: 'machine-risk:M-042',
        actorId: 'plant-supervisor@factory.test',
        value: sourceValue('evt-0042'),
      },
    ],
  );
  assert.equal(result.provenance.topic, 'factory.machine-risk');
  assert.equal(result.provenance.schemaSha256, kafkaSchemaSha256(SCHEMA));
  assert.equal(result.provenance.consumedAt, '2026-07-23T02:05:00.000Z');
  assert.ok(result.bytesRead > 0);
});

test('fails the whole read on registry drift, tenant escape, missing offsets, or byte overflow', async (t) => {
  let registryPayload: Record<string, unknown> = {
    subject: 'factory.machine-risk-value',
    version: 4,
    id: 29,
    schemaType: 'JSON',
    schema: SCHEMA,
  };
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(registryPayload));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === 'object');
  const resolved = binding(`http://127.0.0.1:${address.port}`);
  const request = parseKafkaSourceReadRequest({
    orgId: 'org_factory',
    connectorId: 'factory_redpanda',
    domainId: 'machine_risk_signals',
    op: 'read',
    limit: 2,
    params: { partitionWindows: [{ partition: 0, fromOffset: '41', toOffset: '42' }] },
  });
  let records = [record('41', sourceValue('evt-0041')), record('42', sourceValue('evt-0042'))];
  let portCreated = false;
  const dependencies = {
    correlationId: () => 'generated-correlation',
    portFactory() {
      portCreated = true;
      return {
        async topicPartitions() {
          return [{ partition: 0, lowOffset: '40', highOffset: '44' }];
        },
        async readWindows() {
          return records;
        },
      } satisfies KafkaEnterpriseSourcePort;
    },
  };
  const input = {
    request,
    binding: resolved,
    actor: { orgId: 'org_factory', actorId: 'factory-agent' },
  };

  registryPayload = { ...registryPayload, id: 30 };
  await assert.rejects(
    () => readKafkaEnterpriseSource(input, dependencies),
    (error: unknown) =>
      error instanceof KafkaEnterpriseSourceBoundaryError && error.code === 'schema-mismatch',
  );
  assert.equal(portCreated, false, 'schema identity must fail before Kafka is opened');

  registryPayload = { ...registryPayload, id: 29 };
  records = [
    record('41', sourceValue('evt-0041')),
    record('42', { ...sourceValue('evt-0042'), orgId: 'org_other' }),
  ];
  await assert.rejects(
    () => readKafkaEnterpriseSource(input, dependencies),
    /different organization/,
  );

  records = [record('41', sourceValue('evt-0041'))];
  await assert.rejects(
    () => readKafkaEnterpriseSource(input, dependencies),
    (error: unknown) =>
      error instanceof KafkaEnterpriseSourceBoundaryError && error.code === 'incomplete-window',
  );

  records = [
    record('41', sourceValue('evt-0041')),
    record('42', sourceValue('evt-0042')),
    record('43', sourceValue('evt-0043')),
  ];
  await assert.rejects(
    () => readKafkaEnterpriseSource(input, dependencies),
    /more records than the governed read limit/,
  );

  records = [
    record('41', sourceValue('evt-0041'), {
      value: Buffer.alloc(KAFKA_SOURCE_MAX_BYTES + 1, 1),
    }),
    record('42', sourceValue('evt-0042')),
  ];
  await assert.rejects(
    () => readKafkaEnterpriseSource(input, dependencies),
    (error: unknown) =>
      error instanceof KafkaEnterpriseSourceBoundaryError && error.code === 'byte-limit-exceeded',
  );
});

test('aborts an unresponsive source at the internal hard timeout', async (t) => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        subject: 'factory.machine-risk-value',
        version: 4,
        id: 29,
        schemaType: 'JSON',
        schema: SCHEMA,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === 'object');
  const resolved = binding(`http://127.0.0.1:${address.port}`);
  await assert.rejects(
    () =>
      readKafkaEnterpriseSource(
        {
          request: parseKafkaSourceReadRequest({
            orgId: 'org_factory',
            connectorId: 'factory_redpanda',
            domainId: 'machine_risk_signals',
            op: 'read',
            limit: 1,
            params: {},
          }),
          binding: resolved,
          actor: { orgId: 'org_factory', actorId: 'factory-agent' },
        },
        {
          timeoutMs: 25,
          portFactory() {
            return {
              async topicPartitions(_topic, signal) {
                await new Promise<void>((_resolve, reject) => {
                  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
                });
                return [];
              },
              async readWindows() {
                return [];
              },
            };
          },
        },
      ),
    (error: unknown) =>
      error instanceof KafkaEnterpriseSourceBoundaryError && error.code === 'read-timeout',
  );
});
