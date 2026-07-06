// ─── Canvas graph mapping (Builder Epic Phase 3B) — PURE, zero-IO ────────────────────────────────
//
// The bridge between the AppSpec (the ONE source of truth — see app-model.ts) and the React-Flow
// node/edge model the visual canvas renders. This is the whole reason the canvas is no longer
// decorative: every node the operator sees IS an `AppStep`, every edge IS an `AppEdge`, and all
// structural edits go through the SAME app-builder.ts reducers the text builder (3A) uses. So the
// canvas and the text editor are two VIEWS of one spec; they can never drift.
//
// This module owns only the PURE mapping direction: AppSpec → React-Flow graph (for rendering) and
// the small lookups the component needs (node id ↔ step id, which step a node/edge belongs to). It
// deliberately does NOT re-implement any edit rule — add/remove/reorder/rechain live in
// app-builder.ts; validity lives in app-model.ts. Keeping this pure makes the mapping unit-testable
// in isolation (test/canvas-graph.test.ts) with no React-Flow or DOM dependency.
//
// SOLID: the component (StudioCanvas.tsx) is a thin caller — it holds the AppSpec in state, calls a
// reducer on an edit, then re-derives the graph via `specToGraph` for React-Flow. No graph geometry
// or rule logic lives in the component.

import type { AppSpec, AppStep, AppStepKind } from '@/lib/app-model';

// ─── The React-Flow-shaped output (structural, framework-agnostic) ───────────────────────────────
// We intentionally do NOT import React-Flow types here (this module must stay pure + testable under
// node --test). These shapes are assignable to React-Flow's `Node`/`Edge` (the component casts them),
// but carrying our OWN minimal shape keeps the mapping decoupled from the client lib.

export interface CanvasNode {
  id: string; // === the AppStep id (1:1). The node IS the step.
  position: { x: number; y: number };
  data: CanvasNodeData;
  // React-Flow uses these to attach handles; a linear chain is target(top)→source(bottom).
  type?: string;
}

export interface CanvasNodeData {
  stepId: string;
  kind: AppStepKind;
  label: string;
  /** A short "what this binds to" line (mirrors app-builder.describeStepBinding). */
  binding: string;
  /** Whether the step is missing a required binding (drives the "needs attention" tint). */
  incomplete: boolean;
  /** Ordinal (1-based) position in the linear flow — shown on the node chip. */
  index: number;
  /** The accent color for the node's kind. */
  color: string;
}

export interface CanvasEdge {
  id: string;
  source: string; // === AppEdge.from (a step id)
  target: string; // === AppEdge.to (a step id)
  label?: string;
}

export interface CanvasGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

// ─── Per-kind accent color (brutalist/terminal palette; emerald = agent, the primary path) ───────
export const KIND_COLOR: Record<AppStepKind, string> = {
  'agent': '#059669', // emerald — the governed decision (the primary path)
  'connector-query': '#7c3aed', // violet — reads a bound data domain
  'guardrail': '#dc2626', // red — a governance check
  'human': '#ca8a04', // amber — a person pauses the run (HITL)
  'output': '#db2777', // pink — emits to a sink
};

export const KIND_LABEL: Record<AppStepKind, string> = {
  'agent': 'Agent',
  'connector-query': 'Read data',
  'guardrail': 'Guardrail',
  'human': 'Human review',
  'output': 'Output',
};

// Layout geometry — a single vertical column (the flow is a linear chain in the 3B/3A model). Kept as
// constants so tests can assert exact coordinates and the component + tests agree.
export const NODE_X = 40;
export const NODE_TOP = 24;
export const NODE_GAP = 108; // vertical spacing between successive step nodes

// ─── describeBinding — a short "what this step binds to" line (mirrors app-builder) ──────────────
// A PURE presenter so the node body reads like the text builder's skeleton line. Duplicated in spirit
// with app-builder.describeStepBinding, but kept local + name-aware for the canvas node (which shows
// the resolved domain/agent NAME, not the opaque id). Names are looked up from the caller-supplied
// option lists (the same {id,label}/{id,name} shapes 3A passes).
export interface BindingLookups {
  domains?: { id: string; label: string }[];
  agents?: { id: string; name: string }[];
}

export function describeBinding(step: AppStep, look: BindingLookups = {}): string {
  switch (step.kind) {
    case 'agent': {
      if (step.agentId) {
        const a = look.agents?.find((x) => x.id === step.agentId);
        return a ? a.name : step.agentId;
      }
      const grounded = step.inlineAgent?.grounded ? 'grounded' : 'ungrounded';
      const hasPrompt = step.inlineAgent?.systemPrompt?.trim();
      return hasPrompt ? `inline · ${grounded}` : 'needs instructions';
    }
    case 'connector-query': {
      if (!step.domain?.trim()) return 'pick a data domain';
      const d = look.domains?.find((x) => x.id === step.domain || x.label === step.domain);
      return `${d ? d.label : step.domain} · ${step.op ?? 'read'}`;
    }
    case 'guardrail':
      return step.guardrailId ? step.guardrailId : 'governance check';
    case 'human':
      return step.formSchema?.length ? `${step.formSchema.length}-field form` : 'approve / reject';
    case 'output':
      return `→ ${step.sink}`;
    default:
      return '';
  }
}

// ─── isStepIncomplete — does this step still need a binding to be runnable? ───────────────────────
// PURE. Mirrors validateAppSpec's per-kind shape rules WITHOUT re-running the whole graph validation
// (so we can tint a single node). An agent needs an agentId OR a non-empty inline prompt; a
// connector-query needs a domain; an output needs a sink. Others are always complete.
export function isStepIncomplete(step: AppStep): boolean {
  switch (step.kind) {
    case 'agent':
      if (step.agentId) return false;
      return !step.inlineAgent?.systemPrompt?.trim();
    case 'connector-query':
      return !step.domain?.trim();
    case 'output':
      return !step.sink;
    default:
      return false;
  }
}

// ─── specToGraph — the core mapping: AppSpec → React-Flow-shaped nodes + edges ───────────────────
// One node per step (id === step id), laid out top-to-bottom in the steps array order (the linear
// flow the reducers keep). One edge per AppSpec.edge (source === from, target === to). Because the
// node id IS the step id and the edge endpoints ARE step ids, a click on a node/edge maps straight
// back to a step to edit via the app-builder reducers — no separate node registry to keep in sync.
export function specToGraph(spec: AppSpec, look: BindingLookups = {}): CanvasGraph {
  const nodes: CanvasNode[] = spec.steps.map((step, i) => ({
    id: step.id,
    type: 'step',
    position: { x: NODE_X, y: NODE_TOP + i * NODE_GAP },
    data: {
      stepId: step.id,
      kind: step.kind,
      label: step.label || KIND_LABEL[step.kind],
      binding: describeBinding(step, look),
      incomplete: isStepIncomplete(step),
      index: i + 1,
      color: KIND_COLOR[step.kind],
    },
  }));

  const edges: CanvasEdge[] = spec.edges.map((e, i) => ({
    id: `e_${e.from}__${e.to}_${i}`,
    source: e.from,
    target: e.to,
    label: e.when,
  }));

  return { nodes, edges };
}

// ─── stepById — locate the AppStep a node/edge refers to (for the config panel) ──────────────────
export function stepById(spec: AppSpec, stepId: string): AppStep | undefined {
  return spec.steps.find((s) => s.id === stepId);
}

// ─── graphSummary — a one-line "N steps · M connections" digest (for the canvas header) ──────────
export interface GraphSummary {
  stepCount: number;
  edgeCount: number;
  kinds: Record<AppStepKind, number>;
  hasHuman: boolean;
  incompleteCount: number;
}

export function graphSummary(spec: AppSpec): GraphSummary {
  const kinds = { 'agent': 0, 'connector-query': 0, 'guardrail': 0, 'human': 0, 'output': 0 } as Record<
    AppStepKind,
    number
  >;
  let incompleteCount = 0;
  for (const s of spec.steps) {
    kinds[s.kind] += 1;
    if (isStepIncomplete(s)) incompleteCount += 1;
  }
  return {
    stepCount: spec.steps.length,
    edgeCount: spec.edges.length,
    kinds,
    hasHuman: kinds.human > 0,
    incompleteCount,
  };
}

// ─── emptySpec — a fresh single-step AppSpec to seed a canvas with no NL description ─────────────
// The canvas can start from scratch (not just from compile): a one-agent app is the simplest valid
// app (validateAppSpec accepts it). The operator then adds steps visually. ownerId/orgId are filled
// by the server on save; kept '' here (pure, no identity).
export function emptySpec(): AppSpec {
  return {
    id: '',
    orgId: '',
    ownerId: '',
    title: 'Untitled app',
    summary: '',
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps: [
      {
        id: 's1',
        label: 'Decision',
        kind: 'agent',
        inlineAgent: { systemPrompt: '', grounded: true },
      },
    ],
    edges: [],
  };
}
