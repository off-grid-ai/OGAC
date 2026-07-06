// ─── Apps-as-tools (Builder Epic #117) — PURE resolver + cycle safety (zero-IO) ──────────────────
//
// The founder's composability ask: "tools could be the other small apps that we build as well." So a
// published app can itself be a TOOL inside another app's agent step. An agent step references an app
// tool as `app:<id>` (mirrors `tool:<id>` in the registry and `prim:<id>` for primitives), and when
// that step runs, invoking the tool RUNS the referenced app and threads its output back.
//
// The danger is CYCLES — app A uses app B as a tool, B uses A → infinite regress. This module owns
// the PURE cycle detection (buildAppToolGraph + wouldCreateCycle + detectAppToolCycles) so a builder
// can REFUSE a self-referential wiring at edit time and the executor can refuse at run time — both
// tested (test/app-tools.test.ts) without any I/O.
//
// SOLID: this module is PURE (zero imports of the store/executor) so it is safe to import from the
// client builder (for setStepTools/appToolCatalog). The I/O bridge that actually RUNS an app-as-tool
// (`invokeAppTool`) lives in the server-only adapter `src/lib/adapters/tool-primitives.ts` — it reuses
// these pure guards before running so a saved-but-cyclic spec can never recurse.

import type { AppSpec, AppStep } from '@/lib/app-model';

// ─── The ref namespace for apps-as-tools ──────────────────────────────────────────────────────────
export const APP_TOOL_REF_PREFIX = 'app:';
export function appToolRef(appId: string): string {
  return `${APP_TOOL_REF_PREFIX}${appId}`;
}
export function isAppToolRef(ref: string): boolean {
  return ref.startsWith(APP_TOOL_REF_PREFIX);
}
export function parseAppToolRef(ref: string): string | null {
  return isAppToolRef(ref) ? ref.slice(APP_TOOL_REF_PREFIX.length) : null;
}

// ─── stepToolRefs / specToolRefs — the tool refs an app declares ──────────────────────────────────
// An agent step carries its tools on either the referenced agent (agentId — those tools live on the
// agent def, not the spec) or its inlineAgent.tools. For CYCLE detection over APP tools we only care
// about the `app:<id>` refs an app's OWN steps declare inline — those are the edges of the app→app
// graph. (Agent-def tools are resolved at agent level and can't reference an app in this model.)
export function stepAppToolRefs(step: AppStep): string[] {
  if (step.kind !== 'agent') return [];
  const tools = step.inlineAgent?.tools ?? [];
  return tools.filter(isAppToolRef);
}

export function specAppToolIds(spec: AppSpec): string[] {
  const ids = new Set<string>();
  for (const step of spec.steps) {
    for (const ref of stepAppToolRefs(step)) {
      const id = parseAppToolRef(ref);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

// ─── The app→app dependency graph (PURE) ──────────────────────────────────────────────────────────
// A directed edge A→B means "app A uses app B as a tool." Built from a set of specs (the org's apps).
export type AppToolGraph = Map<string, Set<string>>;

export function buildAppToolGraph(specs: AppSpec[]): AppToolGraph {
  const graph: AppToolGraph = new Map();
  for (const spec of specs) {
    graph.set(spec.id, new Set(specAppToolIds(spec)));
  }
  return graph;
}

// ─── detectAppToolCycles — every cycle reachable in the graph (PURE) ──────────────────────────────
// Returns a list of cycles, each as the id path that closes the loop (e.g. [A, B, A]). Empty ⇒ the
// composition graph is a DAG (safe). Uses DFS with a recursion stack; a self-loop (A→A) is reported.
export function detectAppToolCycles(graph: AppToolGraph): string[][] {
  const cycles: string[][] = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of graph.keys()) color.set(id, WHITE);

  const stack: string[] = [];
  const visit = (node: string) => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue; // edge to an app that isn't in the set — can't form a cycle here
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        // Found a back-edge → the cycle is stack[idx..] + next.
        const idx = stack.indexOf(next);
        if (idx >= 0) cycles.push([...stack.slice(idx), next]);
      } else if (c === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  };

  for (const id of graph.keys()) {
    if ((color.get(id) ?? WHITE) === WHITE) visit(id);
  }
  return cycles;
}

// ─── wouldCreateCycle — would adding "callerId uses calleeId" introduce a cycle? (PURE) ───────────
// The builder guard: before letting a step add `app:<calleeId>`, check that calleeId can't already
// reach callerId (which would close a loop), and reject a self-reference (A can't call itself). Uses
// the EXISTING graph (the org's apps) so it's a cheap reachability query.
export function wouldCreateCycle(
  graph: AppToolGraph,
  callerId: string,
  calleeId: string,
): boolean {
  if (callerId === calleeId) return true; // direct self-reference
  // If callee can already reach caller, adding caller→callee closes a cycle.
  return reaches(graph, calleeId, callerId);
}

// Can `from` reach `to` following app→app edges? (PURE BFS.)
export function reaches(graph: AppToolGraph, from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of graph.get(cur) ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

// ─── setStepTools — PURE reducer: set the tool refs on an agent step ──────────────────────────────
// The builder's tool picker edits an agent step's tools. Registered tools + primitives + app-tools
// are all just refs (`tool:<id>`, `prim:<id>`, `app:<id>`) on the SAME list. This reducer sets that
// list on an inline agent step (an agentId-referenced step carries its tools on the agent def, not
// the spec — so it's a no-op there, and the picker only shows for inline steps). Kept here (not in the
// off-limits app-builder.ts) so #117 owns the tool-list edit rule; the builder component calls it.
export function setStepTools(spec: AppSpec, stepId: string, toolRefs: string[]): AppSpec {
  let changed = false;
  const steps = spec.steps.map((s) => {
    if (s.id !== stepId || s.kind !== 'agent') return s;
    changed = true;
    const inline = s.inlineAgent ?? { systemPrompt: '', grounded: true };
    return { ...s, inlineAgent: { ...inline, tools: toolRefs } };
  });
  return changed ? { ...spec, steps } : spec;
}

// The current tool refs on an agent step (empty for a non-agent / agentId-referenced step).
export function stepTools(step: AppStep): string[] {
  if (step.kind !== 'agent') return [];
  return step.inlineAgent?.tools ?? [];
}

// ─── AppToolCatalogEntry — a published app exposed as a pickable tool ─────────────────────────────
export interface AppToolCatalogEntry {
  id: string;
  ref: string;
  name: string;
  description: string;
  /** True if picking this app as a tool for `callerId` would create a cycle (so the UI disables it). */
  cyclic: boolean;
}

// ─── appToolCatalog — PURE: which published apps can `callerId` safely use as tools ───────────────
// Given the org's specs and the id of the app being edited, returns every OTHER published app as a
// candidate tool, each flagged `cyclic` if wiring it would loop. The caller (a route) supplies specs;
// this stays pure + testable. `callerId` empty (a brand-new unsaved app) ⇒ nothing is cyclic yet.
export function appToolCatalog(specs: AppSpec[], callerId: string): AppToolCatalogEntry[] {
  const graph = buildAppToolGraph(specs);
  // Ensure the caller is a node even if it isn't saved yet, so reachability queries work.
  if (callerId && !graph.has(callerId)) graph.set(callerId, new Set(specAppToolIds(
    specs.find((s) => s.id === callerId) ?? ({ steps: [] } as unknown as AppSpec),
  )));
  return specs
    .filter((s) => s.published && s.id !== callerId)
    .map((s) => ({
      id: s.id,
      ref: appToolRef(s.id),
      name: s.title,
      description: s.summary || 'A published app.',
      cyclic: callerId ? wouldCreateCycle(graph, callerId, s.id) : false,
    }));
}

