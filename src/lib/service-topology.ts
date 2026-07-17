import type { ServiceEntry } from './service-entry';

export const READINESS_GATES = [
  'deployed',
  'reachable',
  'functional',
  'seeded',
  'console-used',
] as const;

export type ReadinessGate = (typeof READINESS_GATES)[number];
export type ReadinessState = 'pass' | 'fail' | 'unknown' | 'not-applicable';

export interface ReadinessEvidence {
  gate: ReadinessGate;
  state: ReadinessState;
  summary: string;
  source: string;
  observedAt?: string;
}

export interface ServiceEndpoint {
  id: string;
  label: string;
  url: string;
  purpose: string;
  scope: 'public' | 'lan' | 'loopback' | 'in-process';
}

export interface ServiceInstance {
  id: string;
  label: string;
  nodeId: string | null;
  endpoints: ServiceEndpoint[];
  readiness: ReadinessEvidence[];
}

export interface ServiceComponent {
  id: string;
  label: string;
  role: string;
  instances: ServiceInstance[];
  readiness: ReadinessEvidence[];
}

export interface ServiceDependency {
  serviceId: string;
  purpose: string;
  required: boolean;
}

export interface LogicalServiceTopology {
  service: ServiceEntry;
  components: ServiceComponent[];
  dependencies: ServiceDependency[];
  readiness: ReadinessEvidence[];
}

export type ReadinessSummary = Record<ReadinessGate, ReadinessState>;

const STATE_PRIORITY: Record<Exclude<ReadinessState, 'not-applicable'>, number> = {
  fail: 3,
  unknown: 2,
  pass: 1,
};

/**
 * Aggregate evidence without overstating readiness. A failure dominates; missing or mixed evidence
 * remains unknown; a gate passes only when every applicable observation passes.
 */
export function aggregateGate(evidence: readonly ReadinessEvidence[]): ReadinessState {
  const applicable = evidence.filter((item) => item.state !== 'not-applicable');
  if (applicable.length === 0) return 'not-applicable';
  return applicable.reduce<Exclude<ReadinessState, 'not-applicable'>>(
    (current, item) =>
      STATE_PRIORITY[item.state as Exclude<ReadinessState, 'not-applicable'>] >
      STATE_PRIORITY[current]
        ? (item.state as Exclude<ReadinessState, 'not-applicable'>)
        : current,
    'pass',
  );
}

export function collectReadiness(topology: LogicalServiceTopology): ReadinessEvidence[] {
  return [
    ...topology.readiness,
    ...topology.components.flatMap((component) => [
      ...component.readiness,
      ...component.instances.flatMap((instance) => instance.readiness),
    ]),
  ];
}

export function summarizeReadiness(topology: LogicalServiceTopology): ReadinessSummary {
  const evidence = collectReadiness(topology);
  return Object.fromEntries(
    READINESS_GATES.map((gate) => [
      gate,
      aggregateGate(evidence.filter((item) => item.gate === gate)),
    ]),
  ) as ReadinessSummary;
}

export function countInstances(topology: LogicalServiceTopology): number {
  return topology.components.reduce((total, component) => total + component.instances.length, 0);
}

