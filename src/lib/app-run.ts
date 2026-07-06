// ─── Multi-step app-run orchestrator (Builder Epic Phase 2A) — the I/O executor ─────────────────
//
// This is the RUNTIME that actually walks an AppSpec's step graph and executes each step against
// the real platform, persisting per-step status to the `appRuns` row so screens 3 (RUNNING) + 4
// (REVIEW) can read a live trace. SOLID split: all scheduling/reducer decisions are pure in
// app-run-plan.ts and durability decisions are pure in app-run-durable.ts; this file is the thin
// I/O layer that calls those decisions and the real subsystems.
//
// Per-step execution (executeStep), by kind:
//   • agent          → runAgent(...) — the GOVERNED single-agent pipeline, VERBATIM (each step is
//                       independently policy/guardrail/budget/grounding/provenance-checked). Prior
//                       steps' outputs are threaded into the agent's query as CONTEXT so a
//                       downstream agent sees what upstream steps produced.
//   • connector-query → resolveDomain over the org's declared domains → fetch the bound connector →
//                       queryDomain(...) (READ-only, null on failure = a miss, never a fabricated row).
//   • guardrail      → runChecks (reuse the existing guardrail path) over the accumulated context; a
//                       'blocked' verdict fails the step (and thus halts the run).
//   • human          → returns 'awaiting_human' WITHOUT blocking — the durable workflow (Phase 2B)
//                       owns the wait/resume. runApp (the inline convenience) stops at the first
//                       human step and returns the run as awaiting_human.
//   • output         → console sink (default) records the accumulated outcome. report/email/whatsapp
//                       sinks are Phase 4 — this emits a StepResult noting the sink, not the delivery.
//
// THE INTERFACE CONTRACT (2B imports these EXACT signatures — do not deviate):
//   executeStep(spec, step, priorResults, ctx) → StepResult   (run ONE runnable step)
//   runApp(spec, input, ctx)                    → AppRunOutcome (run the whole spec inline)

import { randomUUID } from 'crypto';
import type { AppSpec, AppStep } from '@/lib/app-model';
import {
  applyStepResult,
  completedStepIds,
  initState,
  nextRunnableSteps,
  type AppRunState,
} from '@/lib/app-run-plan';

// ─── The exported contract types (2B depends on these) ──────────────────────────────────────────

export interface AppRunContext {
  orgId: string;
  actor?: string;
  runId: string;
}

export interface StepResult {
  stepId: string;
  kind: AppStep['kind'];
  status: 'done' | 'error' | 'awaiting_human';
  output?: string;
  refs?: { name: string; position?: number }[];
  detail?: string;
  childRunId?: string;
}

export interface AppRunOutcome {
  runId: string;
  status: 'done' | 'error' | 'awaiting_human' | 'cancelled';
  steps: StepResult[];
  outcome: string;
}

// ─── Dependency seam ─────────────────────────────────────────────────────────────────────────────
// The two external boundaries (governed agent runs + connector reads) plus the persistence sink are
// injected so the executor is unit-testable without a live DB/gateway. Production wires the real
// functions via `defaultDeps()`; tests pass fakes for `runAgent` + `queryDomain` (the only two
// boundaries the brief says to mock — sparingly).

// The subset of an AgentRun the executor needs from runAgent(...).
export interface AgentRunLike {
  id: string;
  answer: string;
  status: string;
  citations?: { ref: string; title: string }[];
}

// The subset of a data connector the executor needs to run a read (matches store.ts Connector +
// connector-exec ConnectorTarget).
export interface ConnectorLike {
  id: string;
  type: string;
  endpoint: string;
}

// Minimal domain shape (matches data-domains.ts DataDomain — kept structural to avoid a hard import
// coupling in the deps type).
export interface DomainLike {
  id: string;
  label: string;
  connectorId: string;
  resource: string;
  opHints?: Record<string, unknown>;
}

export interface AppRunDeps {
  /** Governed single-agent pipeline. Returns null for an unknown agent. */
  runAgent: (
    agentId: string,
    query: string,
    caller: string | undefined,
    requireReview: boolean,
    orgId: string,
  ) => Promise<AgentRunLike | null>;
  /** Org's declared data domains (the rule engine's inputs). */
  listDomains: (orgId: string) => Promise<DomainLike[]>;
  /** Fetch a connector by id, org-scoped. Null if absent. */
  getConnector: (connectorId: string, orgId: string) => Promise<ConnectorLike | null>;
  /** Run a governed READ against a domain's bound connector. */
  queryDomain: (
    domain: DomainLike,
    connector: ConnectorLike,
    opts: { op?: 'read' | 'count'; limit?: number; params?: Record<string, unknown> },
  ) => Promise<{ result: { rows: unknown[]; count: number; dialect: string } | null; detail: string }>;
  /** Guardrail check path (reuse of the existing runChecks + outcomeFromChecks). */
  runGuardrail: (
    text: string,
  ) => Promise<{ blocked: boolean; detail: string }>;
  /** Persist the live app-run state (create on start, update per step). No-op sink is allowed. */
  persist: (state: AppRunState, input: Record<string, unknown>) => Promise<void>;
  /**
   * Materialize an inline agent (systemPrompt/model/grounded/tools, no agentId) into a real
   * customAgent and return its id. Used by an agent step that has an `inlineAgent` but no `agentId`
   * (GAP #113) so a freshly-compiled multi-step app's decision step can run through runAgent. The
   * created agent id is cached back onto the step + persisted to the app so re-runs don't duplicate.
   */
  materializeAgent: (spec: AppSpec, step: Extract<AppStep, { kind: 'agent' }>, orgId: string) => Promise<string>;
}

// ─── defaultDeps — wire the real subsystems (lazy imports keep this module light + test-friendly) ─
// Each boundary is imported inside the closure so tests that inject their own deps never load the
// DB/gateway/Temporal modules. resolveDomain is applied over listDomains BY ID/LABEL — the executor
// binds a connector-query step to a DECLARED domain (a rule), never a fuzzy guess at runtime.
export function defaultDeps(): AppRunDeps {
  return {
    async runAgent(agentId, query, caller, requireReview, orgId) {
      const { runAgent } = await import('@/lib/agentrun');
      return runAgent(agentId, query, caller, requireReview, orgId);
    },
    async listDomains(orgId) {
      const { listDomains } = await import('@/lib/data-domains-store');
      return listDomains(orgId) as unknown as Promise<DomainLike[]>;
    },
    async getConnector(connectorId, orgId) {
      const { listConnectors } = await import('@/lib/store');
      const all = await listConnectors(orgId);
      const c = all.find((x) => x.id === connectorId);
      return c ? { id: c.id, type: c.type, endpoint: c.endpoint } : null;
    },
    async queryDomain(domain, connector, opts) {
      const { queryDomain, describeDecision } = await import('@/lib/adapters/connector-query');
      const { result, decision } = await queryDomain(
        // The adapter's DataDomain requires orgId/aliases; fill defensively from the structural shape.
        {
          id: domain.id,
          orgId: '',
          label: domain.label,
          aliases: [],
          connectorId: domain.connectorId,
          resource: domain.resource,
          opHints: domain.opHints,
        },
        { type: connector.type, endpoint: connector.endpoint },
        opts,
      );
      return {
        result: result
          ? { rows: result.rows, count: result.count, dialect: result.dialect }
          : null,
        detail: describeDecision(decision),
      };
    },
    async runGuardrail(text) {
      const { runChecks, outcomeFromChecks } = await import('@/lib/checks');
      const checks = await runChecks('pre', { phase: 'pre', input: text });
      const outcome = outcomeFromChecks(checks);
      return {
        blocked: outcome === 'blocked',
        detail: checks.map((c) => `${c.name}:${c.verdict}`).join(' '),
      };
    },
    async persist(state, input) {
      // Best-effort persistence to the appRuns row so screens 3/4 can read the live trace. Uses an
      // upsert-by-id: create on the first write, update on subsequent ones. Import lazily + swallow
      // errors so a persistence outage never fails the run (the outcome is still returned to the
      // caller / durable workflow, which owns the authoritative state).
      try {
        const { upsertAppRunState } = await import('@/lib/app-run-store');
        await upsertAppRunState(state, input);
      } catch {
        /* app-run-store not present or DB unreachable — degrade to no-op */
      }
    },
    async materializeAgent(spec, step, orgId) {
      // Create a real customAgent from the inline def, then cache its id back onto the step + persist
      // it to the app so a re-run reuses the SAME agent (idempotent — no duplicates). Lazy imports
      // keep this off the default bundle. If persistence fails (unsaved/draft spec, DB down) we still
      // return the fresh id so the run proceeds — only the cross-run dedup is best-effort.
      const inline = step.inlineAgent!;
      const { createCustomAgent } = await import('@/lib/store');
      const created = await createCustomAgent({
        name: `${spec.title || 'App'} · ${step.label || step.id}`,
        role: 'App step',
        description: `Inline agent materialized for app "${spec.title}" step "${step.id}".`,
        systemPrompt: inline.systemPrompt,
        model: inline.model,
        tools: inline.tools,
        grounded: inline.grounded,
      });
      // Cache back in-memory (this-run reuse) and persist (cross-run dedup).
      step.agentId = created.id;
      if (spec.id) {
        try {
          const { updateApp } = await import('@/lib/apps-store');
          await updateApp(spec.id, orgId, { steps: spec.steps });
        } catch {
          /* draft/unsaved spec or DB down — the in-memory agentId still serves this run */
        }
      }
      return created.id;
    },
  };
}

// ─── threading prior outputs into a downstream agent step ────────────────────────────────────────
// A downstream agent must see what upstream steps produced. We build a compact CONTEXT block from
// the prior step outputs and prepend it to the agent's query, so the governed pipeline retrieves +
// answers WITH that context in-band (runAgent takes a single query string; this is how earlier-step
// results reach it without changing runAgent's signature).
export function buildAgentQuery(step: AppStep, priorResults: StepResult[]): string {
  const label = step.label || step.id;
  const contextBlocks = priorResults
    .filter((r) => r.output && r.output.trim())
    .map((r) => `- [${r.kind}] ${r.output!.trim()}`);
  if (contextBlocks.length === 0) return label;
  return `CONTEXT FROM PRIOR STEPS:\n${contextBlocks.join('\n')}\n\nTASK: ${label}`;
}

// ─── resolveDomainByIdOrLabel — GAP #106-a: id FIRST, then label/alias (pure) ─────────────────────
// The compiler emits `step.domain = <domain id>` (e.g. `dom_inv`), but the label/alias rule engine
// (`resolveDomain`) matches human phrases, not ids — so a saved compiled spec's reads returned null
// at run time. Fix: try an EXACT id hit against the declared domains first (ids are stable + unique,
// so this is a safe deterministic bind), and only fall back to the phrase resolver for a label/alias.
// Kept pure (resolver injected) so it's unit-testable without the DB. Both a spec with `domain=<id>`
// and one with `domain=<label>` now resolve to the same domain.
export function resolveDomainByIdOrLabel(
  domainRef: string,
  domains: DomainLike[],
  resolveByPhrase: (phrase: string, doms: never) => { id: string; label: string; connectorId: string; resource: string; opHints?: Record<string, unknown> } | null,
): DomainLike | null {
  const ref = (domainRef ?? '').trim();
  if (!ref) return null;
  // 1. Exact domain-id match (what the compiler emits) — stable + unambiguous.
  const byId = domains.find((d) => d.id === ref);
  if (byId) return byId;
  // 2. Fall back to the label/alias rule engine (no-guess) for a human phrase / label form.
  return (resolveByPhrase(ref, domains as never) as DomainLike | null) ?? null;
}

// ─── executeStep — run ONE step, return its StepResult ────────────────────────────────────────────
// Pure-ish dispatch: it selects the handler by kind and calls the injected boundary. It never
// advances run state itself — the caller (runApp / the durable workflow) folds the StepResult into
// AppRunState via applyStepResult. A human step returns awaiting_human WITHOUT blocking.
export async function executeStep(
  spec: AppSpec,
  step: AppStep,
  priorResults: StepResult[],
  ctx: AppRunContext,
  deps: AppRunDeps = defaultDeps(),
): Promise<StepResult> {
  try {
    switch (step.kind) {
      case 'agent':
        return await executeAgentStep(spec, step, priorResults, ctx, deps);
      case 'connector-query':
        return await executeConnectorStep(step, ctx, deps);
      case 'guardrail':
        return await executeGuardrailStep(step, priorResults, deps);
      case 'human':
        // Do NOT block here — the durable workflow (2B) owns the wait/resume. Signal the pause.
        return {
          stepId: step.id,
          kind: 'human',
          status: 'awaiting_human',
          detail: `awaiting human decision at "${step.label || step.id}"`,
        };
      case 'output':
        return executeOutputStep(step, priorResults);
      default:
        return errorResult(step, `unknown step kind`);
    }
  } catch (err) {
    return errorResult(step, err instanceof Error ? err.message : String(err));
  }
}

async function executeAgentStep(
  spec: AppSpec,
  step: Extract<AppStep, { kind: 'agent' }>,
  priorResults: StepResult[],
  ctx: AppRunContext,
  deps: AppRunDeps,
): Promise<StepResult> {
  // GAP #113: an agent step with an inline def (systemPrompt/model/grounded/tools) but no agentId
  // can't reuse runAgent (which resolves by id). Materialize the inline agent into a real
  // customAgent on first run — idempotently (the id is cached back onto the step + persisted to the
  // app so a re-run reuses it), then run it through runAgent normally.
  let agentId = step.agentId;
  if (!agentId) {
    if (!step.inlineAgent?.systemPrompt?.trim()) {
      return errorResult(step, 'agent step has neither an agentId nor a usable inlineAgent');
    }
    agentId = await deps.materializeAgent(spec, step, ctx.orgId);
  }
  const query = buildAgentQuery(step, priorResults);
  const run = await deps.runAgent(agentId, query, ctx.actor, false, ctx.orgId);
  if (!run) return errorResult(step, `unknown agent: ${agentId}`);
  if (run.status === 'denied' || run.status === 'blocked') {
    return {
      stepId: step.id,
      kind: 'agent',
      status: 'error',
      childRunId: run.id,
      detail: `agent run ${run.status}`,
    };
  }
  return {
    stepId: step.id,
    kind: 'agent',
    status: 'done',
    output: run.answer,
    childRunId: run.id,
    refs: (run.citations ?? []).map((c, i) => ({ name: c.title || c.ref, position: i + 1 })),
    detail: `agent ${agentId} → ${run.status}`,
  };
}

async function executeConnectorStep(
  step: Extract<AppStep, { kind: 'connector-query' }>,
  ctx: AppRunContext,
  deps: AppRunDeps,
): Promise<StepResult> {
  // Resolve the step's declared domain against the org's domains. The step carries `domain` (id or
  // label); we resolve it deterministically — BY ID FIRST (a compiled spec emits the domain id),
  // then by LABEL/ALIAS via the rule engine (no-guess). See resolveDomainByIdOrLabel (GAP #106-a).
  const domains = await deps.listDomains(ctx.orgId);
  const { resolveDomain } = await import('@/lib/data-domains');
  const resolved = resolveDomainByIdOrLabel(step.domain, domains, resolveDomain);
  if (!resolved) {
    return errorResult(step, `no data-domain binds "${step.domain}" (unbound — not guessed)`);
  }
  const connector = await deps.getConnector(resolved.connectorId, ctx.orgId);
  if (!connector) {
    return errorResult(step, `domain "${resolved.label}" binds connector ${resolved.connectorId} which is missing`);
  }
  const { result, detail } = await deps.queryDomain(resolved, connector, {
    op: step.op ?? 'read',
    params: step.params,
  });
  if (!result) {
    // A miss (unreachable / bad binding) — recorded honestly, not fabricated. This does not error
    // the run by default; it produces an empty read the downstream step can reason about.
    return {
      stepId: step.id,
      kind: 'connector-query',
      status: 'done',
      output: `No rows returned from ${resolved.label} (${resolved.resource}).`,
      refs: [{ name: `${resolved.connectorId}:${resolved.resource}` }],
      detail,
    };
  }
  return {
    stepId: step.id,
    kind: 'connector-query',
    status: 'done',
    output: summarizeRows(resolved.label, resolved.resource, result.rows, result.count),
    refs: [{ name: `${resolved.connectorId}:${resolved.resource}` }],
    detail,
  };
}

async function executeGuardrailStep(
  step: Extract<AppStep, { kind: 'guardrail' }>,
  priorResults: StepResult[],
  deps: AppRunDeps,
): Promise<StepResult> {
  // Apply the guardrail over the accumulated prior-step output (what would flow onward). Reuses the
  // existing runChecks path via deps.runGuardrail. A 'blocked' verdict fails the step → halts the run.
  const text = priorResults
    .map((r) => r.output ?? '')
    .filter(Boolean)
    .join('\n');
  const { blocked, detail } = await deps.runGuardrail(text || step.label);
  if (blocked) {
    return { stepId: step.id, kind: 'guardrail', status: 'error', detail: `guardrail blocked: ${detail}` };
  }
  return { stepId: step.id, kind: 'guardrail', status: 'done', detail: `guardrail ok: ${detail}` };
}

function executeOutputStep(
  step: Extract<AppStep, { kind: 'output' }>,
  priorResults: StepResult[],
): StepResult {
  const outcome = aggregateOutcome(priorResults);
  if (step.sink === 'console') {
    return { stepId: step.id, kind: 'output', status: 'done', output: outcome, detail: 'sink: console' };
  }
  // report / email / whatsapp sinks are Phase 4 — record the intent, don't deliver. The step still
  // succeeds (the outcome is available); the sink note tells the reader delivery is deferred.
  return {
    stepId: step.id,
    kind: 'output',
    status: 'done',
    output: outcome,
    detail: `sink: ${step.sink} (delivery deferred to Phase 4 — outcome available, not sent)`,
  };
}

// ─── runApp — run the whole spec inline to completion (or to the first human pause) ───────────────
// Convenience for non-durable / simple apps + tests. Drives the pure scheduler: repeatedly take the
// next runnable steps, execute them, fold results into AppRunState, persist, and stop when the run
// reaches a terminal state OR hits an awaiting_human step (the durable workflow owns the resume).
export async function runApp(
  spec: AppSpec,
  input: Record<string, unknown>,
  ctx: AppRunContext,
  deps: AppRunDeps = defaultDeps(),
): Promise<AppRunOutcome> {
  let state = initState(spec, ctx.runId);
  const results: StepResult[] = [];
  await deps.persist(state, input);

  // Bounded loop: at most one pass per step (a validated DAG). Guards against a pathological cycle.
  const maxIterations = (spec.steps?.length ?? 0) + 1;
  for (let i = 0; i <= maxIterations; i++) {
    const runnable = nextRunnableSteps(spec, completedStepIds(state));
    if (runnable.length === 0) break;

    let paused = false;
    for (const step of runnable) {
      // Mark running (for the live screen), then execute.
      state = applyStepResult(state, step.id, { status: 'running' });
      await deps.persist(state, input);

      const result = await executeStep(spec, step, results, ctx, deps);
      results.push(result);
      state = applyStepResult(state, step.id, {
        status: result.status,
        output: result.output,
        refs: result.refs,
        detail: result.detail,
        childRunId: result.childRunId,
      });
      await deps.persist(state, input);

      if (result.status === 'error') {
        // Halt the whole run on a step error (the run status is already 'error' via the reducer).
        return finalize(state, results);
      }
      if (result.status === 'awaiting_human') {
        // Stop here — the durable workflow (2B) resumes once the human decides.
        paused = true;
        break;
      }
    }
    if (paused) break;
  }

  return finalize(state, results);
}

// ─── helpers ──────────────────────────────────────────────────────────────────────────────────

function finalize(state: AppRunState, results: StepResult[]): AppRunOutcome {
  const status: AppRunOutcome['status'] =
    state.status === 'queued' ? 'done' : (state.status as AppRunOutcome['status']);
  return {
    runId: state.runId,
    status,
    steps: results,
    outcome: aggregateOutcome(results),
  };
}

// The aggregate outcome = the LAST non-empty output produced (the tail of the pipeline), so an
// output/agent step's answer is the app's result. Falls back to the empty string.
function aggregateOutcome(results: StepResult[]): string {
  for (let i = results.length - 1; i >= 0; i--) {
    const o = results[i].output;
    if (o && o.trim()) return o;
  }
  return '';
}

function summarizeRows(label: string, resource: string, rows: unknown[], count: number): string {
  const shown = rows.slice(0, 5);
  const head = `${label} (${resource}): ${count} row(s).`;
  if (shown.length === 0) return head;
  return `${head}\n${JSON.stringify(shown)}`;
}

function errorResult(step: AppStep, detail: string): StepResult {
  return { stepId: step.id, kind: step.kind, status: 'error', detail };
}

// mint a run id when a caller doesn't supply one (kept here so callers/tests can reuse it).
export function newAppRunId(): string {
  return `apprun_${randomUUID().slice(0, 8)}`;
}
