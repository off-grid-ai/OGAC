import {
  groupTopics,
  normalizePartitions,
  parseSchema,
  requiredName,
  type RedpandaBoundary,
} from '../redpanda-model';

export interface RedpandaConfig {
  adminUrl: string;
  schemaUrl: string | null;
  restUrl: string | null;
}

export interface RedpandaOverview {
  boundaries: RedpandaBoundary[];
  cluster: unknown;
  brokers: unknown[];
  topics: ReturnType<typeof groupTopics>;
  subjects: string[];
}

type Fetcher = typeof fetch;

const cleanUrl = (value: string | undefined): string | null =>
  value?.trim().replace(/\/$/, '') || null;

export function resolveRedpandaConfig(env: NodeJS.ProcessEnv = process.env): RedpandaConfig {
  return {
    adminUrl: cleanUrl(env.OFFGRID_REDPANDA_ADMIN_URL) ?? 'http://127.0.0.1:8943',
    schemaUrl: cleanUrl(env.OFFGRID_REDPANDA_SCHEMA_URL),
    restUrl: cleanUrl(env.OFFGRID_REDPANDA_REST_URL),
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
  return { boundaries: [admin, schemaRegistry, restProxy], cluster, brokers, topics, subjects };
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
  config = resolveRedpandaConfig(),
  fetcher: Fetcher = fetch,
) {
  if (!config.schemaUrl) throw new Error('Redpanda Schema Registry is not configured');
  const subject = requiredName(subjectValue, 'subject');
  return jsonRequest(fetcher, `${config.schemaUrl}/subjects/${encodeURIComponent(subject)}`, {
    method: 'DELETE',
  });
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
  fetcher: Fetcher = fetch,
) {
  if (!config.restUrl) throw new Error('Redpanda REST Proxy is not configured');
  if (!value || typeof value !== 'object') throw new Error('produce body is required');
  const body = value as Record<string, unknown>;
  const topic = requiredName(body.topic, 'topic');
  if (!Object.hasOwn(body, 'value')) throw new Error('value is required');
  const record = Object.hasOwn(body, 'key')
    ? { key: body.key, value: body.value }
    : { value: body.value };
  return jsonRequest(fetcher, `${config.restUrl}/topics/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/vnd.kafka.json.v2+json' },
    body: JSON.stringify({ records: [record] }),
  });
}

export async function consumeRecords(
  value: unknown,
  config = resolveRedpandaConfig(),
  fetcher: Fetcher = fetch,
) {
  if (!config.restUrl) throw new Error('Redpanda REST Proxy is not configured');
  if (!value || typeof value !== 'object') throw new Error('consumer body is required');
  const body = value as Record<string, unknown>;
  const group = requiredName(body.group, 'group');
  const topic = requiredName(body.topic, 'topic');
  const created = (await jsonRequest(
    fetcher,
    `${config.restUrl}/consumers/${encodeURIComponent(group)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.kafka.v2+json' },
      body: JSON.stringify({ format: 'json', 'auto.offset.reset': 'earliest' }),
    },
  )) as Record<string, unknown>;
  const instanceId = requiredName(created.instance_id, 'consumer instance');
  const baseUri =
    typeof created.base_uri === 'string'
      ? created.base_uri
      : `${config.restUrl}/consumers/${encodeURIComponent(group)}/instances/${encodeURIComponent(instanceId)}`;
  try {
    await jsonRequest(fetcher, `${baseUri}/subscription`, {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.kafka.v2+json' },
      body: JSON.stringify({ topics: [topic] }),
    });
    const records = await jsonRequest(fetcher, `${baseUri}/records`, {
      headers: { accept: 'application/vnd.kafka.json.v2+json' },
    });
    return { instanceId, records };
  } finally {
    await fetcher(baseUri, { method: 'DELETE', cache: 'no-store' }).catch(() => undefined);
  }
}
