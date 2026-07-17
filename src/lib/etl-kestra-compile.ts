// ─── ETL DAG → orchestration flow compiler — PURE, zero-IO (SOLID: no fetch/env/db) ────────────
// Managed ETL blueprints compile here to valid Kestra YAML. Generic visual DAGs retain their pure
// step compiler for validation/export, but deliberately do not compile to a fake remote executor:
// the store runs those through its real governed direct-copy engine until every node kind has a real
// Kestra implementation. This module is pure and never talks to the network.

import {
  topoOrder,
  type EtlDagSpec,
  type EtlNode,
  type EtlTriggerMode,
  type ManagedEtlBlueprint,
} from './etl-job';

export const KESTRA_NAMESPACE = 'offgrid.etl';

// ── minimal YAML emitter (dependency-free, deterministic) ───────────────────────────────────────
// Emits a canonical subset: maps, lists, scalars. Strings that need quoting (contain special chars)
// are single-quoted with '' escaping. Multiline scripts use the literal block scalar (|). This is
// enough for a Kestra flow and keeps the output diffable/unit-testable.
type Yaml = string | number | boolean | null | Yaml[] | { [k: string]: Yaml };

function needsQuote(s: string): boolean {
  if (s === '') return true;
  if (/^[\s]|[\s]$/.test(s)) return true;
  if (/[:#{}\[\],&*!|>'"%@`]/.test(s)) return true;
  if (/^(true|false|null|yes|no|~)$/i.test(s)) return true;
  if (/^[-?]/.test(s)) return true;
  if (/^\d/.test(s) && /^[\d.eE+-]+$/.test(s)) return true; // looks numeric
  return false;
}

function scalar(v: string | number | boolean | null): string {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v.includes('\n')) return ''; // handled by caller as a block scalar
  return needsQuote(v) ? `'${v.replaceAll("'", "''")}'` : v;
}

function emit(node: Yaml, indent: number): string[] {
  const pad = '  '.repeat(indent);
  if (Array.isArray(node)) {
    if (node.length === 0) return [`${pad}[]`];
    const lines: string[] = [];
    for (const item of node) {
      if (item !== null && typeof item === 'object') {
        const sub = emit(item, indent + 1);
        // hoist the first child onto the "- " marker line
        const firstContent = sub[0].slice((indent + 1) * 2);
        lines.push(`${pad}- ${firstContent}`);
        for (const l of sub.slice(1)) lines.push(l);
      } else {
        lines.push(`${pad}- ${scalar(item as string | number | boolean | null)}`);
      }
    }
    return lines;
  }
  if (node !== null && typeof node === 'object') {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(node)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        if (v.length === 0) {
          lines.push(`${pad}${k}: []`);
        } else {
          lines.push(`${pad}${k}:`);
          lines.push(...emit(v, indent));
        }
      } else if (v !== null && typeof v === 'object') {
        lines.push(`${pad}${k}:`);
        lines.push(...emit(v, indent + 1));
      } else if (typeof v === 'string' && v.includes('\n')) {
        lines.push(`${pad}${k}: |`);
        for (const l of v.replace(/\n$/, '').split('\n')) lines.push(`${pad}  ${l}`);
      } else {
        lines.push(`${pad}${k}: ${scalar(v as string | number | boolean | null)}`);
      }
    }
    return lines;
  }
  return [`${pad}${scalar(node as string | number | boolean | null)}`];
}

export function toYaml(node: Yaml): string {
  return emit(node, 0).join('\n') + '\n';
}

// ── flow-id sanitizer ────────────────────────────────────────────────────────────────────────
// Kestra flow ids must match [a-zA-Z0-9._-]+. Our job ids (etl_xxxx) qualify, but sanitize defensively.
export function kestraFlowId(jobId: string): string {
  const cleaned = String(jobId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'etl_job';
}

// ── per-node → portable declarative step ────────────────────────────────────────────────────────
// The builder/export path keeps this deterministic representation while generic execution remains
// in the real governed direct-copy engine.
export interface CompiledStep {
  kind: string;
  [k: string]: unknown;
}

export function nodeToStep(n: EtlNode): CompiledStep {
  const c = n.config;
  switch (n.kind) {
    case 'source':
      return { kind: 'source', connectorId: c.connectorId, resource: c.resource };
    case 'filter':
      return { kind: 'filter', column: c.column, op: c.op, value: c.value ?? '' };
    case 'select':
      return { kind: 'select', columns: c.columns ?? [] };
    case 'rename':
      return { kind: 'rename', from: c.from, to: c.to };
    case 'cast':
      return { kind: 'cast', column: c.column, castType: c.castType };
    case 'derive':
      return { kind: 'derive', target: c.target, expression: c.expression };
    case 'redact':
      return { kind: 'redact', column: c.column, action: c.action, keepLast: c.keepLast ?? 4 };
    case 'join':
      return {
        kind: 'join',
        joinConnectorId: c.joinConnectorId,
        joinResource: c.joinResource,
        leftKey: c.leftKey,
        rightKey: c.rightKey,
      };
    case 'aggregate':
      return {
        kind: 'aggregate',
        groupBy: c.groupBy ?? [],
        aggFn: c.aggFn,
        aggColumn: c.aggColumn,
        aggAlias: c.aggAlias ?? `${c.aggFn}_${c.aggColumn ?? 'rows'}`,
      };
    case 'dedupe':
      return { kind: 'dedupe', columns: c.columns ?? [] };
    case 'limit':
      return { kind: 'limit', limit: Number(c.limit) };
    case 'destination':
      return { kind: 'destination', database: c.database, table: c.table };
    default:
      return { kind: String(n.kind) };
  }
}

// The ordered portable pipeline — source first, transforms in topo order, destination last.
// Returns null when the DAG can't be linearized (validateDagSpec catches this first).
export function compileSteps(spec: EtlDagSpec): CompiledStep[] | null {
  const order = topoOrder(spec);
  if (!order) return null;
  return order.map(nodeToStep);
}

export interface CompiledFlow {
  flowId: string;
  namespace: string;
  yaml: string;
  steps: CompiledStep[];
}

// Compile a reviewed, product-owned business workflow. Runtime credentials remain Kestra secrets;
// the Console supplies only correlation ids. DDL is deliberately absent: the audit table belongs to
// the fleet migration, while this least-privilege flow can only read source columns and append/read
// its audit outcome.
export function compileManagedBlueprintToKestraFlow(
  blueprint: ManagedEtlBlueprint,
  jobId: string,
  jobName: string,
  trigger: EtlTriggerMode,
  cron?: string,
): CompiledFlow {
  if (blueprint !== 'bfsi-delinquency-snapshot') {
    throw new Error(`Unsupported managed ETL blueprint: ${blueprint}`);
  }
  const flowId = kestraFlowId(jobId);
  const tasks: Yaml[] = [
    {
      id: 'materialize_snapshot',
      type: 'io.kestra.plugin.jdbc.clickhouse.Query',
      sql: [
        'INSERT INTO bfsi.delinquency_orchestration_audit',
        'SELECT',
        "  '{{ inputs.console_job_id }}',",
        "  '{{ inputs.console_run_id }}',",
        "  '{{ execution.id }}',",
        '  now64(3),',
        '  count(),',
        '  toDecimal128(sum(principal_inr), 2),',
        "  'bfsi.fact_loan',",
        "  'bfsi-delinquency-snapshot'",
        'FROM bfsi.fact_loan',
        "WHERE dpd > 30 AND status != 'closed'",
      ].join('\n'),
    },
    {
      id: 'verify_persisted_outcome',
      type: 'io.kestra.plugin.jdbc.clickhouse.Query',
      fetchType: 'FETCH_ONE',
      sql: [
        'SELECT delinquent_loans, principal_exposure_inr',
        'FROM bfsi.delinquency_orchestration_audit FINAL',
        "WHERE console_job_id = '{{ inputs.console_job_id }}'",
        "  AND console_run_id = '{{ inputs.console_run_id }}'",
        "  AND execution_id = '{{ execution.id }}'",
        'LIMIT 1',
      ].join('\n'),
    },
    {
      id: 'business_audit_log',
      type: 'io.kestra.plugin.core.log.Log',
      message:
        'Delinquency snapshot persisted: run={{ inputs.console_run_id }}, execution={{ execution.id }}, ' +
        'loans={{ outputs.verify_persisted_outcome.row.delinquent_loans }}, ' +
        'exposure_inr={{ outputs.verify_persisted_outcome.row.principal_exposure_inr }}.',
    },
  ];
  const flow: { [k: string]: Yaml } = {
    id: flowId,
    namespace: KESTRA_NAMESPACE,
    description: `${jobName} — Console-owned, execution-linked collections outcome.`,
    labels: {
      'offgrid.managed': 'true',
      'offgrid.job_id': flowId,
      'offgrid.blueprint': blueprint,
      'business.outcome': 'collections-effectiveness',
    },
    inputs: [
      { id: 'console_job_id', type: 'STRING', defaults: flowId },
      { id: 'console_run_id', type: 'STRING', required: true },
    ],
    tasks,
    pluginDefaults: [
      {
        type: 'io.kestra.plugin.jdbc.clickhouse.Query',
        values: {
          url: 'jdbc:clickhouse://host.docker.internal:8124/bfsi',
          username: '{{ envs.clickhouse_user }}',
          password: "{{ secret('CLICKHOUSE_PASSWORD') }}",
          connectionPooling: true,
          timeZoneId: 'Asia/Kolkata',
        },
      },
    ],
  };
  if (trigger === 'schedule' && cron) {
    flow.triggers = [
      {
        id: 'daily_collections_snapshot',
        type: 'io.kestra.plugin.core.trigger.Schedule',
        cron,
        timezone: 'Asia/Kolkata',
        disabled: false,
      },
    ];
  }
  return { flowId, namespace: KESTRA_NAMESPACE, yaml: toYaml(flow), steps: [] };
}
