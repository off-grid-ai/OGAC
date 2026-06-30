// Studio introspection: project everything the platform has — connectors, data sources,
// tools, guardrails, models, agents — into a flat catalog of "blocks" the agent-builder
// canvas can render as nodes. The hard parts (pipeline, sandbox, grounding) already exist;
// this just surfaces what's available so an NL request can be wired against it.
import { AGENTS } from './agents';
import { getOrgPolicy, listConnectors, listDatasets, listTools } from './store';

export type BlockGroup = 'Connector' | 'Data' | 'Tool' | 'Guardrail' | 'Model' | 'Agent';

export interface Block {
  id: string; // e.g. "connector:conn_01"
  group: BlockGroup;
  label: string;
  sub?: string;
  meta?: Record<string, string | number | boolean>;
}

export interface Catalog {
  blocks: Block[];
  counts: Record<BlockGroup, number>;
}

export async function introspect(): Promise<Catalog> {
  const [connectors, datasets, tools, policy] = await Promise.all([
    listConnectors(),
    listDatasets(),
    listTools(),
    getOrgPolicy(),
  ]);

  const blocks: Block[] = [
    ...connectors.map((c): Block => ({ id: `connector:${c.id}`, group: 'Connector', label: c.name, sub: c.type, meta: { status: c.status } })),
    ...datasets.map((d): Block => ({ id: `data:${d.id}`, group: 'Data', label: d.name, sub: d.source, meta: { rows: d.rows, classification: d.classification } })),
    ...tools.filter((t) => t.enabled).map((t): Block => ({ id: `tool:${t.id}`, group: 'Tool', label: t.name, sub: t.type })),
    ...(policy.guardrails ?? []).map((g): Block => ({ id: `guardrail:${g}`, group: 'Guardrail', label: g })),
    ...(policy.allowedModels ?? []).map((m): Block => ({ id: `model:${m}`, group: 'Model', label: m })),
    ...AGENTS.map((a): Block => ({ id: `agent:${a.id}`, group: 'Agent', label: a.name, sub: a.role, meta: { grounded: a.grounded } })),
  ];

  const counts = blocks.reduce(
    (acc, b) => ((acc[b.group] = (acc[b.group] ?? 0) + 1), acc),
    {} as Record<BlockGroup, number>,
  );
  return { blocks, counts };
}

// A composed workflow the planner returns: which blocks are wired, in what order.
export interface WorkflowEdge { from: string; to: string; label?: string }
export interface Workflow {
  title: string;
  summary: string;
  nodeIds: string[]; // subset of catalog block ids, in pipeline order
  edges: WorkflowEdge[];
}
