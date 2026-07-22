import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KAFKA_SOURCE_MAX_OFFSET_SPAN,
  KafkaSourceContractError,
  authorizeKafkaSourceRead,
  buildKafkaSourceProvenance,
  kafkaConsumerGroup,
  kafkaSchemaSha256,
  parseKafkaSourceReadRequest,
  resolveKafkaPartitionWindows,
  validateKafkaJsonRecord,
  validateResolvedKafkaSourceBinding,
  type ResolvedKafkaSourceBinding,
} from '@/lib/kafka-enterprise-source';

const SCHEMA = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['orgId', 'eventId', 'claimId', 'estimatedIndemnity', 'currency'],
  properties: {
    orgId: { type: 'string', const: 'org_suraksha' },
    eventId: { type: 'string', minLength: 8 },
    claimId: { type: 'string', pattern: '^CLM[0-9]+$' },
    estimatedIndemnity: { type: 'number', minimum: 0 },
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  },
});

const BINDING: ResolvedKafkaSourceBinding = {
  version: 1,
  orgId: 'org_suraksha',
  connectorId: 'surcon_events',
  domainId: 'dom_claim_events',
  brokers: ['redpanda.internal:9092'],
  topic: 'insurance.claim-events',
  schemaRegistryUrl: 'http://schema-registry.internal:8081',
  schema: {
    subject: 'insurance.claim-events-value',
    version: 3,
    id: 17,
    sha256: kafkaSchemaSha256(SCHEMA),
  },
  tenantField: 'orgId',
  security: {
    tls: false,
    sasl: 'scram-sha-256',
    username: 'claims-reader',
    password: 'vault-resolved-secret',
    schemaRegistryAuthorization: 'Bearer vault-resolved-registry-token',
  },
};

const REQUEST = parseKafkaSourceReadRequest({
  orgId: 'org_suraksha',
  connectorId: 'surcon_events',
  domainId: 'dom_claim_events',
  op: 'read',
  limit: 20,
  params: {
    correlationId: 'claim-intake:CLM1001',
    partitionWindows: [{ partition: 0, fromOffset: '12', toOffset: '19' }],
  },
});

test('public Kafka source input exposes only the bounded domain read contract', () => {
  assert.deepEqual(REQUEST.params.partitionWindows, [
    { partition: 0, fromOffset: '12', toOffset: '19' },
  ]);
  for (const invalid of [
    { ...REQUEST, topic: 'other' },
    { ...REQUEST, op: 'write' },
    { ...REQUEST, limit: 101 },
    { ...REQUEST, params: { brokers: ['evil:9092'] } },
    {
      ...REQUEST,
      params: {
        partitionWindows: [
          { partition: 0, fromOffset: '1', toOffset: String(KAFKA_SOURCE_MAX_OFFSET_SPAN + 1) },
        ],
      },
    },
  ]) {
    assert.throws(() => parseKafkaSourceReadRequest(invalid), KafkaSourceContractError);
  }
});

test('resolved binding validates credential-free broker and exact schema identities', () => {
  assert.equal(validateResolvedKafkaSourceBinding(BINDING), BINDING);
  assert.throws(
    () => validateResolvedKafkaSourceBinding({ ...BINDING, brokers: ['https://evil.test/kafka'] }),
    /brokers/,
  );
  assert.throws(
    () =>
      validateResolvedKafkaSourceBinding({
        ...BINDING,
        schemaRegistryUrl: 'http://user:password@schema.internal:8081',
      }),
    /credential-free/,
  );
  assert.throws(
    () =>
      validateResolvedKafkaSourceBinding({
        ...BINDING,
        schema: { ...BINDING.schema, sha256: 'unverified' },
      }),
    /schema identity/,
  );
  assert.throws(
    () =>
      validateResolvedKafkaSourceBinding({
        ...BINDING,
        security: { tls: true, sasl: 'plain' },
      }),
    /credentials/,
  );
  assert.throws(
    () =>
      validateResolvedKafkaSourceBinding({
        ...BINDING,
        security: { tls: true, sasl: 'none', username: 'unexpected', password: 'secret' },
      }),
    /credentials/,
  );
});

test('authorization binds actor, request, connector and domain to one organization', () => {
  assert.doesNotThrow(() =>
    authorizeKafkaSourceRead(BINDING, REQUEST, {
      orgId: 'org_suraksha',
      actorId: 'claims-handler@suraksha.test',
    }),
  );
  assert.throws(
    () =>
      authorizeKafkaSourceRead(
        BINDING,
        { ...REQUEST, domainId: 'dom_other' },
        {
          orgId: 'org_suraksha',
          actorId: 'claims-handler@suraksha.test',
        },
      ),
    /not available/,
  );
  assert.throws(
    () =>
      authorizeKafkaSourceRead(BINDING, REQUEST, {
        orgId: 'org_other',
        actorId: 'other@tenant.test',
      }),
    /not available/,
  );
  assert.equal(kafkaConsumerGroup(BINDING), kafkaConsumerGroup(BINDING));
  assert.notEqual(
    kafkaConsumerGroup(BINDING),
    kafkaConsumerGroup({ ...BINDING, domainId: 'other' }),
  );
});

test('partition windows are explicit or derived from retained broker offsets', () => {
  const partitions = [
    { partition: 0, lowOffset: '10', highOffset: '20' },
    { partition: 1, lowOffset: '4', highOffset: '7' },
  ];
  assert.deepEqual(resolveKafkaPartitionWindows(partitions, REQUEST.params.partitionWindows, 20), [
    { partition: 0, fromOffset: '12', toOffset: '19' },
  ]);
  assert.deepEqual(resolveKafkaPartitionWindows(partitions, undefined, 12), [
    { partition: 0, fromOffset: '10', toOffset: '19' },
    { partition: 1, fromOffset: '5', toOffset: '6' },
  ]);
  assert.throws(
    () =>
      resolveKafkaPartitionWindows(
        partitions,
        [{ partition: 0, fromOffset: '9', toOffset: '12' }],
        20,
      ),
    /outside retained offsets/,
  );
  assert.throws(
    () =>
      resolveKafkaPartitionWindows(
        partitions,
        [{ partition: 7, fromOffset: '1', toOffset: '2' }],
        20,
      ),
    /not present/,
  );
  assert.throws(
    () =>
      resolveKafkaPartitionWindows(
        partitions,
        [{ partition: 0, fromOffset: '10', toOffset: '19' }],
        9,
      ),
    /bounded read limit/,
  );
  assert.throws(
    () =>
      resolveKafkaPartitionWindows(
        [{ partition: 0, lowOffset: '20', highOffset: '10' }],
        undefined,
        1,
      ),
    /metadata|offsets/,
  );
});

test('registered JSON schema and record tenant are both enforced fail-closed', () => {
  const record = {
    orgId: 'org_suraksha',
    eventId: 'evt-0001',
    claimId: 'CLM1001',
    estimatedIndemnity: 125000,
    currency: 'INR',
  };
  assert.deepEqual(validateKafkaJsonRecord(SCHEMA, record, 'orgId', 'org_suraksha'), record);
  assert.throws(
    () =>
      validateKafkaJsonRecord(SCHEMA, { ...record, orgId: 'org_other' }, 'orgId', 'org_suraksha'),
    (error: unknown) => error instanceof KafkaSourceContractError && error.code === 'access-denied',
  );
  assert.throws(
    () =>
      validateKafkaJsonRecord(SCHEMA, { ...record, claimId: '../claim' }, 'orgId', 'org_suraksha'),
    /registered pattern/,
  );
  assert.throws(
    () => validateKafkaJsonRecord(SCHEMA, { ...record, hidden: true }, 'orgId', 'org_suraksha'),
    /outside the registered schema/,
  );
  assert.throws(
    () => validateKafkaJsonRecord('{"type":"object"}', record, 'orgId', 'org_suraksha'),
    (error: unknown) =>
      error instanceof KafkaSourceContractError && error.code === 'schema-unsupported',
  );
  const unsupportedPatternSchema = JSON.stringify({
    ...JSON.parse(SCHEMA),
    properties: {
      ...JSON.parse(SCHEMA).properties,
      claimId: { type: 'string', pattern: 7 },
    },
  });
  assert.throws(
    () => validateKafkaJsonRecord(unsupportedPatternSchema, record, 'orgId', 'org_suraksha'),
    /pattern.*unsupported/,
  );
});

test('provenance retains exact source, schema, windows, actor and correlation', () => {
  const provenance = buildKafkaSourceProvenance({
    binding: BINDING,
    windows: REQUEST.params.partitionWindows!,
    correlationId: REQUEST.params.correlationId!,
    actorId: 'claims-handler@suraksha.test',
    consumedAt: '2026-07-23T01:00:00.000Z',
  });
  assert.equal(provenance.orgId, 'org_suraksha');
  assert.equal(provenance.topic, 'insurance.claim-events');
  assert.equal(provenance.schemaSha256, kafkaSchemaSha256(SCHEMA));
  assert.equal(provenance.correlationId, 'claim-intake:CLM1001');
  assert.match(provenance.consumerGroup, /^offgrid-source-[a-f0-9]{24}$/);
  assert.deepEqual(provenance.partitionWindows, REQUEST.params.partitionWindows);
  assert.throws(
    () =>
      buildKafkaSourceProvenance({
        binding: BINDING,
        windows: REQUEST.params.partitionWindows!,
        correlationId: 'unsafe correlation',
        actorId: 'claims-handler@suraksha.test',
        consumedAt: '2026-07-23T01:00:00.000Z',
      }),
    /correlation/,
  );
});
