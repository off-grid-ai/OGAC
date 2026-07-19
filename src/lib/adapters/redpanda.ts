import kafkaJs from 'kafkajs';
import {
  buildBfsiStreamContract,
  groupTopics,
  normalizePartitions,
  parseSchema,
  parseTopicCreate,
  parseTopicUpdate,
  requiredName,
  type BfsiStreamJourney,
  type RedpandaBoundary,
  type RedpandaTopicCreate,
  type RedpandaTopicUpdate,
} from '../redpanda-model';

export interface RedpandaConfig {
  adminUrl: string;
  schemaUrl: string | null;
  restUrl: string | null;
  brokers: string[];
  clientId: string;
}

export interface RedpandaOverview {
  boundaries: RedpandaBoundary[];
  cluster: unknown;
  brokers: unknown[];
  topics: ReturnType<typeof groupTopics>;
  subjects: string[];
}

type Fetcher = typeof fetch;
const { ConfigResourceTypes, Kafka, logLevel } = kafkaJs;

export interface NativeKafkaPort {
  listTopics(): Promise<string[]>;
  createTopic(input: RedpandaTopicCreate): Promise<boolean>;
  updateTopic(name: string, input: RedpandaTopicUpdate): Promise<void>;
  deleteTopic(name: string): Promise<void>;
  produce(topic: string, key: string | null, value: Record<string, unknown>): Promise<unknown>;
  consumeMatching(
    topic: string,
    group: string,
    eventId: string,
    timeoutMs: number,
  ): Promise<{ partition: number; offset: string; value: Record<string, unknown> }>;
}

const cleanUrl = (value: string | undefined): string | null =>
  value?.trim().replace(/\/$/, '') || null;

export function resolveRedpandaConfig(env: NodeJS.ProcessEnv = process.env): RedpandaConfig {
  return {
    adminUrl: cleanUrl(env.OFFGRID_REDPANDA_ADMIN_URL) ?? 'http://127.0.0.1:8943',
    schemaUrl: cleanUrl(env.OFFGRID_REDPANDA_SCHEMA_URL),
    restUrl: cleanUrl(env.OFFGRID_REDPANDA_REST_URL),
    brokers: (env.OFFGRID_REDPANDA_BROKERS ?? '')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean),
    clientId: env.OFFGRID_REDPANDA_CLIENT_ID?.trim() || 'offgrid-console',
  };
}

function requireNativeKafka(config: RedpandaConfig): string[] {
  if (config.brokers.length === 0) throw new Error('Redpanda Kafka brokers are not configured');
  return config.brokers;
}

export function createNativeKafkaPort(config: RedpandaConfig): NativeKafkaPort {
  const kafka = new Kafka({
    clientId: config.clientId,
    brokers: requireNativeKafka(config),
    connectionTimeout: 5_000,
    requestTimeout: 10_000,
    retry: { retries: 2 },
    logLevel: logLevel.NOTHING,
  });

  return {
    async listTopics() {
      const admin = kafka.admin();
      await admin.connect();
      try {
        return await admin.listTopics();
      } finally {
        await admin.disconnect();
      }
    },
    async createTopic(input) {
      const admin = kafka.admin();
      await admin.connect();
      try {
        return await admin.createTopics({
          waitForLeaders: true,
          topics: [
            {
              topic: input.name,
              numPartitions: input.partitions,
              replicationFactor: input.replicationFactor,
              configEntries: [{ name: 'retention.ms', value: String(input.retentionMs) }],
            },
          ],
        });
      } finally {
        await admin.disconnect();
      }
    },
    async updateTopic(name, input) {
      const admin = kafka.admin();
      await admin.connect();
      try {
        if (input.partitions !== undefined) {
          const metadata = await admin.fetchTopicMetadata({ topics: [name] });
          const current = metadata.topics[0]?.partitions.length ?? 0;
          if (input.partitions < current) {
            throw new Error(`partitions cannot be reduced below the current count (${current})`);
          }
          if (input.partitions > current) {
            await admin.createPartitions({
              topicPartitions: [{ topic: name, count: input.partitions }],
            });
          }
        }
        if (input.retentionMs !== undefined) {
          await admin.alterConfigs({
            validateOnly: false,
            resources: [
              {
                type: ConfigResourceTypes.TOPIC,
                name,
                configEntries: [{ name: 'retention.ms', value: String(input.retentionMs) }],
              },
            ],
          });
        }
      } finally {
        await admin.disconnect();
      }
    },
    async deleteTopic(name) {
      const admin = kafka.admin();
      await admin.connect();
      try {
        await admin.deleteTopics({ topics: [name], timeout: 10_000 });
      } finally {
        await admin.disconnect();
      }
    },
    async produce(topic, key, value) {
      const producer = kafka.producer({ allowAutoTopicCreation: false });
      await producer.connect();
      try {
        return await producer.send({
          topic,
          messages: [{ key: key ?? undefined, value: JSON.stringify(value) }],
        });
      } finally {
        await producer.disconnect();
      }
    },
    async consumeMatching(topic, group, eventId, timeoutMs) {
      const consumer = kafka.consumer({ groupId: group, allowAutoTopicCreation: false });
      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: true });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let settle:
        | ((value: { partition: number; offset: string; value: Record<string, unknown> }) => void)
        | undefined;
      let rejectMatch: ((reason: Error) => void) | undefined;
      const match = new Promise<{
        partition: number;
        offset: string;
        value: Record<string, unknown>;
      }>((resolve, reject) => {
        settle = resolve;
        rejectMatch = reject;
        timeout = setTimeout(
          () => reject(new Error(`No matching event arrived within ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      const run = consumer
        .run({
          eachMessage: async ({ partition, message }) => {
            if (!message.value) return;
            try {
              const value = JSON.parse(message.value.toString()) as Record<string, unknown>;
              if (value.eventId === eventId) settle?.({ partition, offset: message.offset, value });
            } catch {
              // Another producer may write non-JSON records; they are irrelevant to this proof.
            }
          },
        })
        .catch((error) =>
          rejectMatch?.(error instanceof Error ? error : new Error('consumer failed')),
        );
      try {
        return await match;
      } finally {
        if (timeout) clearTimeout(timeout);
        await consumer.stop().catch(() => undefined);
        await run.catch(() => undefined);
        await consumer.disconnect().catch(() => undefined);
      }
    },
  };
}

async function jsonRequest(fetcher: Fetcher, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetcher(url, { ...init, cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
  if (response.status === 204) return null;
  return response.json();
}

async function inspectBoundary(
  id: RedpandaBoundary['id'],
  url: string | null,
  fetcher: Fetcher,
  path = '/',
): Promise<RedpandaBoundary> {
  if (!url) return { id, state: 'unconfigured', detail: `${id} URL is not configured` };
  try {
    await jsonRequest(fetcher, `${url}${path}`);
    return { id, state: 'ready', detail: 'HTTP boundary responded' };
  } catch (error) {
    return { id, state: 'down', detail: error instanceof Error ? error.message : 'request failed' };
  }
}

export async function getRedpandaOverview(
  config: RedpandaConfig = resolveRedpandaConfig(),
  fetcher: Fetcher = fetch,
  kafkaPort?: NativeKafkaPort,
): Promise<RedpandaOverview> {
  let cluster: unknown = null;
  let brokers: unknown[] = [];
  let topics: ReturnType<typeof groupTopics> = [];
  let subjects: string[] = [];

  const admin = await inspectBoundary(
    'admin',
    config.adminUrl,
    fetcher,
    '/v1/cluster/health_overview',
  );
  if (admin.state === 'ready') {
    cluster = await jsonRequest(fetcher, `${config.adminUrl}/v1/cluster/health_overview`);
    const brokerResult = await jsonRequest(fetcher, `${config.adminUrl}/v1/brokers`);
    brokers = Array.isArray(brokerResult) ? brokerResult : [];
    const partitionResult = await jsonRequest(fetcher, `${config.adminUrl}/v1/partitions`);
    topics = groupTopics(normalizePartitions(partitionResult));
  }

  const schemaRegistry = await inspectBoundary(
    'schemaRegistry',
    config.schemaUrl,
    fetcher,
    '/subjects',
  );
  if (schemaRegistry.state === 'ready' && config.schemaUrl) {
    const result = await jsonRequest(fetcher, `${config.schemaUrl}/subjects`);
    subjects = Array.isArray(result)
      ? result.filter((item): item is string => typeof item === 'string')
      : [];
  }

  const restProxy = await inspectBoundary('restProxy', config.restUrl, fetcher, '/topics');
  let kafka: RedpandaBoundary;
  if (config.brokers.length === 0) {
    kafka = { id: 'kafka', state: 'unconfigured', detail: 'Kafka brokers are not configured' };
  } else {
    try {
      await (kafkaPort ?? createNativeKafkaPort(config)).listTopics();
      kafka = { id: 'kafka', state: 'ready', detail: 'Native Kafka protocol responded' };
    } catch (error) {
      kafka = {
        id: 'kafka',
        state: 'down',
        detail: error instanceof Error ? error.message : 'request failed',
      };
    }
  }
  return {
    boundaries: [admin, schemaRegistry, kafka, restProxy],
    cluster,
    brokers,
    topics,
    subjects,
  };
}

export async function createTopic(
  value: unknown,
  config = resolveRedpandaConfig(),
  kafkaPort: NativeKafkaPort = createNativeKafkaPort(config),
) {
  const topic = parseTopicCreate(value);
  return { created: await kafkaPort.createTopic(topic), topic };
}

export async function updateTopic(
  topicValue: unknown,
  value: unknown,
  config = resolveRedpandaConfig(),
  kafkaPort: NativeKafkaPort = createNativeKafkaPort(config),
) {
  const topic = requiredName(topicValue, 'topic');
  const update = parseTopicUpdate(value);
  await kafkaPort.updateTopic(topic, update);
  return { topic, update };
}

export async function deleteTopic(
  topicValue: unknown,
  confirmationValue: unknown,
  config = resolveRedpandaConfig(),
  kafkaPort: NativeKafkaPort = createNativeKafkaPort(config),
) {
  const topic = requiredName(topicValue, 'topic');
  if (confirmationValue !== topic)
    throw new Error('confirmation must exactly match the topic name');
  await kafkaPort.deleteTopic(topic);
  return { deleted: topic };
}

export async function createSchemaVersion(
  subjectValue: unknown,
  value: unknown,
  config = resolveRedpandaConfig(),
  fetcher: Fetcher = fetch,
) {
  if (!config.schemaUrl) throw new Error('Redpanda Schema Registry is not configured');
  const subject = requiredName(subjectValue, 'subject');
  const body = parseSchema(value);
  return jsonRequest(
    fetcher,
    `${config.schemaUrl}/subjects/${encodeURIComponent(subject)}/versions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.schemaregistry.v1+json' },
      body: JSON.stringify(body),
    },
  );
}

export async function deleteSchemaSubject(
  subjectValue: unknown,
  confirmationValue: unknown,
  config = resolveRedpandaConfig(),
  fetcher: Fetcher = fetch,
) {
  if (!config.schemaUrl) throw new Error('Redpanda Schema Registry is not configured');
  const subject = requiredName(subjectValue, 'subject');
  if (confirmationValue !== subject) {
    throw new Error('confirmation must exactly match the schema subject');
  }
  return jsonRequest(fetcher, `${config.schemaUrl}/subjects/${encodeURIComponent(subject)}`, {
    method: 'DELETE',
  });
}

export async function getSchemaSubject(
  subjectValue: unknown,
  config = resolveRedpandaConfig(),
  fetcher: Fetcher = fetch,
) {
  if (!config.schemaUrl) throw new Error('Redpanda Schema Registry is not configured');
  const subject = requiredName(subjectValue, 'subject');
  const rawVersions = await jsonRequest(
    fetcher,
    `${config.schemaUrl}/subjects/${encodeURIComponent(subject)}/versions`,
  );
  const versions = Array.isArray(rawVersions)
    ? rawVersions.filter((version): version is number => Number.isInteger(version) && version > 0)
    : [];
  const details = await Promise.all(
    versions.map((version) =>
      jsonRequest(
        fetcher,
        `${config.schemaUrl}/subjects/${encodeURIComponent(subject)}/versions/${version}`,
      ),
    ),
  );
  return { subject, versions, details };
}

export async function deleteSchemaVersion(
  subjectValue: unknown,
  versionValue: unknown,
  config = resolveRedpandaConfig(),
  fetcher: Fetcher = fetch,
) {
  if (!config.schemaUrl) throw new Error('Redpanda Schema Registry is not configured');
  const subject = requiredName(subjectValue, 'subject');
  const version = requiredName(versionValue, 'version');
  if (!/^\d+$/.test(version)) throw new Error('version must be a positive integer');
  return jsonRequest(
    fetcher,
    `${config.schemaUrl}/subjects/${encodeURIComponent(subject)}/versions/${version}`,
    { method: 'DELETE' },
  );
}

export async function produceRecord(
  value: unknown,
  config = resolveRedpandaConfig(),
  kafkaPort: NativeKafkaPort = createNativeKafkaPort(config),
) {
  if (!value || typeof value !== 'object') throw new Error('produce body is required');
  const body = value as Record<string, unknown>;
  const topic = requiredName(body.topic, 'topic');
  if (!Object.hasOwn(body, 'value')) throw new Error('value is required');
  if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
    throw new Error('value must be a JSON object');
  }
  const key = typeof body.key === 'string' ? body.key : null;
  return kafkaPort.produce(topic, key, body.value as Record<string, unknown>);
}

export async function consumeRecords(
  value: unknown,
  config = resolveRedpandaConfig(),
  kafkaPort: NativeKafkaPort = createNativeKafkaPort(config),
) {
  if (!value || typeof value !== 'object') throw new Error('consumer body is required');
  const body = value as Record<string, unknown>;
  const group = requiredName(body.group, 'group');
  const topic = requiredName(body.topic, 'topic');
  const eventId = requiredName(body.eventId, 'eventId');
  return kafkaPort.consumeMatching(topic, group, eventId, 10_000);
}

export async function runBfsiStreamJourney(
  journey: BfsiStreamJourney,
  config = resolveRedpandaConfig(),
  kafkaPort: NativeKafkaPort = createNativeKafkaPort(config),
  fetcher: Fetcher = fetch,
) {
  const eventId = `offgrid-${journey}-${crypto.randomUUID()}`;
  const contract = buildBfsiStreamContract(journey, eventId);
  const topics = await kafkaPort.listTopics();
  if (!topics.includes(contract.topic)) {
    await kafkaPort.createTopic({
      name: contract.topic,
      partitions: 1,
      replicationFactor: 1,
      retentionMs: 7 * 24 * 60 * 60 * 1_000,
    });
  }
  const schema = await createSchemaVersion(contract.subject, contract, config, fetcher);
  const group = `${config.clientId}-${journey}-${eventId.slice(-12)}`;
  const consumedPromise = kafkaPort.consumeMatching(contract.topic, group, eventId, 12_000);
  const produced = await kafkaPort.produce(contract.topic, eventId, contract.sample);
  const consumed = await consumedPromise;
  return {
    journey,
    eventId,
    topic: contract.topic,
    subject: contract.subject,
    schema,
    produced,
    consumed,
    verifiedAt: new Date().toISOString(),
  };
}
