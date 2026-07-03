// Studio introspection: project everything the platform has — connectors, data sources,
// tools, guardrails, models, agents — into a flat catalog of "blocks" the agent-builder
// canvas can render as nodes. The hard parts (pipeline, sandbox, grounding) already exist;
// this just surfaces what's available so an NL request can be wired against it.
import { AGENTS } from './agents';
import { getOrgPolicy, listConnectors, listDatasets, listTools } from './store';

export type BlockGroup =
  | 'Input'
  | 'Connector'
  | 'Data'
  | 'Guardrail'
  | 'Tool'
  | 'Agent'
  | 'Human'
  | 'Model'
  | 'Output';

// Inputs (triggers) and outputs (sinks) the platform can wire a workflow to. Some are live
// (manual prompt, file), some are stubs pending connector wiring — surfaced so the builder
// shows the whole shape of an agent app, not just the model step.
// Real (wired) vs coming-soon (shown disabled — the vision, never faked). Manual/file inputs,
// Console output, and Human review are real; the event triggers and external sinks are marked
// comingSoon so the canvas shows the full shape without pretending they fire.
export const INPUT_BLOCKS: Block[] = [
  { id: 'input:manual', group: 'Input', label: 'Manual prompt', sub: 'type a request' },
  { id: 'input:file', group: 'Input', label: 'File upload', sub: 'pdf / doc / image' },
  { id: 'input:email', group: 'Input', label: 'Email trigger', sub: 'on inbound mail', comingSoon: true },
  { id: 'input:gmail', group: 'Input', label: 'Gmail trigger', sub: 'on new email', comingSoon: true },
  { id: 'input:webhook', group: 'Input', label: 'Webhook', sub: 'POST event', comingSoon: true },
  { id: 'input:schedule', group: 'Input', label: 'Schedule', sub: 'cron / interval', comingSoon: true },
];
export const OUTPUT_BLOCKS: Block[] = [
  { id: 'output:console', group: 'Output', label: 'Console', sub: 'in-app result' },
  { id: 'output:human', group: 'Human', label: 'Human review', sub: 'approve / edit' },
  { id: 'output:report', group: 'Output', label: 'Report', sub: 'signed PDF export', comingSoon: true },
  { id: 'output:email', group: 'Output', label: 'Email', sub: 'send result', comingSoon: true },
  { id: 'output:whatsapp', group: 'Output', label: 'WhatsApp', sub: 'message', comingSoon: true },
];

export interface Block {
  id: string; // e.g. "connector:conn_01"
  group: BlockGroup;
  label: string;
  sub?: string;
  /** Vision shown but not wired yet — rendered disabled ("coming soon"), never faked. */
  comingSoon?: boolean;
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
    ...INPUT_BLOCKS,
    ...connectors.map((c): Block => ({ id: `connector:${c.id}`, group: 'Connector', label: c.name, sub: c.type, meta: { status: c.status } })),
    ...datasets.map((d): Block => ({ id: `data:${d.id}`, group: 'Data', label: d.name, sub: d.source, meta: { rows: d.rows, classification: d.classification } })),
    ...tools.filter((t) => t.enabled).map((t): Block => ({ id: `tool:${t.id}`, group: 'Tool', label: t.name, sub: t.type })),
    ...(policy.guardrails ?? []).map((g): Block => ({ id: `guardrail:${g}`, group: 'Guardrail', label: g })),
    ...(policy.allowedModels ?? []).map((m): Block => ({ id: `model:${m}`, group: 'Model', label: m })),
    ...AGENTS.map((a): Block => ({ id: `agent:${a.id}`, group: 'Agent', label: a.name, sub: a.role, meta: { grounded: a.grounded } })),
    ...OUTPUT_BLOCKS,
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
