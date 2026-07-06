// ─── Unified App model (Builder Epic #108, Phase 1A) — PURE, zero-IO ───────────
// The one build artifact. An "app" is a triggered, multi-step workflow; a simple agent is just an
// app with a single agent step. This module owns the AppSpec type shape, its validation rules, and
// the back-compat shim that maps a legacy studioTemplate.workflow → an AppSpec so /app/<slug> and
// old templates keep working. No imports, no I/O — the storage layer (apps-store.ts) adapts this to
// the `apps` table. Keeping the rules here pure makes them unit-testable in isolation.

// ─── FormField — one field of an input form (collected before a run) ──────────
export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'file' | 'date';
  required?: boolean;
  options?: string[]; // for type:'select'
}

// ─── TriggerSpec — how an app is invoked ──────────────────────────────────────
export type TriggerKind = 'on-demand' | 'webhook' | 'email' | 'whatsapp' | 'schedule';
export interface TriggerSpec {
  kind: TriggerKind;
  config?: Record<string, unknown>;
}

// ─── AppStep — a discriminated union over the node kinds ───────────────────────
// Each step has an id (unique within the app) + a human label + a `kind` tag.

// An agent step: either references an existing agent (agentId) or carries an inline agent def.
export interface AgentStep {
  id: string;
  label: string;
  kind: 'agent';
  agentId?: string;
  inlineAgent?: {
    systemPrompt: string;
    model?: string;
    grounded?: boolean;
    tools?: string[];
  };
}

// A connector-query step: reads from a bound data-domain (id or label) via the rule engine.
export interface ConnectorQueryStep {
  id: string;
  label: string;
  kind: 'connector-query';
  domain: string; // data-domain id or label (resolved by lib/data-domains.ts, Phase 1B)
  op?: 'read' | 'count';
  params?: Record<string, unknown>;
}

// A guardrail step: runs a governance check mid-workflow.
export interface GuardrailStep {
  id: string;
  label: string;
  kind: 'guardrail';
  guardrailId?: string;
  policy?: string;
  config?: Record<string, unknown>;
}

// A human step: pauses the run for a person (HITL). May present a form to fill in.
export interface HumanStep {
  id: string;
  label: string;
  kind: 'human';
  formSchema?: FormField[];
}

// An output step: emits the run's result to a sink.
export interface OutputStep {
  id: string;
  label: string;
  kind: 'output';
  sink: 'console' | 'report' | 'email' | 'whatsapp';
  config?: Record<string, unknown>;
}

export type AppStep =
  | AgentStep
  | ConnectorQueryStep
  | GuardrailStep
  | HumanStep
  | OutputStep;

export type AppStepKind = AppStep['kind'];

// ─── AppEdge — a directed transition between steps, with an optional guard ─────
export interface AppEdge {
  from: string;
  to: string;
  when?: string; // optional guard expression on the transition
}

// ─── AppSpec — the full app definition ─────────────────────────────────────────
export interface AppSpec {
  id: string;
  orgId: string;
  ownerId: string;
  title: string;
  summary: string;
  visibility: 'private' | 'org' | 'public';
  slug?: string;
  published: boolean;
  trigger: TriggerSpec;
  inputForm?: FormField[];
  steps: AppStep[];
  edges: AppEdge[];
}

// ─── validateAppSpec — the graph-validity rules (pure) ─────────────────────────
// A valid spec has:
//   - ≥1 step
//   - unique step ids
//   - every edge endpoint references an existing step
//   - exactly one entry: exactly one step with no incoming edge, and it reaches every other step
//     (no orphan step unreachable from the start)
//   - a "simple agent" (an app with an agent-only, one-step graph) is always valid
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const TRIGGER_KINDS: TriggerKind[] = ['on-demand', 'webhook', 'email', 'whatsapp', 'schedule'];
const STEP_KINDS: AppStepKind[] = ['agent', 'connector-query', 'guardrail', 'human', 'output'];

export function validateAppSpec(spec: AppSpec): ValidationResult {
  const errors: string[] = [];

  if (!spec.title || !spec.title.trim()) errors.push('title is required');
  if (!spec.trigger || !TRIGGER_KINDS.includes(spec.trigger.kind)) {
    errors.push(`trigger.kind must be one of: ${TRIGGER_KINDS.join(', ')}`);
  }

  const steps = spec.steps ?? [];
  if (steps.length === 0) {
    errors.push('app must have at least one step');
    return { ok: false, errors };
  }

  // Unique step ids + per-kind shape.
  const ids = new Set<string>();
  for (const step of steps) {
    if (!step.id || !step.id.trim()) {
      errors.push('every step must have a non-empty id');
      continue;
    }
    if (ids.has(step.id)) errors.push(`duplicate step id: ${step.id}`);
    ids.add(step.id);
    if (!STEP_KINDS.includes(step.kind)) {
      errors.push(`step ${step.id}: unknown kind '${step.kind}'`);
    }
    validateStepShape(step, errors);
  }

  // Edges reference existing steps.
  const edges = spec.edges ?? [];
  for (const e of edges) {
    if (!ids.has(e.from)) errors.push(`edge references unknown step (from): ${e.from}`);
    if (!ids.has(e.to)) errors.push(`edge references unknown step (to): ${e.to}`);
  }

  // Only reason about graph reachability once ids + edge endpoints are sound (else it's noise).
  if (errors.length === 0) {
    const hasIncoming = new Set(edges.map((e) => e.to));
    const entries = steps.filter((s) => !hasIncoming.has(s.id));
    if (steps.length === 1) {
      // A single-step app is trivially a valid one-entry graph (the "simple agent" case).
    } else if (entries.length === 0) {
      errors.push('no entry step: every step has an incoming edge (the graph has no start)');
    } else if (entries.length > 1) {
      errors.push(
        `multiple entry steps (${entries.map((s) => s.id).join(', ')}): an app must have exactly one start`,
      );
    } else {
      // Exactly one entry — every other step must be reachable from it (no orphans).
      const start = entries[0].id;
      const adj = new Map<string, string[]>();
      for (const s of steps) adj.set(s.id, []);
      for (const e of edges) adj.get(e.from)!.push(e.to);
      const seen = new Set<string>([start]);
      const queue = [start];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const next of adj.get(cur) ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      const unreachable = steps.filter((s) => !seen.has(s.id));
      if (unreachable.length) {
        errors.push(
          `unreachable step(s) from start '${start}': ${unreachable.map((s) => s.id).join(', ')}`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// Per-kind shape checks — a step must carry the fields its kind needs to be executable.
function validateStepShape(step: AppStep, errors: string[]): void {
  switch (step.kind) {
    case 'agent':
      if (!step.agentId && !step.inlineAgent) {
        errors.push(`agent step ${step.id}: needs agentId or inlineAgent`);
      }
      if (step.inlineAgent && !step.inlineAgent.systemPrompt?.trim()) {
        errors.push(`agent step ${step.id}: inlineAgent needs a systemPrompt`);
      }
      break;
    case 'connector-query':
      if (!step.domain || !step.domain.trim()) {
        errors.push(`connector-query step ${step.id}: needs a domain binding`);
      }
      break;
    case 'output':
      if (!step.sink) errors.push(`output step ${step.id}: needs a sink`);
      break;
    // guardrail + human have no required fields beyond id/label/kind.
    default:
      break;
  }
}

// ─── isSimpleAgent — an app that is exactly one agent step ─────────────────────
// "An agent is the simplest app." Used by builder/executor to treat single-agent apps specially.
export function isSimpleAgent(spec: AppSpec): boolean {
  return spec.steps.length === 1 && spec.steps[0].kind === 'agent';
}

// ─── workflowToAppSpec — the back-compat shim (pure) ───────────────────────────
// Maps an existing studioTemplate → an AppSpec. A legacy template has:
//   { id?, orgId?, ownerId?, title, summary, prompt, visibility?, slug?, published?,
//     workflow: { title, summary, nodeIds:string[], edges:{from,to,label?}[] } }
// where a workflow node id like `agent:<id>` names an agent and `data:<id>` names a collection.
//
// Behaviour:
//   - A single `agent:<id>` node → a one-step agent AppSpec (`data:` nodes are informational and
//     don't become steps — retrieval scoping is a runtime concern; they'd become connector-query
//     steps only once bound to a data-domain, which the legacy template never carried).
//   - N `agent:<id>` nodes → N agent steps, wired by the workflow's edges (or a linear chain if the
//     template carried no usable edges), preserving order.
//   - No agent node but a prompt present → a single inline-agent step from the prompt (the wizard's
//     assistant plan always writes the prompt).
// Round-trip: a one-step agent AppSpec, if fed back as a template, maps back to the same one-step
// spec — stable.
export interface LegacyWorkflow {
  title?: string;
  summary?: string;
  nodeIds?: string[];
  edges?: { from: string; to: string; label?: string }[];
}
export interface LegacyTemplate {
  id?: string;
  orgId?: string;
  ownerId?: string;
  title: string;
  summary?: string;
  prompt?: string;
  visibility?: string;
  slug?: string | null;
  published?: boolean;
  workflow: LegacyWorkflow;
}

export function workflowToAppSpec(template: LegacyTemplate): AppSpec {
  const wf = template.workflow ?? {};
  const nodeIds = wf.nodeIds ?? [];
  const agentNodes = nodeIds.filter((n) => n.startsWith('agent:'));

  const steps: AppStep[] = [];
  if (agentNodes.length > 0) {
    for (let i = 0; i < agentNodes.length; i++) {
      const agentId = agentNodes[i].slice('agent:'.length);
      steps.push({
        id: agentNodes[i], // preserve the workflow node id so template edges map 1:1
        label: i === 0 && template.title ? template.title : `Agent ${i + 1}`,
        kind: 'agent',
        agentId,
      });
    }
  } else if (template.prompt && template.prompt.trim()) {
    // No agent node named, but the template carries a prompt → one inline-agent step.
    steps.push({
      id: 'agent:inline',
      label: template.title || 'Agent',
      kind: 'agent',
      inlineAgent: { systemPrompt: template.prompt, grounded: true },
    });
  } else {
    // Degenerate legacy template: still produce a valid single (empty inline) agent step so the
    // deployed app doesn't 500. Callers should treat this as needs-repair.
    steps.push({
      id: 'agent:inline',
      label: template.title || 'Agent',
      kind: 'agent',
      inlineAgent: { systemPrompt: template.summary || template.title || '', grounded: true },
    });
  }

  // Edges: reuse the template's edges when they connect two agent nodes we mapped; otherwise, for a
  // multi-agent template with no usable edges, wire a linear chain to keep it a valid one-entry
  // graph. A single-step app has no edges.
  const stepIds = new Set(steps.map((s) => s.id));
  let edges: AppEdge[] = (wf.edges ?? [])
    .filter((e) => stepIds.has(e.from) && stepIds.has(e.to))
    .map((e) => ({ from: e.from, to: e.to }));
  if (steps.length > 1 && edges.length === 0) {
    edges = steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id }));
  }

  return {
    id: template.id ?? '',
    orgId: template.orgId ?? 'default',
    ownerId: template.ownerId ?? '',
    title: template.title,
    summary: template.summary ?? wf.summary ?? '',
    visibility: normalizeVisibility(template.visibility),
    slug: template.slug ?? undefined,
    published: template.published ?? false,
    trigger: { kind: 'on-demand' },
    steps,
    edges,
  };
}

function normalizeVisibility(v: string | undefined): 'private' | 'org' | 'public' {
  return v === 'org' || v === 'public' ? v : 'private';
}
