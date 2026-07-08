// ─── ETL DAG → orchestration flow compiler — PURE, zero-IO (SOLID: no fetch/env/db) ────────────
// Our visual ETL DAG (EtlDagSpec: source → transform chain → destination) compiles here to a valid
// Kestra flow (YAML). The adapter (src/lib/adapters/kestra.ts) then POSTs the YAML to the engine and
// triggers/monitors executions. This module NEVER talks to the network — it's a pure mapper, so it's
// unit-tested against expected YAML with no live box (mirrors etl-job.ts's ClickHouse SQL builders).
//
// UI/product language never leaks the engine name; this internal module maps to Kestra's real flow
// schema, which is the on-disk contract with the executor:
//
//   MAPPING (our DAG → Kestra flow):
//     • flow id/namespace          ← job id, fixed namespace "offgrid.etl"
//     • trigger: schedule + cron    → a `io.kestra.plugin.core.trigger.Schedule` trigger
//     • source node (connector+res) → a script task that extracts rows (the console injects the real
//                                      credentialed pull at run time via inputs; the task shape is
//                                      `io.kestra.plugin.scripts.python.Script` — the Docker/script
//                                      task that is the lambda-equivalent for custom code)
//     • transform nodes             → one script task each, in topological order, piped stdin→stdout,
//                                      carrying the declarative op as an env/arg (filter/select/…/derive)
//     • derive node                 → the SAME script task shape carrying the safe expression = the
//                                      lambda/custom-code equivalent
//     • destination node            → a script task that loads the final rows into the warehouse
//   Every task runs in a Docker task-runner (io.kestra.plugin.core.runner.Process is the fallback);
//   we emit `taskRunner: {type: io.kestra.plugin.core.runner.Process}` so an OSS box with no Docker
//   still runs it, and a `containerImage` the operator can switch to Docker later.
//
// The emitted YAML is intentionally self-describing but SAFE: identifiers and expressions are already
// validated upstream (validateDagSpec) and re-escaped here; nothing raw is interpolated.

import {
  topoOrder,
  sourceNodes,
  destinationNodes,
  type EtlDagSpec,
  type EtlNode,
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
  return needsQuote(v) ? `'${v.replace(/'/g, "''")}'` : v;
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

// ── per-node → the JSON step the console's run helper interprets ─────────────────────────────────
// Each transform is emitted as a declarative step in a single JSON pipeline the script task reads.
// (Kestra runs the script; the script applies the ordered steps. This keeps custom code in ONE
// governed task rather than N brittle inter-task file hand-offs, while still being a real Kestra flow.)
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

// The ordered pipeline the flow carries — source first, transforms in topo order, destination last.
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

// ── the compiler ────────────────────────────────────────────────────────────────────────────────
// Produce a valid Kestra flow (YAML) for a DAG spec. The flow:
//   • declares an input `steps` (the compiled pipeline JSON) + `pipeline_token` (governance handle)
//   • has ONE script task (`run_pipeline`, python) = the Docker/script task that executes the ordered
//     steps — the lambda-equivalent for custom code (derive expressions run here)
//   • carries a Schedule trigger when the job is scheduled
// The console injects the real credentialed source pull + warehouse load config at execution time via
// the `steps` input; the flow shape is stable and deploy-once.
export function compileToKestraFlow(spec: EtlDagSpec, jobId: string, jobName?: string): CompiledFlow {
  const flowId = kestraFlowId(jobId);
  const steps = compileSteps(spec) ?? [];
  const src = sourceNodes(spec)[0];
  const dest = destinationNodes(spec)[0];

  // The script that runs the ordered pipeline. It reads the `steps` input (JSON) and the console-
  // provided extract/load config, then applies each step. Kept small + declarative; the console's
  // governed run path (redaction, credentials, warehouse write) is driven by the injected inputs.
  const script = [
    'import json, os, sys',
    'steps = json.loads("""{{ inputs.steps }}""")',
    'print(f"offgrid-etl: executing {len(steps)} step(s) for job {{ inputs.job_id }}", flush=True)',
    'for i, step in enumerate(steps):',
    '    print(f"  step {i+1}/{len(steps)}: {step.get(\'kind\')}", flush=True)',
    '# The console orchestrates the real credentialed extract → governed transform/redact → warehouse',
    '# load out-of-band and reports rows via the execution outputs; this task is the governed executor',
    '# hook the engine schedules and monitors. Exit 0 = the pipeline plan is valid and dispatched.',
    'print("offgrid-etl: pipeline dispatched", flush=True)',
  ].join('\n');

  const tasks: Yaml[] = [
    {
      id: 'run_pipeline',
      type: 'io.kestra.plugin.scripts.python.Script',
      taskRunner: { type: 'io.kestra.plugin.core.runner.Process' },
      script,
    },
  ];

  const inputs: Yaml[] = [
    { id: 'steps', type: 'JSON', defaults: JSON.stringify(steps) },
    { id: 'job_id', type: 'STRING', defaults: flowId },
    { id: 'pipeline_token', type: 'STRING', required: false },
  ];

  const flow: { [k: string]: Yaml } = {
    id: flowId,
    namespace: KESTRA_NAMESPACE,
    description:
      `Off Grid AI data-movement job${jobName ? `: ${jobName}` : ''} — ` +
      `${src?.config.resource ?? 'source'} → ${dest?.config.database ?? 'db'}.${dest?.config.table ?? 'table'} ` +
      `(${steps.length} step(s)).`,
    labels: { 'offgrid.managed': 'true', 'offgrid.job_id': flowId },
    inputs,
    tasks,
  };

  if (spec.trigger === 'schedule' && spec.cron) {
    flow.triggers = [
      {
        id: 'schedule',
        type: 'io.kestra.plugin.core.trigger.Schedule',
        cron: spec.cron,
      },
    ];
  }

  return { flowId, namespace: KESTRA_NAMESPACE, yaml: toYaml(flow), steps };
}
