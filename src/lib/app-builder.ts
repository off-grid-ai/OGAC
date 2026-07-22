// ─── App builder edit reducers (Builder Epic Phase 3A) — PURE, zero-IO ───────────────────────────
//
// The TEXT/form editing half of the dual-mode builder (the canvas half is Phase 3B). The full-screen
// guided builder holds an AppSpec in memory and mutates it as the user refines the compiled skeleton:
// add / remove / reorder a step, relabel it, rebind a connector-query's data-domain or an agent, pick
// the trigger, toggle grounding. Every one of those is a PURE function here: (AppSpec, args) →
// AppSpec. The component calls them and re-renders; validation is delegated to validateAppSpec
// (app-model.ts) — this module never re-implements a graph rule.
//
// KEY INVARIANT the reducers preserve: the steps array is the LINEAR order the user sees, and the
// edges are kept as a linear chain over that order (s1→s2→s3…). The compiler emits a linear chain and
// the text editor keeps it linear; branching graphs are the canvas's job (3B). So after any structural
// edit (add/remove/reorder) we RECHAIN the edges from the new step order. This keeps the spec a valid
// one-entry graph without asking the user to draw edges — the founder's "very easy" bar.
//
// SOLID: pure logic, unit-tested in test/app-builder.test.ts. The component is a thin caller.

import type {
  ActionStep,
  AgentStep,
  AppEdge,
  AppSpec,
  AppStep,
  AppStepKind,
  ConnectorQueryStep,
  OutputStep,
  TriggerKind,
  TriggerSpec,
} from '@/lib/app-model';
import type { ActionId } from '@/lib/action-contract';

// ─── rechainEdges — rebuild a linear edge chain from the current step order ──────────────────────
// The single source of truth for edges in text-edit mode: given the ordered steps, wire s0→s1→…→sn.
// A zero/one-step app has no edges. Called after every structural mutation so the graph stays a
// valid one-entry chain (validateAppSpec's requirement) without manual edge editing.
export function rechainEdges(steps: AppStep[]): AppEdge[] {
  if (steps.length <= 1) return [];
  return steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id }));
}

// ─── TOPOLOGY EDIT REDUCERS (Builder Epic — visual canvas, branching) ────────────────────────────
//
// The canvas (StudioCanvas 3B) is a REAL editor: the operator can draw an edge between any two steps,
// delete an edge, and drag nodes — so a workflow can BRANCH/rewire, not just be a linear chain. These
// reducers are the pure, cycle-safe edge ops the canvas calls (the linear `rechainEdges` above still
// backs text-mode + the compiled default). They only touch `spec.edges`; node positions are a canvas
// VIEW concern (there is no position column on the apps table), so they live in the component.
//
// INVARIANTS every op preserves:
//   • no duplicate edge (same from→to appears at most once)
//   • no self-loop (from === to rejected)
//   • no CYCLE — adding an edge that would close a loop is refused (validateAppSpec forbids unreachable
//     orphans but NOT cycles, so we guard cycles here at edit time so the executor's bounded loop
//     never sees one).
// A rejected op is a NO-OP (returns the SAME spec object) — the caller detects "nothing changed" by
// identity and can surface a toast.

// wouldCreateStepCycle — would adding from→to close a directed cycle over the CURRENT edges? (PURE)
// True iff `to` can already reach `from` following existing edges (so from→to would loop), or it is a
// self-reference. Same reachability shape as app-tools.reaches, but over AppEdge[] (steps) — kept
// local so this module stays import-free and independently testable.
export function wouldCreateStepCycle(edges: AppEdge[], from: string, to: string): boolean {
  if (from === to) return true;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  // BFS from `to`: can we reach `from` again? If so, from→to would close a cycle.
  const seen = new Set<string>([to]);
  const queue = [to];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === from) return true;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

// addEdge — draw a directed edge from→to. NO-OP (same spec) if an endpoint is not a real step, the
// edge already exists, it is a self-loop, or it would create a cycle. Otherwise appends the edge.
export function addEdge(spec: AppSpec, from: string, to: string): AppSpec {
  const ids = new Set(spec.steps.map((s) => s.id));
  if (!ids.has(from) || !ids.has(to)) return spec; // dangling endpoint
  if (from === to) return spec; // self-loop
  if (spec.edges.some((e) => e.from === from && e.to === to)) return spec; // duplicate
  if (wouldCreateStepCycle(spec.edges, from, to)) return spec; // cycle
  return { ...spec, edges: [...spec.edges, { from, to }] };
}

// removeEdge — delete the edge from→to. NO-OP if it is not present.
export function removeEdge(spec: AppSpec, from: string, to: string): AppSpec {
  const edges = spec.edges.filter((e) => !(e.from === from && e.to === to));
  if (edges.length === spec.edges.length) return spec; // nothing removed
  return { ...spec, edges };
}

// addStepNoRechain — append a new step of `kind` WITHOUT rechaining the edges. The visual canvas, once
// the operator has drawn a branching topology, must not have its edges flattened back to a linear
// chain every time a node is added (that's what `addStep` does for text-mode). This drops in a new
// disconnected node; the operator then draws its edges. Returns { spec, id } so the caller can select
// the new node. PURE (mirrors addStep's mint+blank, minus rechain).
export function addStepNoRechain(spec: AppSpec, kind: AppStepKind): { spec: AppSpec; id: string } {
  const id = mintStepId(spec.steps);
  const step = withNearestApproval(blankStep(kind, id), spec.steps);
  return { spec: { ...spec, steps: [...spec.steps, step] }, id };
}

// removeStepAndEdges — drop a step by id AND every edge touching it, WITHOUT rechaining the survivors.
// The canvas's node-delete: unlike text-mode `removeStep` (which rechains into a linear flow), this
// preserves the remaining branching topology and only prunes the deleted node's edges. NO-OP if the id
// isn't present or it's the last remaining step (an app keeps ≥1 step). PURE.
export function removeStepAndEdges(spec: AppSpec, stepId: string): AppSpec {
  if (spec.steps.length <= 1) return spec;
  const steps = spec.steps.filter((s) => s.id !== stepId);
  if (steps.length === spec.steps.length) return spec; // id not found
  const edges = spec.edges.filter((e) => e.from !== stepId && e.to !== stepId);
  return { ...spec, steps, edges };
}

// ─── mintStepId — a unique step id not already used in the spec ──────────────────────────────────
// Ids are opaque (`s1`,`s2`,… by convention). We never reuse an id; on collision we suffix.
export function mintStepId(steps: AppStep[], prefix = 's'): string {
  const used = new Set(steps.map((s) => s.id));
  let n = steps.length + 1;
  let id = `${prefix}${n}`;
  while (used.has(id)) {
    n += 1;
    id = `${prefix}${n}`;
  }
  return id;
}

// ─── A blank step of a given kind (with the minimal executable shape) ────────────────────────────
// Used by addStep. Each kind gets a sensible default so the spec stays close to valid; the user then
// fills in the binding (domain / agent) via rebind. Note: a fresh agent step is inline with an empty
// prompt (which validateAppSpec flags until filled) and a connector-query has an empty domain (also
// flagged) — that's intentional: the builder surfaces those as things to complete, never fabricates.
export function blankStep(kind: AppStepKind, id: string): AppStep {
  const label = defaultLabel(kind);
  switch (kind) {
    case 'agent':
      return { id, label, kind: 'agent', inlineAgent: { systemPrompt: '', grounded: true } };
    case 'connector-query':
      return { id, label, kind: 'connector-query', domain: '', op: 'read' };
    case 'guardrail':
      return { id, label, kind: 'guardrail' };
    case 'human':
      return { id, label, kind: 'human' };
    case 'output':
      return { id, label, kind: 'output', sink: 'console' };
    case 'action':
      return {
        id,
        label,
        kind: 'action',
        actionId: 'crm.create-task',
        connectorId: '',
        command: { operation: 'create-task' },
      };
    default:
      // exhaustive; TS guards this, but keep a safe fallback.
      return { id, label: 'Step', kind: 'output', sink: 'console' } as AppStep;
  }
}

function defaultLabel(kind: AppStepKind): string {
  switch (kind) {
    case 'agent':
      return 'Decision';
    case 'connector-query':
      return 'Read data';
    case 'guardrail':
      return 'Guardrail check';
    case 'human':
      return 'Review / approve';
    case 'output':
      return 'Output';
    case 'action':
      return 'Complete the next action';
    default:
      return 'Step';
  }
}

// ─── addStep — append or insert a new step of `kind`, then rechain ───────────────────────────────
// index === undefined → append at the end. Otherwise insert BEFORE that index (clamped). Always
// rechains the edges so the new step joins the linear flow.
export function addStep(spec: AppSpec, kind: AppStepKind, index?: number): AppSpec {
  const id = mintStepId(spec.steps);
  const steps = [...spec.steps];
  const at = index === undefined ? steps.length : clamp(index, 0, steps.length);
  const step = withNearestApproval(blankStep(kind, id), steps.slice(0, at));
  steps.splice(at, 0, step);
  return { ...spec, steps, edges: rechainEdges(steps) };
}

// ─── removeStep — drop a step by id, then rechain ────────────────────────────────────────────────
// Never removes the last remaining step (an app must keep ≥1 step — validateAppSpec would reject an
// empty spec and the UI would have nothing to show). A no-op if the id isn't present.
export function removeStep(spec: AppSpec, stepId: string): AppSpec {
  if (spec.steps.length <= 1) return spec;
  const steps = spec.steps.filter((s) => s.id !== stepId);
  if (steps.length === spec.steps.length) return spec; // id not found
  return { ...spec, steps, edges: rechainEdges(steps) };
}

// ─── moveStep — reorder a step up (-1) or down (+1) in the linear flow, then rechain ─────────────
// direction is the signed offset (typically ±1). Clamped to the array bounds; a move that would go
// out of range is a no-op. Rechains edges to the new order.
export function moveStep(spec: AppSpec, stepId: string, direction: number): AppSpec {
  const from = spec.steps.findIndex((s) => s.id === stepId);
  if (from === -1) return spec;
  const to = from + direction;
  if (to < 0 || to >= spec.steps.length) return spec;
  const steps = [...spec.steps];
  const [moved] = steps.splice(from, 1);
  steps.splice(to, 0, moved);
  return { ...spec, steps, edges: rechainEdges(steps) };
}

// ─── relabelStep — set a step's human label (edges unaffected) ────────────────────────────────────
export function relabelStep(spec: AppSpec, stepId: string, label: string): AppSpec {
  return mapStep(spec, stepId, (s) => ({ ...s, label }));
}

// ─── rebindDomain — change a connector-query step's bound data-domain (by id) ────────────────────
// Only valid on a connector-query step; a no-op on any other kind (the caller only offers this
// control for connector-query steps). Sets `domain` to the domain id chosen from the org context.
export function rebindDomain(spec: AppSpec, stepId: string, domainId: string): AppSpec {
  return mapStep(spec, stepId, (s) =>
    s.kind === 'connector-query' ? ({ ...s, domain: domainId } as ConnectorQueryStep) : s,
  );
}

// ─── rebindAgent — point an agent step at an existing org agent (by id) ──────────────────────────
// Switches the agent step to reference an existing agent (agentId) and drops the inline def, OR — if
// agentId is empty — back to an inline agent (keeping any prior inline prompt). Only affects agent
// steps.
export function rebindAgent(spec: AppSpec, stepId: string, agentId: string): AppSpec {
  return mapStep(spec, stepId, (s) => {
    if (s.kind !== 'agent') return s;
    if (agentId) {
      const next: AgentStep = { id: s.id, label: s.label, kind: 'agent', agentId };
      return next;
    }
    // Back to inline — preserve an existing inline prompt if there was one.
    const next: AgentStep = {
      id: s.id,
      label: s.label,
      kind: 'agent',
      inlineAgent: s.inlineAgent ?? { systemPrompt: '', grounded: true },
    };
    return next;
  });
}

// ─── setAgentPrompt — edit an inline agent step's system prompt ──────────────────────────────────
export function setAgentPrompt(spec: AppSpec, stepId: string, prompt: string): AppSpec {
  return mapStep(spec, stepId, (s) => {
    if (s.kind !== 'agent') return s;
    const inline = s.inlineAgent ?? { systemPrompt: '', grounded: true };
    const next: AgentStep = {
      ...s,
      agentId: undefined,
      inlineAgent: { ...inline, systemPrompt: prompt },
    };
    return next;
  });
}

// ─── toggleGrounding — flip an inline agent step's grounded flag ─────────────────────────────────
// Grounding = "answer strictly from retrieved knowledge, cite it." Only meaningful for an inline
// agent (an agentId reference carries its own grounded flag on the agent def). No-op otherwise.
export function toggleGrounding(spec: AppSpec, stepId: string, grounded: boolean): AppSpec {
  return mapStep(spec, stepId, (s) => {
    if (s.kind !== 'agent' || !s.inlineAgent) return s;
    const next: AgentStep = { ...s, inlineAgent: { ...s.inlineAgent, grounded } };
    return next;
  });
}

// ─── setOutputSink — change an output step's sink ────────────────────────────────────────────────
export function setOutputSink(spec: AppSpec, stepId: string, sink: OutputStep['sink']): AppSpec {
  return mapStep(spec, stepId, (s) => (s.kind === 'output' ? ({ ...s, sink } as OutputStep) : s));
}

// ─── setOutputConfigField — set/clear ONE config field on an output step (pure) ──────────────────
// The sink-specific destination (webhook url, Slack channel, email to/subject, whatsapp to). A blank
// value CLEARS the key so an unconfigured sink degrades honestly rather than carrying an empty string.
export function setOutputConfigField(
  spec: AppSpec,
  stepId: string,
  key: string,
  value: string,
): AppSpec {
  return mapStep(spec, stepId, (s) => {
    if (s.kind !== 'output') return s;
    const config = { ...(s.config ?? {}) };
    if (value.trim()) config[key] = value;
    else delete config[key];
    return { ...s, config } as OutputStep;
  });
}

export interface ActionStepPatch {
  actionId?: ActionId;
  connectorId?: string;
  command?: Record<string, unknown>;
  approvalStepId?: string | null;
}

/** Configure the selected governed action without exposing replay keys or arbitrary HTTP fields. */
export function configureActionStep(
  spec: AppSpec,
  stepId: string,
  patch: ActionStepPatch,
): AppSpec {
  return mapStep(spec, stepId, (step) => {
    if (step.kind !== 'action') return step;
    const next: ActionStep = {
      ...step,
      ...(patch.actionId ? { actionId: patch.actionId } : {}),
      ...(patch.connectorId !== undefined ? { connectorId: patch.connectorId.trim() } : {}),
      ...(patch.command !== undefined ? { command: withoutUserIdempotency(patch.command) } : {}),
    };
    if (patch.approvalStepId === null) delete next.approvalStepId;
    else if (patch.approvalStepId !== undefined) {
      next.approvalStepId = patch.approvalStepId.trim() || undefined;
    }
    return next;
  });
}

// ─── setTrigger — pick how the app is invoked ─────────────────────────────────────────────────────
export function setTrigger(
  spec: AppSpec,
  kind: TriggerKind,
  config?: Record<string, unknown>,
): AppSpec {
  const trigger: TriggerSpec = { kind, ...(config ? { config } : {}) };
  return { ...spec, trigger };
}

// ─── setTitle / setSummary / setVisibility — top-level metadata edits ────────────────────────────
export function setTitle(spec: AppSpec, title: string): AppSpec {
  return { ...spec, title };
}
export function setSummary(spec: AppSpec, summary: string): AppSpec {
  return { ...spec, summary };
}
export function setVisibility(spec: AppSpec, visibility: AppSpec['visibility']): AppSpec {
  return { ...spec, visibility };
}
// ─── setPipeline — bind the app/agent to a GOVERNED pipeline (CONSUMERS-BIND #166) ───────────────
// null ⇒ "Org default (governed)" — resolved at run time. Any pipeline id ⇒ the app runs on that
// pipeline and every run is tagged pipeline:<id> so policy/guardrails/telemetry apply.
export function setPipeline(spec: AppSpec, pipelineId: string | null): AppSpec {
  return { ...spec, pipelineId: pipelineId || null };
}

// ─── describeStepBinding — a human line of "what this step binds to" ─────────────────────────────
// PURE presenter for the skeleton list: given a step (and the org's domain/agent names for lookup),
// return a short phrase describing what it reads / calls / decides — so the builder's ordered list is
// readable ("Read invoices → CoreBank", "Decision · grounded", "Review / approve", "Output · report").
export interface BindingNames {
  domains?: { id: string; label: string }[];
  agents?: { id: string; name: string }[];
}
export function describeStepBinding(step: AppStep, names: BindingNames = {}): string {
  switch (step.kind) {
    case 'agent': {
      if (step.agentId) {
        const a = names.agents?.find((x) => x.id === step.agentId);
        return `agent · ${a?.name ?? step.agentId}`;
      }
      const grounded = step.inlineAgent?.grounded ? ' · grounded' : '';
      const hasPrompt = step.inlineAgent?.systemPrompt?.trim() ? '' : ' · needs instructions';
      return `inline agent${grounded}${hasPrompt}`;
    }
    case 'connector-query': {
      if (!step.domain?.trim()) return 'unbound — pick a data domain';
      const d = names.domains?.find((x) => x.id === step.domain || x.label === step.domain);
      return `reads ${d?.label ?? step.domain} · ${step.op ?? 'read'}`;
    }
    case 'guardrail':
      return step.guardrailId ? `guardrail · ${step.guardrailId}` : 'guardrail check';
    case 'human':
      return step.formSchema?.length
        ? `human review · ${step.formSchema.length} field form`
        : 'human review / approve';
    case 'output':
      return `output · ${step.sink}`;
    case 'action':
      if (!step.connectorId) return 'needs a CRM connection';
      return `${step.actionId === 'crm.create-task' ? 'creates a CRM follow-up' : 'updates CRM'} · approval required`;
    default:
      return '';
  }
}

// ─── internal: map a single step by id through a transform, edges unchanged ──────────────────────
function mapStep(spec: AppSpec, stepId: string, fn: (s: AppStep) => AppStep): AppSpec {
  let changed = false;
  const steps = spec.steps.map((s) => {
    if (s.id !== stepId) return s;
    changed = true;
    return fn(s);
  });
  return changed ? { ...spec, steps } : spec;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function withNearestApproval(step: AppStep, preceding: AppStep[]): AppStep {
  if (step.kind !== 'action') return step;
  const review = [...preceding].reverse().find((candidate) => candidate.kind === 'human');
  return review ? { ...step, approvalStepId: review.id } : step;
}

function withoutUserIdempotency(command: Record<string, unknown>): Record<string, unknown> {
  const { idempotencyKey: _idempotencyKey, ...safe } = command;
  return safe;
}
