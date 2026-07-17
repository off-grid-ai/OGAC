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
  id: 'admin' | 'schemaRegistry' | 'restProxy';
  state: BoundaryState;
  detail: string;
}

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

function numberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number');
}

export function normalizePartitions(value: unknown): RedpandaPartition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const namespace =
      typeof row.ns === 'string'
        ? row.ns
        : typeof row.namespace === 'string'
          ? row.namespace
          : null;
    const topic = typeof row.topic === 'string' ? row.topic : null;
    const partition =
      typeof row.partition_id === 'number'
        ? row.partition_id
        : typeof row.partition === 'number'
          ? row.partition
          : null;
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
      leaders: [...topic.leaders].sort(),
      replicas: [...topic.replicas].sort(),
    }))
    .sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
}
