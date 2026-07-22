import assert from 'node:assert/strict';
import test from 'node:test';
import {
  redactedKafkaSecurity,
  validateKafkaSource,
  type KafkaSourceInput,
} from '@/lib/kafka-source-onboarding';

const SHA = 'a'.repeat(64);

function validInput(overrides: Partial<KafkaSourceInput> = {}): KafkaSourceInput {
  return {
    name: 'Enterprise risk signals',
    description: 'Approved risk events for governed apps.',
    bootstrapEndpoint: 'events.internal:9093',
    schemaRegistryEndpoint: 'https://schemas.internal:8081',
    topic: 'enterprise.risk-signals',
    schemaSubject: 'enterprise.risk-signals-value',
    schemaVersion: '4',
    schemaId: 29,
    schemaSha256: SHA.toUpperCase(),
    tenantField: 'orgId',
    tls: true,
    sasl: 'none',
    registryAuth: 'none',
    ...overrides,
  };
}

test('normalizes one credential-free Kafka source and exact schema binding', () => {
  const result = validateKafkaSource(validInput());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.value, {
    name: 'Enterprise risk signals',
    description: 'Approved risk events for governed apps.',
    connectorEndpoint: 'kafkas://events.internal:9093',
    connectorAuth: 'none',
    domainLabel: 'Enterprise risk signals',
    topic: 'enterprise.risk-signals',
    domainHints: {
      kafka: {
        schemaRegistryUrl: 'https://schemas.internal:8081',
        schemaSubject: 'enterprise.risk-signals-value',
        schemaVersion: 4,
        schemaId: 29,
        schemaSha256: SHA,
        tenantField: 'orgId',
      },
    },
    vaultValue: JSON.stringify({ version: 1, tls: true, sasl: 'none' }),
    security: { tls: true, sasl: 'none', registryAuth: 'none' },
  });
  assert.equal(result.value?.connectorEndpoint.includes('@'), false);
});

test('treats the TLS control as authoritative when rotating an existing endpoint', () => {
  const encrypted = validateKafkaSource(
    validInput({ bootstrapEndpoint: 'kafka://events.internal:9092', tls: true }),
  );
  assert.equal(encrypted.ok, true);
  assert.equal(encrypted.value?.connectorEndpoint, 'kafkas://events.internal:9092');
  const unencrypted = validateKafkaSource(
    validInput({ bootstrapEndpoint: 'kafkas://events.internal:9093', tls: false }),
  );
  assert.equal(unencrypted.ok, true);
  assert.equal(unencrypted.value?.connectorEndpoint, 'kafka://events.internal:9093');
});

test('puts Kafka and Schema Registry credentials only in the opaque vault value', () => {
  const result = validateKafkaSource(
    validInput({
      sasl: 'scram-sha-512',
      username: 'reader',
      password: 'vault-only-password',
      registryAuth: 'bearer',
      registryToken: 'registry-token',
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.value?.connectorAuth, 'api-key');
  assert.deepEqual(JSON.parse(result.value!.vaultValue), {
    version: 1,
    tls: true,
    sasl: 'scram-sha-512',
    username: 'reader',
    password: 'vault-only-password',
    schemaRegistryAuthorization: 'Bearer registry-token',
  });
  assert.equal(JSON.stringify(result.value?.domainHints).includes('vault-only-password'), false);
});

test('preserves current credentials during an edit and replaces them only when supplied', () => {
  const current = {
    tls: true,
    sasl: 'plain' as const,
    username: 'current-user',
    password: 'current-password',
    schemaRegistryAuthorization: 'Basic current-registry',
  };
  const preserved = validateKafkaSource(
    validInput({ sasl: 'plain', registryAuth: 'basic' }),
    current,
  );
  assert.equal(preserved.ok, true);
  assert.deepEqual(JSON.parse(preserved.value!.vaultValue), {
    version: 1,
    tls: true,
    sasl: 'plain',
    username: 'current-user',
    password: 'current-password',
    schemaRegistryAuthorization: 'Basic current-registry',
  });

  const rotated = validateKafkaSource(
    validInput({
      sasl: 'plain',
      username: 'next-user',
      password: 'next-password',
      registryAuth: 'basic',
      registryUsername: 'registry-user',
      registryPassword: 'registry-password',
    }),
    current,
  );
  assert.equal(rotated.ok, true);
  const secret = JSON.parse(rotated.value!.vaultValue) as Record<string, string>;
  assert.equal(secret.username, 'next-user');
  assert.equal(secret.password, 'next-password');
  assert.match(secret.schemaRegistryAuthorization, /^Basic /);
  assert.equal(secret.schemaRegistryAuthorization.includes('registry-password'), false);
});

test('fails closed on endpoint, schema, tenant, and credential drift', () => {
  const result = validateKafkaSource(
    validInput({
      bootstrapEndpoint: 'kafka://events.internal:9092/path?override=true',
      schemaRegistryEndpoint: 'ftp://schemas.internal',
      topic: '../unsafe',
      schemaVersion: 0,
      schemaId: 'not-a-number',
      schemaSha256: 'short',
      tenantField: 'context[orgId]',
      tls: true,
      sasl: 'plain',
      registryAuth: 'bearer',
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.value, null);
  assert.deepEqual(Object.keys(result.errors).sort(), [
    'bootstrapEndpoint',
    'password',
    'registryToken',
    'schemaId',
    'schemaRegistryEndpoint',
    'schemaSha256',
    'schemaVersion',
    'tenantField',
    'topic',
    'username',
  ]);
});

test('rejects caller-defined runtime policy instead of ignoring it', () => {
  const result = validateKafkaSource({
    ...validInput(),
    consumerGroup: 'caller-selected-group',
    maxRecords: 50_000,
  } as KafkaSourceInput);
  assert.equal(result.ok, false);
  assert.equal(
    result.errors.request,
    'Remove fields that are not part of governed source onboarding.',
  );
});

test('redacted security reports presence and modes without returning secrets', () => {
  const redacted = redactedKafkaSecurity({
    tls: true,
    sasl: 'scram-sha-256',
    username: 'reader',
    password: 'secret',
    schemaRegistryAuthorization: 'Bearer token',
  });
  assert.deepEqual(redacted, {
    tls: true,
    sasl: 'scram-sha-256',
    hasSaslCredentials: true,
    registryAuth: 'bearer',
    hasRegistryCredential: true,
  });
  assert.equal(JSON.stringify(redacted).includes('secret'), false);
  assert.equal(JSON.stringify(redacted).includes('token'), false);
});
