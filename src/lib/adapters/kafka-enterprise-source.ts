import { randomUUID } from 'node:crypto';
import kafkaJs from 'kafkajs';
import SnappyCodec from 'kafkajs-snappy';
import type { SASLOptions } from 'kafkajs';
import {
  KAFKA_SOURCE_MAX_BYTES,
  KAFKA_SOURCE_TIMEOUT_MS,
  authorizeKafkaSourceRead,
  buildKafkaSourceProvenance,
  kafkaConsumerGroup,
  kafkaSchemaSha256,
  resolveKafkaPartitionWindows,
  validateKafkaJsonRecord,
  validateResolvedKafkaSourceBinding,
  type KafkaPartitionWindow,
  type KafkaSourceActor,
  type KafkaSourceProvenance,
  type KafkaSourceReadRequest,
  type KafkaTopicPartitionMetadata,
  type ResolvedKafkaSourceBinding,
} from '../kafka-enterprise-source';

const { CompressionCodecs, CompressionTypes, Kafka, logLevel } = kafkaJs;

// Existing Redpanda streams may use Snappy; registration is global and idempotent.
CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec;

export interface RawKafkaSourceRecord {
  partition: number;
  offset: string;
  key: Buffer | null;
  timestamp: string | null;
  value: Buffer;
}

export interface KafkaEnterpriseSourcePort {
  topicPartitions(topic: string, signal: AbortSignal): Promise<KafkaTopicPartitionMetadata[]>;
  readWindows(input: {
    topic: string;
    groupId: string;
    windows: KafkaPartitionWindow[];
    signal: AbortSignal;
  }): Promise<RawKafkaSourceRecord[]>;
}

export interface KafkaSourceRecordEvidence {
  partition: number;
  offset: string;
  key: string | null;
  keyEncoding: 'base64';
  timestamp: string | null;
  value: Record<string, unknown>;
  schema: {
    subject: string;
    version: number;
    id: number;
    sha256: string;
  };
  correlationId: string;
  actorId: string;
}

export interface KafkaEnterpriseSourceReadResult {
  records: KafkaSourceRecordEvidence[];
  bytesRead: number;
  provenance: KafkaSourceProvenance;
}

export class KafkaEnterpriseSourceBoundaryError extends Error {
  readonly code:
    | 'source-unavailable'
    | 'read-timeout'
    | 'schema-mismatch'
    | 'byte-limit-exceeded'
    | 'incomplete-window';

  constructor(
    code:
      | 'source-unavailable'
      | 'read-timeout'
      | 'schema-mismatch'
      | 'byte-limit-exceeded'
      | 'incomplete-window',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'KafkaEnterpriseSourceBoundaryError';
    this.code = code;
  }
}

type SchemaRegistryVersion = {
  subject: string;
  version: number;
  id: number;
  schemaType: 'JSON';
  schema: string;
};

type Fetcher = typeof fetch;

export interface KafkaEnterpriseSourceDependencies {
  fetcher?: Fetcher;
  portFactory?: (binding: ResolvedKafkaSourceBinding) => KafkaEnterpriseSourcePort;
  now?: () => Date;
  correlationId?: () => string;
  timeoutMs?: number;
}

function kafkaSasl(binding: ResolvedKafkaSourceBinding): SASLOptions | undefined {
  if (binding.security.sasl === 'none') return undefined;
  const credentials = {
    username: binding.security.username!,
    password: binding.security.password!,
  };
  if (binding.security.sasl === 'plain') return { mechanism: 'plain', ...credentials };
  if (binding.security.sasl === 'scram-sha-256') {
    return { mechanism: 'scram-sha-256', ...credentials };
  }
  return { mechanism: 'scram-sha-512', ...credentials };
}

function abortError(signal: AbortSignal): KafkaEnterpriseSourceBoundaryError {
  return new KafkaEnterpriseSourceBoundaryError(
    'read-timeout',
    signal.reason instanceof Error ? signal.reason.message : 'Kafka source read timed out',
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

export function createNativeKafkaEnterpriseSourcePort(
  bindingInput: ResolvedKafkaSourceBinding,
): KafkaEnterpriseSourcePort {
  const binding = validateResolvedKafkaSourceBinding(bindingInput);
  const kafka = new Kafka({
    clientId: kafkaConsumerGroup(binding),
    brokers: [...binding.brokers],
    ssl: binding.security.tls,
    sasl: kafkaSasl(binding),
    connectionTimeout: 5_000,
    requestTimeout: KAFKA_SOURCE_TIMEOUT_MS,
    retry: { retries: 1 },
    logLevel: logLevel.NOTHING,
  });

  return {
    async topicPartitions(topic, signal) {
      throwIfAborted(signal);
      const admin = kafka.admin();
      const abort = () => void admin.disconnect().catch(() => undefined);
      signal.addEventListener('abort', abort, { once: true });
      try {
        await admin.connect();
        throwIfAborted(signal);
        const offsets = await admin.fetchTopicOffsets(topic);
        throwIfAborted(signal);
        return offsets.map((item) => ({
          partition: item.partition,
          lowOffset: item.low,
          highOffset: item.high,
        }));
      } catch (error) {
        if (signal.aborted) throw abortError(signal);
        throw new KafkaEnterpriseSourceBoundaryError(
          'source-unavailable',
          'Kafka topic metadata is unavailable',
          { cause: error },
        );
      } finally {
        signal.removeEventListener('abort', abort);
        await admin.disconnect().catch(() => undefined);
      }
    },

    async readWindows({ topic, groupId, windows, signal }) {
      throwIfAborted(signal);
      const consumer = kafka.consumer({
        groupId,
        allowAutoTopicCreation: false,
        maxBytes: KAFKA_SOURCE_MAX_BYTES,
        maxBytesPerPartition: KAFKA_SOURCE_MAX_BYTES,
        retry: { retries: 1 },
      });
      const targets = new Map(windows.map((window) => [window.partition, window]));
      const completed = new Set<number>();
      const records: RawKafkaSourceRecord[] = [];
      let positioned = false;
      let settle: (() => void) | undefined;
      let fail: ((error: Error) => void) | undefined;
      const completion = new Promise<void>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      });
      const abort = () => fail?.(abortError(signal));
      signal.addEventListener('abort', abort, { once: true });
      const removeCrashListener = consumer.on(consumer.events.CRASH, ({ payload }) => {
        fail?.(
          new KafkaEnterpriseSourceBoundaryError(
            'source-unavailable',
            'Kafka consumer failed while reading the bound topic',
            { cause: payload.error },
          ),
        );
      });
      let markJoined: (() => void) | undefined;
      const joined = new Promise<void>((resolve) => {
        markJoined = resolve;
      });
      const removeJoinListener = consumer.on(consumer.events.GROUP_JOIN, () => markJoined?.());
      let run: Promise<void> | undefined;
      try {
        await consumer.connect();
        await consumer.subscribe({ topic, fromBeginning: true });
        run = consumer
          .run({
            autoCommit: false,
            eachBatchAutoResolve: false,
            eachBatch: async ({ batch }) => {
              if (!positioned || completed.has(batch.partition)) return;
              const target = targets.get(batch.partition);
              if (!target) {
                consumer.pause([{ topic, partitions: [batch.partition] }]);
                return;
              }
              const from = BigInt(target.fromOffset);
              const to = BigInt(target.toOffset);
              for (const message of batch.messages) {
                const current = BigInt(message.offset);
                if (current < from) continue;
                if (current > to) {
                  fail?.(
                    new KafkaEnterpriseSourceBoundaryError(
                      'incomplete-window',
                      `Kafka partition ${batch.partition} skipped required offset ${target.toOffset}`,
                    ),
                  );
                  return;
                }
                if (!message.value) {
                  fail?.(
                    new KafkaEnterpriseSourceBoundaryError(
                      'incomplete-window',
                      `Kafka partition ${batch.partition} offset ${message.offset} has no value`,
                    ),
                  );
                  return;
                }
                records.push({
                  partition: batch.partition,
                  offset: message.offset,
                  key: message.key ? Buffer.from(message.key) : null,
                  timestamp: message.timestamp ?? null,
                  value: Buffer.from(message.value),
                });
                if (current === to) {
                  completed.add(batch.partition);
                  consumer.pause([{ topic, partitions: [batch.partition] }]);
                  if (completed.size === targets.size) settle?.();
                  return;
                }
              }
            },
          })
          .catch((error) => {
            fail?.(
              new KafkaEnterpriseSourceBoundaryError(
                'source-unavailable',
                'Kafka consumer stopped before the governed window completed',
                { cause: error },
              ),
            );
          });
        await Promise.race([joined, completion]);
        throwIfAborted(signal);
        for (const window of windows) {
          consumer.seek({ topic, partition: window.partition, offset: window.fromOffset });
        }
        positioned = true;
        await completion;
        return records;
      } catch (error) {
        if (error instanceof KafkaEnterpriseSourceBoundaryError) throw error;
        if (signal.aborted) throw abortError(signal);
        throw new KafkaEnterpriseSourceBoundaryError(
          'source-unavailable',
          'Kafka source read failed',
          { cause: error },
        );
      } finally {
        signal.removeEventListener('abort', abort);
        removeCrashListener();
        removeJoinListener();
        await consumer.stop().catch(() => undefined);
        await run?.catch(() => undefined);
        await consumer.disconnect().catch(() => undefined);
      }
    },
  };
}

function schemaRegistryUrl(binding: ResolvedKafkaSourceBinding): string {
  const base = binding.schemaRegistryUrl.replace(/\/$/, '');
  return `${base}/subjects/${encodeURIComponent(binding.schema.subject)}/versions/${binding.schema.version}`;
}

async function loadExactJsonSchema(
  binding: ResolvedKafkaSourceBinding,
  fetcher: Fetcher,
  signal: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(schemaRegistryUrl(binding), {
      cache: 'no-store',
      headers: binding.security.schemaRegistryAuthorization
        ? { authorization: binding.security.schemaRegistryAuthorization }
        : undefined,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    throw new KafkaEnterpriseSourceBoundaryError(
      'source-unavailable',
      'Schema Registry is unavailable',
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new KafkaEnterpriseSourceBoundaryError(
      'source-unavailable',
      `Schema Registry returned ${response.status}`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new KafkaEnterpriseSourceBoundaryError(
      'schema-mismatch',
      'Schema Registry returned an invalid response',
      { cause: error },
    );
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new KafkaEnterpriseSourceBoundaryError(
      'schema-mismatch',
      'Schema Registry response does not identify the bound schema',
    );
  }
  const schema = payload as Partial<SchemaRegistryVersion>;
  if (
    schema.subject !== binding.schema.subject ||
    schema.version !== binding.schema.version ||
    schema.id !== binding.schema.id ||
    schema.schemaType !== 'JSON' ||
    typeof schema.schema !== 'string' ||
    kafkaSchemaSha256(schema.schema) !== binding.schema.sha256
  ) {
    throw new KafkaEnterpriseSourceBoundaryError(
      'schema-mismatch',
      'Schema Registry identity does not match the governed binding',
    );
  }
  return schema.schema;
}

function decodeSchemaBoundRecord(
  raw: RawKafkaSourceRecord,
  binding: ResolvedKafkaSourceBinding,
  schemaText: string,
): KafkaSourceRecordEvidence {
  if (
    !Number.isInteger(raw.partition) ||
    raw.partition < 0 ||
    !/^(0|[1-9]\d{0,19})$/.test(raw.offset)
  ) {
    throw new KafkaEnterpriseSourceBoundaryError(
      'incomplete-window',
      'Kafka source returned invalid partition or offset provenance',
    );
  }
  if (
    raw.value.length < 6 ||
    raw.value[0] !== 0 ||
    raw.value.readUInt32BE(1) !== binding.schema.id
  ) {
    throw new KafkaEnterpriseSourceBoundaryError(
      'schema-mismatch',
      `Kafka partition ${raw.partition} offset ${raw.offset} is not encoded with bound schema ${binding.schema.id}`,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw.value.subarray(5).toString('utf8'));
  } catch (error) {
    throw new KafkaEnterpriseSourceBoundaryError(
      'schema-mismatch',
      `Kafka partition ${raw.partition} offset ${raw.offset} is not valid schema-bound JSON`,
      { cause: error },
    );
  }
  const value = validateKafkaJsonRecord(schemaText, decoded, binding.tenantField, binding.orgId);
  let timestamp: string | null = null;
  if (raw.timestamp !== null) {
    const milliseconds = Number(raw.timestamp);
    if (!/^\d{1,16}$/.test(raw.timestamp) || !Number.isFinite(milliseconds)) {
      throw new KafkaEnterpriseSourceBoundaryError(
        'incomplete-window',
        `Kafka partition ${raw.partition} offset ${raw.offset} has invalid timestamp provenance`,
      );
    }
    try {
      timestamp = new Date(milliseconds).toISOString();
    } catch (error) {
      throw new KafkaEnterpriseSourceBoundaryError(
        'incomplete-window',
        `Kafka partition ${raw.partition} offset ${raw.offset} has invalid timestamp provenance`,
        { cause: error },
      );
    }
  }
  return {
    partition: raw.partition,
    offset: raw.offset,
    key: raw.key?.toString('base64') ?? null,
    keyEncoding: 'base64',
    timestamp,
    value,
    schema: { ...binding.schema },
    correlationId: '',
    actorId: '',
  };
}

function expectedOffsets(windows: KafkaPartitionWindow[]): Set<string> {
  const expected = new Set<string>();
  for (const window of windows) {
    for (
      let current = BigInt(window.fromOffset);
      current <= BigInt(window.toOffset);
      current += 1n
    ) {
      expected.add(`${window.partition}:${current}`);
    }
  }
  return expected;
}

export async function readKafkaEnterpriseSource(
  input: {
    request: KafkaSourceReadRequest;
    binding: ResolvedKafkaSourceBinding;
    actor: KafkaSourceActor;
  },
  dependencies: KafkaEnterpriseSourceDependencies = {},
): Promise<KafkaEnterpriseSourceReadResult> {
  const binding = validateResolvedKafkaSourceBinding(input.binding);
  authorizeKafkaSourceRead(binding, input.request, input.actor);
  const timeoutMs = Math.min(
    KAFKA_SOURCE_TIMEOUT_MS,
    Math.max(1, Math.floor(dependencies.timeoutMs ?? KAFKA_SOURCE_TIMEOUT_MS)),
  );
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new KafkaEnterpriseSourceBoundaryError(
          'read-timeout',
          `Kafka source read exceeded ${timeoutMs}ms`,
        ),
      ),
    timeoutMs,
  );
  try {
    const schemaText = await loadExactJsonSchema(
      binding,
      dependencies.fetcher ?? fetch,
      controller.signal,
    );
    const port = (dependencies.portFactory ?? createNativeKafkaEnterpriseSourcePort)(binding);
    const partitions = await port.topicPartitions(binding.topic, controller.signal);
    const windows = resolveKafkaPartitionWindows(
      partitions,
      input.request.params.partitionWindows,
      input.request.limit,
    );
    if (windows.length === 0) {
      throw new KafkaEnterpriseSourceBoundaryError(
        'incomplete-window',
        'The governed Kafka source has no retained records',
      );
    }
    const rawRecords = await port.readWindows({
      topic: binding.topic,
      groupId: kafkaConsumerGroup(binding),
      windows,
      signal: controller.signal,
    });
    if (rawRecords.length > input.request.limit) {
      throw new KafkaEnterpriseSourceBoundaryError(
        'incomplete-window',
        'Kafka source returned more records than the governed read limit',
      );
    }
    let bytesRead = 0;
    const seen = new Set<string>();
    const records = rawRecords.map((raw) => {
      bytesRead += raw.value.length + (raw.key?.length ?? 0);
      if (bytesRead > KAFKA_SOURCE_MAX_BYTES) {
        throw new KafkaEnterpriseSourceBoundaryError(
          'byte-limit-exceeded',
          `Kafka source read exceeded ${KAFKA_SOURCE_MAX_BYTES} bytes`,
        );
      }
      const offset = `${raw.partition}:${raw.offset}`;
      if (seen.has(offset)) {
        throw new KafkaEnterpriseSourceBoundaryError(
          'incomplete-window',
          `Kafka source returned duplicate offset ${offset}`,
        );
      }
      seen.add(offset);
      return decodeSchemaBoundRecord(raw, binding, schemaText);
    });
    const expected = expectedOffsets(windows);
    if (seen.size !== expected.size || [...seen].some((item) => !expected.has(item))) {
      throw new KafkaEnterpriseSourceBoundaryError(
        'incomplete-window',
        'Kafka source did not return the complete governed offset window',
      );
    }
    const correlationId =
      input.request.params.correlationId ?? dependencies.correlationId?.() ?? randomUUID();
    const actorId = input.actor.actorId.trim();
    for (const record of records) {
      record.correlationId = correlationId;
      record.actorId = actorId;
    }
    const consumedAt = (dependencies.now?.() ?? new Date()).toISOString();
    return {
      records: records.sort(
        (left, right) =>
          left.partition - right.partition ||
          (BigInt(left.offset) < BigInt(right.offset)
            ? -1
            : BigInt(left.offset) > BigInt(right.offset)
              ? 1
              : 0),
      ),
      bytesRead,
      provenance: buildKafkaSourceProvenance({
        binding,
        windows,
        correlationId,
        actorId,
        consumedAt,
      }),
    };
  } finally {
    clearTimeout(timeout);
  }
}
