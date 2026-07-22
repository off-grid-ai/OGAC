import { createHash } from 'node:crypto';

export const KAFKA_SOURCE_MAX_RECORDS = 100;
export const KAFKA_SOURCE_MAX_BYTES = 1024 * 1024;
export const KAFKA_SOURCE_MAX_OFFSET_SPAN = 500;
export const KAFKA_SOURCE_MAX_PARTITION_WINDOWS = 32;
export const KAFKA_SOURCE_TIMEOUT_MS = 10_000;

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_KAFKA_NAME = /^[A-Za-z0-9._-]{1,249}$/;
const SAFE_FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SAFE_CORRELATION = /^[A-Za-z0-9._:-]{8,160}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export type KafkaSourceOperation = 'read';

export interface KafkaPartitionWindow {
  partition: number;
  fromOffset: string;
  toOffset: string;
}

export interface KafkaSourceReadRequest {
  orgId: string;
  connectorId: string;
  domainId: string;
  op: KafkaSourceOperation;
  limit: number;
  params: {
    partitionWindows?: KafkaPartitionWindow[];
    correlationId?: string;
  };
}

/** Trusted projection assembled from an org-scoped connector, domain and vaulted secret. */
export interface ResolvedKafkaSourceBinding {
  version: 1;
  orgId: string;
  connectorId: string;
  domainId: string;
  brokers: string[];
  topic: string;
  schemaRegistryUrl: string;
  schema: {
    subject: string;
    version: number;
    id: number;
    sha256: string;
  };
  tenantField: string;
  security: {
    tls: boolean;
    sasl: 'none' | 'plain' | 'scram-sha-256' | 'scram-sha-512';
    username?: string;
    password?: string;
    schemaRegistryAuthorization?: string;
  };
}

export interface KafkaSourceActor {
  orgId: string;
  actorId: string;
}

export interface KafkaTopicPartitionMetadata {
  partition: number;
  lowOffset: string;
  highOffset: string;
}

export interface KafkaSourceRecord {
  partition: number;
  offset: string;
  key: string | null;
  timestamp: string | null;
  value: Record<string, unknown>;
}

export interface KafkaSourceProvenance {
  orgId: string;
  connectorId: string;
  domainId: string;
  topic: string;
  consumerGroup: string;
  schemaSubject: string;
  schemaVersion: number;
  schemaId: number;
  schemaSha256: string;
  correlationId: string;
  actorId: string;
  consumedAt: string;
  partitionWindows: KafkaPartitionWindow[];
}

export class KafkaSourceContractError extends Error {
  readonly code:
    | 'invalid-request'
    | 'invalid-binding'
    | 'access-denied'
    | 'offset-window-invalid'
    | 'schema-unsupported'
    | 'record-schema-invalid';

  constructor(
    code:
      | 'invalid-request'
      | 'invalid-binding'
      | 'access-denied'
      | 'offset-window-invalid'
      | 'schema-unsupported'
      | 'record-schema-invalid',
    message: string,
  ) {
    super(message);
    this.name = 'KafkaSourceContractError';
    this.code = code;
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length)
    throw new KafkaSourceContractError('invalid-request', `${label} contains unsupported fields`);
}

function safeId(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!SAFE_ID.test(normalized)) {
    throw new KafkaSourceContractError('invalid-request', `${label} must be a safe identifier`);
  }
  return normalized;
}

function offset(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value)) {
    throw new KafkaSourceContractError(
      'invalid-request',
      `${label} must be a non-negative decimal string`,
    );
  }
  return value;
}

function normalizeWindows(value: unknown): KafkaPartitionWindow[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > KAFKA_SOURCE_MAX_PARTITION_WINDOWS
  ) {
    throw new KafkaSourceContractError(
      'invalid-request',
      `partitionWindows must contain 1-${KAFKA_SOURCE_MAX_PARTITION_WINDOWS} explicit windows`,
    );
  }
  const partitions = new Set<number>();
  let span = 0n;
  const windows = value.map((item, index) => {
    if (!plainObject(item)) {
      throw new KafkaSourceContractError(
        'invalid-request',
        `partitionWindows[${index}] is invalid`,
      );
    }
    exactKeys(item, ['partition', 'fromOffset', 'toOffset'], `partitionWindows[${index}]`);
    if (
      !Number.isInteger(item.partition) ||
      Number(item.partition) < 0 ||
      Number(item.partition) > 1023
    ) {
      throw new KafkaSourceContractError(
        'invalid-request',
        `partitionWindows[${index}].partition is invalid`,
      );
    }
    const partition = Number(item.partition);
    if (partitions.has(partition)) {
      throw new KafkaSourceContractError(
        'invalid-request',
        'partitionWindows must be unique by partition',
      );
    }
    partitions.add(partition);
    const fromOffset = offset(item.fromOffset, `partitionWindows[${index}].fromOffset`);
    const toOffset = offset(item.toOffset, `partitionWindows[${index}].toOffset`);
    const from = BigInt(fromOffset);
    const to = BigInt(toOffset);
    if (to < from) {
      throw new KafkaSourceContractError(
        'invalid-request',
        'partition window end precedes its start',
      );
    }
    span += to - from + 1n;
    return { partition, fromOffset, toOffset };
  });
  if (span > BigInt(KAFKA_SOURCE_MAX_OFFSET_SPAN)) {
    throw new KafkaSourceContractError(
      'invalid-request',
      `partition window span exceeds ${KAFKA_SOURCE_MAX_OFFSET_SPAN} records`,
    );
  }
  return windows.sort((a, b) => a.partition - b.partition);
}

export function parseKafkaSourceReadRequest(value: unknown): KafkaSourceReadRequest {
  if (!plainObject(value)) {
    throw new KafkaSourceContractError('invalid-request', 'Kafka source request must be an object');
  }
  exactKeys(value, ['orgId', 'connectorId', 'domainId', 'op', 'limit', 'params'], 'request');
  if (value.op !== 'read') {
    throw new KafkaSourceContractError('invalid-request', 'op must be read');
  }
  if (
    !Number.isInteger(value.limit) ||
    Number(value.limit) < 1 ||
    Number(value.limit) > KAFKA_SOURCE_MAX_RECORDS
  ) {
    throw new KafkaSourceContractError(
      'invalid-request',
      `limit must be an integer from 1 to ${KAFKA_SOURCE_MAX_RECORDS}`,
    );
  }
  const params = value.params === undefined ? {} : value.params;
  if (!plainObject(params)) {
    throw new KafkaSourceContractError('invalid-request', 'params must be an object');
  }
  exactKeys(params, ['partitionWindows', 'correlationId'], 'params');
  const correlationId =
    params.correlationId === undefined
      ? undefined
      : typeof params.correlationId === 'string' &&
          SAFE_CORRELATION.test(params.correlationId.trim())
        ? params.correlationId.trim()
        : null;
  if (correlationId === null) {
    throw new KafkaSourceContractError(
      'invalid-request',
      'correlationId must be 8-160 safe characters',
    );
  }
  const partitionWindows = normalizeWindows(params.partitionWindows);
  return {
    orgId: safeId(value.orgId, 'orgId'),
    connectorId: safeId(value.connectorId, 'connectorId'),
    domainId: safeId(value.domainId, 'domainId'),
    op: 'read',
    limit: Number(value.limit),
    params: {
      ...(partitionWindows ? { partitionWindows } : {}),
      ...(correlationId ? { correlationId } : {}),
    },
  };
}

function validBroker(value: string): boolean {
  if (!value || value.includes('://') || /[\s/@]/.test(value)) return false;
  try {
    const parsed = new URL(`tcp://${value}`);
    const port = Number(parsed.port);
    return Boolean(
      parsed.hostname && parsed.port && Number.isInteger(port) && port > 0 && port <= 65_535,
    );
  } catch {
    return false;
  }
}

export function validateResolvedKafkaSourceBinding(
  binding: ResolvedKafkaSourceBinding,
): ResolvedKafkaSourceBinding {
  try {
    safeId(binding.orgId, 'binding.orgId');
    safeId(binding.connectorId, 'binding.connectorId');
    safeId(binding.domainId, 'binding.domainId');
  } catch (error) {
    throw new KafkaSourceContractError(
      'invalid-binding',
      error instanceof Error ? error.message : 'Kafka binding identity is invalid',
    );
  }
  if (binding.version !== 1)
    throw new KafkaSourceContractError('invalid-binding', 'binding version is unsupported');
  if (
    !Array.isArray(binding.brokers) ||
    binding.brokers.length < 1 ||
    binding.brokers.length > 8 ||
    binding.brokers.some((broker) => !validBroker(broker))
  ) {
    throw new KafkaSourceContractError(
      'invalid-binding',
      'binding brokers must contain 1-8 host:port entries',
    );
  }
  if (!SAFE_KAFKA_NAME.test(binding.topic) || binding.topic === '.' || binding.topic === '..') {
    throw new KafkaSourceContractError('invalid-binding', 'binding topic is invalid');
  }
  let schemaUrl: URL;
  try {
    schemaUrl = new URL(binding.schemaRegistryUrl);
  } catch {
    throw new KafkaSourceContractError('invalid-binding', 'schema registry URL is invalid');
  }
  if (
    !['http:', 'https:'].includes(schemaUrl.protocol) ||
    schemaUrl.username ||
    schemaUrl.password
  ) {
    throw new KafkaSourceContractError(
      'invalid-binding',
      'schema registry URL must be credential-free HTTP',
    );
  }
  if (!SAFE_KAFKA_NAME.test(binding.schema.subject)) {
    throw new KafkaSourceContractError('invalid-binding', 'schema subject is invalid');
  }
  if (
    !Number.isInteger(binding.schema.version) ||
    binding.schema.version < 1 ||
    !Number.isInteger(binding.schema.id) ||
    binding.schema.id < 1 ||
    !SHA256.test(binding.schema.sha256)
  ) {
    throw new KafkaSourceContractError('invalid-binding', 'schema identity is invalid');
  }
  if (!SAFE_FIELD.test(binding.tenantField)) {
    throw new KafkaSourceContractError('invalid-binding', 'tenant field is invalid');
  }
  if (!['none', 'plain', 'scram-sha-256', 'scram-sha-512'].includes(binding.security.sasl)) {
    throw new KafkaSourceContractError('invalid-binding', 'Kafka SASL mode is invalid');
  }
  const username = binding.security.username?.trim();
  const password = binding.security.password;
  if (
    (binding.security.sasl === 'none' && (username || password)) ||
    (binding.security.sasl !== 'none' && (!username || !password))
  ) {
    throw new KafkaSourceContractError(
      'invalid-binding',
      'Kafka SASL credentials do not match the bound authentication mode',
    );
  }
  if (
    binding.security.schemaRegistryAuthorization !== undefined &&
    !/^(Basic|Bearer) [^\r\n]{1,2048}$/.test(binding.security.schemaRegistryAuthorization)
  ) {
    throw new KafkaSourceContractError(
      'invalid-binding',
      'schema registry authorization is invalid',
    );
  }
  return binding;
}

export function authorizeKafkaSourceRead(
  binding: ResolvedKafkaSourceBinding,
  request: KafkaSourceReadRequest,
  actor: KafkaSourceActor,
): void {
  if (
    actor.orgId !== binding.orgId ||
    request.orgId !== binding.orgId ||
    request.connectorId !== binding.connectorId ||
    request.domainId !== binding.domainId
  ) {
    throw new KafkaSourceContractError(
      'access-denied',
      'Kafka source is not available to this organization and data domain',
    );
  }
  if (!actor.actorId.trim() || actor.actorId.length > 256) {
    throw new KafkaSourceContractError('access-denied', 'Kafka source actor is required');
  }
}

export function kafkaConsumerGroup(
  binding: Pick<ResolvedKafkaSourceBinding, 'orgId' | 'domainId'>,
): string {
  const digest = createHash('sha256')
    .update(`${binding.orgId}\u0000${binding.domainId}`)
    .digest('hex')
    .slice(0, 24);
  return `offgrid-source-${digest}`;
}

export function kafkaSchemaSha256(schema: string): string {
  return createHash('sha256').update(schema).digest('hex');
}

export function resolveKafkaPartitionWindows(
  partitions: KafkaTopicPartitionMetadata[],
  requested: KafkaPartitionWindow[] | undefined,
  limit: number,
): KafkaPartitionWindow[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > KAFKA_SOURCE_MAX_RECORDS) {
    throw new KafkaSourceContractError('offset-window-invalid', 'Kafka record limit is invalid');
  }
  const metadata = new Map<number, KafkaTopicPartitionMetadata>();
  for (const partition of partitions) {
    if (
      !Number.isInteger(partition.partition) ||
      partition.partition < 0 ||
      metadata.has(partition.partition)
    ) {
      throw new KafkaSourceContractError(
        'offset-window-invalid',
        'Kafka topic partition metadata is invalid',
      );
    }
    const low = offset(partition.lowOffset, 'partition low offset');
    const high = offset(partition.highOffset, 'partition high offset');
    if (BigInt(high) < BigInt(low)) {
      throw new KafkaSourceContractError(
        'offset-window-invalid',
        'Kafka topic partition offsets are invalid',
      );
    }
    metadata.set(partition.partition, { ...partition, lowOffset: low, highOffset: high });
  }
  const windows = requested
    ? requested.map((window) => ({ ...window }))
    : (() => {
        let remaining = BigInt(limit);
        const derived: KafkaPartitionWindow[] = [];
        for (const partition of [...partitions].sort((a, b) => a.partition - b.partition)) {
          if (remaining === 0n) break;
          const low = BigInt(partition.lowOffset);
          const high = BigInt(partition.highOffset);
          if (high <= low) continue;
          const available = high - low;
          const take = available < remaining ? available : remaining;
          derived.push({
            partition: partition.partition,
            fromOffset: (high - take).toString(),
            toOffset: (high - 1n).toString(),
          });
          remaining -= take;
        }
        return derived;
      })();
  let span = 0n;
  for (const window of windows) {
    const partition = metadata.get(window.partition);
    if (!partition) {
      throw new KafkaSourceContractError(
        'offset-window-invalid',
        `partition ${window.partition} is not present on the bound topic`,
      );
    }
    const low = BigInt(partition.lowOffset);
    const high = BigInt(partition.highOffset);
    const from = BigInt(window.fromOffset);
    const to = BigInt(window.toOffset);
    if (from < low || to >= high) {
      throw new KafkaSourceContractError(
        'offset-window-invalid',
        `partition ${window.partition} window is outside retained offsets ${low}-${high}`,
      );
    }
    span += to - from + 1n;
  }
  if (span > BigInt(KAFKA_SOURCE_MAX_OFFSET_SPAN) || span > BigInt(limit)) {
    throw new KafkaSourceContractError(
      'offset-window-invalid',
      'resolved Kafka offset window exceeds the bounded read limit',
    );
  }
  return windows.sort((a, b) => a.partition - b.partition);
}

type JsonSchemaProperty = {
  type?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  pattern?: unknown;
  enum?: unknown;
  const?: unknown;
};

function validatePropertySchema(name: string, value: unknown, ruleValue: unknown): string | null {
  if (!plainObject(ruleValue)) return `schema rule for ${name} is unsupported`;
  const rule = ruleValue as JsonSchemaProperty;
  const supported = [
    'type',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'pattern',
    'enum',
    'const',
  ];
  if (Object.keys(rule).some((key) => !supported.includes(key)))
    return `schema rule for ${name} is unsupported`;
  if (!['string', 'number', 'integer', 'boolean'].includes(String(rule.type))) {
    return `schema type for ${name} is unsupported`;
  }
  const typeValid =
    rule.type === 'string'
      ? typeof value === 'string'
      : rule.type === 'boolean'
        ? typeof value === 'boolean'
        : rule.type === 'integer'
          ? Number.isInteger(value)
          : typeof value === 'number' && Number.isFinite(value);
  if (!typeValid) return `${name} does not match its registered type`;
  if (typeof value === 'number') {
    if (typeof rule.minimum === 'number' && value < rule.minimum)
      return `${name} is below its registered minimum`;
    if (typeof rule.maximum === 'number' && value > rule.maximum)
      return `${name} exceeds its registered maximum`;
  }
  if (typeof value === 'string') {
    if (typeof rule.minLength === 'number' && value.length < rule.minLength)
      return `${name} is shorter than its registered minimum`;
    if (typeof rule.maxLength === 'number' && value.length > rule.maxLength)
      return `${name} exceeds its registered maximum`;
    if (rule.pattern !== undefined && typeof rule.pattern !== 'string') {
      return `schema pattern for ${name} is unsupported`;
    }
    if (typeof rule.pattern === 'string') {
      try {
        if (!new RegExp(rule.pattern).test(value))
          return `${name} does not match its registered pattern`;
      } catch {
        return `schema pattern for ${name} is unsupported`;
      }
    }
  }
  if (rule.enum !== undefined && !Array.isArray(rule.enum)) {
    return `schema enum for ${name} is unsupported`;
  }
  if (Array.isArray(rule.enum) && !rule.enum.some((candidate) => Object.is(candidate, value)))
    return `${name} is not a registered value`;
  if (Object.hasOwn(rule, 'const') && !Object.is(rule.const, value))
    return `${name} does not match its registered constant`;
  return null;
}

export function validateKafkaJsonRecord(
  schemaText: string,
  record: unknown,
  tenantField: string,
  orgId: string,
): Record<string, unknown> {
  let schemaValue: unknown;
  try {
    schemaValue = JSON.parse(schemaText);
  } catch {
    throw new KafkaSourceContractError('schema-unsupported', 'registered JSON schema is malformed');
  }
  if (
    !plainObject(schemaValue) ||
    schemaValue.type !== 'object' ||
    schemaValue.additionalProperties !== false ||
    !plainObject(schemaValue.properties) ||
    !Array.isArray(schemaValue.required)
  ) {
    throw new KafkaSourceContractError(
      'schema-unsupported',
      'registered schema must be a closed JSON object',
    );
  }
  const properties = schemaValue.properties;
  const topLevelKeys = [
    '$schema',
    'title',
    'description',
    'type',
    'additionalProperties',
    'required',
    'properties',
  ];
  if (Object.keys(schemaValue).some((key) => !topLevelKeys.includes(key))) {
    throw new KafkaSourceContractError(
      'schema-unsupported',
      'registered schema uses unsupported JSON Schema features',
    );
  }
  const required = schemaValue.required;
  if (
    !required.every((item): item is string => typeof item === 'string') ||
    !required.includes(tenantField) ||
    !(tenantField in properties)
  ) {
    throw new KafkaSourceContractError(
      'schema-unsupported',
      'registered schema must require the bound tenant field',
    );
  }
  if (!plainObject(record)) {
    throw new KafkaSourceContractError(
      'record-schema-invalid',
      'Kafka record must be a JSON object',
    );
  }
  if (record[tenantField] !== orgId) {
    throw new KafkaSourceContractError(
      'access-denied',
      'Kafka record belongs to a different organization',
    );
  }
  const unknown = Object.keys(record).filter((key) => !(key in properties));
  if (unknown.length) {
    throw new KafkaSourceContractError(
      'record-schema-invalid',
      'Kafka record contains fields outside the registered schema',
    );
  }
  for (const name of required) {
    if (!Object.hasOwn(record, name)) {
      throw new KafkaSourceContractError(
        'record-schema-invalid',
        `Kafka record is missing ${name}`,
      );
    }
  }
  for (const [name, value] of Object.entries(record)) {
    const error = validatePropertySchema(name, value, properties[name]);
    if (error) throw new KafkaSourceContractError('record-schema-invalid', error);
  }
  return record;
}

export function buildKafkaSourceProvenance(input: {
  binding: ResolvedKafkaSourceBinding;
  windows: KafkaPartitionWindow[];
  correlationId: string;
  actorId: string;
  consumedAt: string;
}): KafkaSourceProvenance {
  if (!SAFE_CORRELATION.test(input.correlationId) || !input.actorId.trim()) {
    throw new KafkaSourceContractError(
      'invalid-request',
      'Kafka provenance requires a safe correlation and actor identity',
    );
  }
  if (!Number.isFinite(Date.parse(input.consumedAt))) {
    throw new KafkaSourceContractError(
      'invalid-request',
      'Kafka provenance requires a valid consumption timestamp',
    );
  }
  return {
    orgId: input.binding.orgId,
    connectorId: input.binding.connectorId,
    domainId: input.binding.domainId,
    topic: input.binding.topic,
    consumerGroup: kafkaConsumerGroup(input.binding),
    schemaSubject: input.binding.schema.subject,
    schemaVersion: input.binding.schema.version,
    schemaId: input.binding.schema.id,
    schemaSha256: input.binding.schema.sha256,
    correlationId: input.correlationId,
    actorId: input.actorId,
    consumedAt: input.consumedAt,
    partitionWindows: input.windows.map((window) => ({ ...window })),
  };
}
