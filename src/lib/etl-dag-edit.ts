// ─── ETL DAG edit reducers — PURE, zero-IO (SOLID: mirrors app-builder.ts) ──────────────────────
// Immutable transforms over an EtlDagSpec that the visual builder's client state calls. No React, no
// fetch, no env — every function returns a NEW spec so they're trivially unit-testable and the UI
// stays a thin controlled view. The validation + compile live in etl-job.ts / etl-kestra-compile.ts.

import type { EtlDagSpec, EtlNode, EtlNodeKind, EtlNodeConfig, EtlTransformKind } from './etl-job';

// A stable, human-ish node id unique within the spec.
export function mintNodeId(spec: EtlDagSpec, prefix: string): string {
  const used = new Set(spec.nodes.map((n) => n.id));
  let i = 1;
  let id = `${prefix}_${i}`;
  while (used.has(id)) id = `${prefix}_${++i}`;
  return id;
}

// A blank node of a given kind, with a sensible default label + config.
export function blankNode(kind: EtlNodeKind, id: string, position?: { x: number; y: number }): EtlNode {
  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  const config: EtlNodeConfig = {};
  if (kind === 'filter') config.op = 'eq';
  if (kind === 'cast') config.castType = 'string';
  if (kind === 'redact') config.action = 'mask';
  if (kind === 'aggregate') config.aggFn = 'count';
  return { id, kind, label, config, position };
}

// Add a transform node (never a second source/destination via this helper — those are seeded by
// defaultDag). Returns the new spec + the new node id. Does NOT auto-wire edges — the UI connects.
export function addNode(
  spec: EtlDagSpec,
  kind: EtlTransformKind,
  position?: { x: number; y: number },
): { spec: EtlDagSpec; id: string } {
  const id = mintNodeId(spec, kind);
  const node = blankNode(kind, id, position);
  return { spec: { ...spec, nodes: [...spec.nodes, node] }, id };
}

// Remove a node and every edge touching it. Source/destination nodes can be removed too (validation
// then flags the missing endpoint), but the UI should discourage it.
export function removeNode(spec: EtlDagSpec, id: string): EtlDagSpec {
  return {
    ...spec,
    nodes: spec.nodes.filter((n) => n.id !== id),
    edges: spec.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

// Merge a partial config patch onto a node (shallow — the caller supplies the fields it changed).
export function updateNodeConfig(spec: EtlDagSpec, id: string, patch: Partial<EtlNodeConfig>): EtlDagSpec {
  return {
    ...spec,
    nodes: spec.nodes.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)),
  };
}

// Rename a node's display label.
export function relabelNode(spec: EtlDagSpec, id: string, label: string): EtlDagSpec {
  return { ...spec, nodes: spec.nodes.map((n) => (n.id === id ? { ...n, label } : n)) };
}

// Move a node on the canvas (UI-only position; harmless to persist).
export function moveNode(spec: EtlDagSpec, id: string, position: { x: number; y: number }): EtlDagSpec {
  return { ...spec, nodes: spec.nodes.map((n) => (n.id === id ? { ...n, position } : n)) };
}

// Connect two nodes (idempotent — no duplicate edge, no self-edge).
export function connectNodes(spec: EtlDagSpec, from: string, to: string): EtlDagSpec {
  if (from === to) return spec;
  if (spec.edges.some((e) => e.from === from && e.to === to)) return spec;
  return { ...spec, edges: [...spec.edges, { from, to }] };
}

// Disconnect an edge.
export function disconnectNodes(spec: EtlDagSpec, from: string, to: string): EtlDagSpec {
  return { ...spec, edges: spec.edges.filter((e) => !(e.from === from && e.to === to)) };
}

// Set the trigger + cron together (the UI toggles manual/schedule).
export function setTrigger(spec: EtlDagSpec, trigger: EtlDagSpec['trigger'], cron?: string): EtlDagSpec {
  return { ...spec, trigger, cron: trigger === 'schedule' ? cron : undefined };
}
