export type BoundaryState = 'ready' | 'down' | 'unconfigured';

export interface RedpandaPartition {
  namespace: string;
  topic: string;
  partition: number;
  leaderId: number | null;
  replicas: number[];
}

export interface RedpandaTopic {
  namespace: string;
  name: string;
  partitions: number;
  leaders: number[];
  replicas: number[];
}

export interface RedpandaBoundary {
  id: 'admin' | 'schemaRegistry' | 'kafka' | 'restProxy';
  state: BoundaryState;
  detail: string;
}

export interface RedpandaTopicCreate {
  name: string;
  partitions: number;
  replicationFactor: number;
  retentionMs: number;
}

export interface RedpandaTopicUpdate {
  partitions?: number;
  retentionMs?: number;
}

export type BfsiStreamJourney = 'lender-delinquency' | 'insurance-claim';

export interface BfsiStreamContract {
  journey: BfsiStreamJourney;
  topic: string;
  subject: string;
  schemaType: 'JSON';
  schema: string;
  sample: Record<string, unknown>;
}

const MAX_PARTITIONS = 48;
const MAX_REPLICATION = 3;
const MIN_RETENTION_MS = 60_000;
const MAX_RETENTION_MS = 31 * 24 * 60 * 60 * 1_000;

export function requiredName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  const normalized = value.trim();
  if (normalized.length > 249) throw new Error(`${label} must be 249 characters or fewer`);
  return normalized;
}

export function parseSchema(value: unknown): {
  schema: string;
  schemaType: 'AVRO' | 'JSON' | 'PROTOBUF';
} {
  if (!value || typeof value !== 'object') throw new Error('schema body is required');
  const body = value as Record<string, unknown>;
  const schema = requiredName(body.schema, 'schema');
  const rawType = typeof body.schemaType === 'string' ? body.schemaType.toUpperCase() : 'AVRO';
  if (!['AVRO', 'JSON', 'PROTOBUF'].includes(rawType))
    throw new Error('schemaType must be AVRO, JSON, or PROTOBUF');
  return { schema, schemaType: rawType as 'AVRO' | 'JSON' | 'PROTOBUF' };
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return Number(value);
}

export function parseTopicCreate(value: unknown): RedpandaTopicCreate {
  if (!value || typeof value !== 'object') throw new Error('topic body is required');
  const body = value as Record<string, unknown>;
  return {
    name: requiredName(body.name, 'topic'),
    partitions: boundedInteger(body.partitions ?? 1, 'partitions', 1, MAX_PARTITIONS),
    replicationFactor: boundedInteger(
      body.replicationFactor ?? 1,
      'replicationFactor',
      1,
      MAX_REPLICATION,
    ),
    retentionMs: boundedInteger(
      body.retentionMs ?? 7 * 24 * 60 * 60 * 1_000,
      'retentionMs',
      MIN_RETENTION_MS,
      MAX_RETENTION_MS,
    ),
  };
}

export function parseTopicUpdate(value: unknown): RedpandaTopicUpdate {
  if (!value || typeof value !== 'object') throw new Error('topic update body is required');
  const body = value as Record<string, unknown>;
  const update: RedpandaTopicUpdate = {};
  if (body.partitions !== undefined) {
    update.partitions = boundedInteger(body.partitions, 'partitions', 1, MAX_PARTITIONS);
  }
  if (body.retentionMs !== undefined) {
    update.retentionMs = boundedInteger(
      body.retentionMs,
      'retentionMs',
      MIN_RETENTION_MS,
      MAX_RETENTION_MS,
    );
  }
  if (update.partitions === undefined && update.retentionMs === undefined) {
    throw new Error('partitions or retentionMs is required');
  }
  return update;
}

const JOURNEY_CONTRACTS: Record<BfsiStreamJourney, Omit<BfsiStreamContract, 'sample'>> = {
  'lender-delinquency': {
    journey: 'lender-delinquency',
    topic: 'lender.delinquency-events',
    subject: 'lender.delinquency-events-value',
    schemaType: 'JSON',
    schema: JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['eventId', 'loanId', 'daysPastDue', 'currency'],
      properties: {
        eventId: { type: 'string' },
        loanId: { type: 'string' },
        daysPastDue: { type: 'integer', minimum: 0 },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
      },
    }),
  },
  'insurance-claim': {
    journey: 'insurance-claim',
    topic: 'insurance.claim-events',
    subject: 'insurance.claim-events-value',
    schemaType: 'JSON',
    schema: JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['eventId', 'claimId', 'policyId', 'estimatedIndemnity', 'currency'],
      properties: {
        eventId: { type: 'string' },
        claimId: { type: 'string' },
        policyId: { type: 'string' },
        estimatedIndemnity: { type: 'number', minimum: 0 },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
      },
    }),
  },
};

export function buildBfsiStreamContract(
  journeyValue: unknown,
  eventId: string,
): BfsiStreamContract {
  if (journeyValue !== 'lender-delinquency' && journeyValue !== 'insurance-claim') {
    throw new Error('journey must be lender-delinquency or insurance-claim');
  }
  const base = JOURNEY_CONTRACTS[journeyValue];
  const sample =
    journeyValue === 'lender-delinquency'
      ? { eventId, loanId: 'loan-demo-001', daysPastDue: 45, currency: 'INR' }
      : {
          eventId,
          claimId: 'claim-demo-001',
          policyId: 'policy-demo-001',
          estimatedIndemnity: 125000,
          currency: 'INR',
        };
  return { ...base, sample };
}

function numberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number');
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export function normalizePartitions(value: unknown): RedpandaPartition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const namespace = optionalString(row.ns) ?? optionalString(row.namespace);
    const topic = optionalString(row.topic);
    const partition = optionalNumber(row.partition_id) ?? optionalNumber(row.partition);
    if (namespace === null || topic === null || partition === null) return [];
    const replicas = Array.isArray(row.replicas)
      ? row.replicas.flatMap((replica) => {
          if (typeof replica === 'number') return [replica];
          if (
            replica &&
            typeof replica === 'object' &&
            typeof (replica as Record<string, unknown>).node_id === 'number'
          ) {
            return [(replica as Record<string, number>).node_id];
          }
          return [];
        })
      : numberList(row.replica_ids);
    return [
      {
        namespace,
        topic,
        partition,
        leaderId: typeof row.leader_id === 'number' ? row.leader_id : null,
        replicas,
      },
    ];
  });
}

export function groupTopics(partitions: RedpandaPartition[]): RedpandaTopic[] {
  const topics = new Map<
    string,
    {
      namespace: string;
      name: string;
      partitions: number;
      leaders: Set<number>;
      replicas: Set<number>;
    }
  >();
  for (const partition of partitions) {
    const key = `${partition.namespace}\0${partition.topic}`;
    const current = topics.get(key) ?? {
      namespace: partition.namespace,
      name: partition.topic,
      partitions: 0,
      leaders: new Set<number>(),
      replicas: new Set<number>(),
    };
    current.partitions += 1;
    if (partition.leaderId !== null) current.leaders.add(partition.leaderId);
    partition.replicas.forEach((replica) => current.replicas.add(replica));
    topics.set(key, current);
  }
  return [...topics.values()]
    .map((topic) => ({
      ...topic,
      leaders: [...topic.leaders].sort((a, b) => a - b),
      replicas: [...topic.replicas].sort((a, b) => a - b),
    }))
    .sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
}
