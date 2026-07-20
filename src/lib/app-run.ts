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

import { randomUUID } from 'node:crypto';
import type { AppSpec, AppStep } from '@/lib/app-model';
import {
  type RunMode,
  buildWouldPerform,
  shadowDetail,
  shouldIntercept,
} from '@/lib/app-run-controls';
import {
  applyStepResult,
  completedStepIds,
  initState,
  nextRunnableSteps,
  type AppRunState,
} from '@/lib/app-run-plan';
import {
  emailEgressVerdict,
  emailMaskingRequired,
  maskEmailForSend,
  selectEmailProvider,
} from '@/lib/email-sink-governance';
import { effectivePiiMasking, maskOrBlock } from '@/lib/pii-escalation';
import { auditEnforcement } from '@/lib/pipeline-contract';
import {
  type PipelineContract,
  enforceDataAccess,
  enforceModelCall,
} from '@/lib/pipeline-enforcement';
import type { Asker } from '@/lib/retrieval/acl';
import type { RetrievalHit } from '@/lib/retrieval/types';

// ─── The exported contract types (2B depends on these) ──────────────────────────────────────────

export interface AppRunContext {
  orgId: string;
  actor?: string;
  runId: string;
  /**
   * PA-16 — the resolved bound-pipeline contract this run enforces (data allowlist + egress leash +
   * policy/guardrail overlay). OPTIONAL + ADDITIVE: absent/null ⇒ legacy behaviour (no extra gate).
   * The route resolves it once (resolveContract) and threads it here; the step handlers call the PURE
   * enforcement decisions (enforceDataAccess / enforceModelCall) and perform the deny/route/audit I/O.
   */
  contract?: PipelineContract | null;
  /** Canonical resolved pipeline id for child-agent attribution and durable dispatch. */
  pipelineId?: string | null;
  /** Document-level retrieval identity carried into inline and Temporal child-agent runs. */
  asker?: Asker;
  /**
   * SHADOW / LIVE run mode (BFSI blast-radius). In 'shadow' any SIDE-EFFECTING step (an output sink
   * that leaves the box — email/report/whatsapp) is INTERCEPTED: it records what it WOULD have done
   * and does NOT execute. Read/reason/guardrail steps run normally in both modes. Absent ⇒ 'live'
   * (default, additive). The route resolves the effective mode (app.shadowDefault ∨ requested) once
   * via resolveRunMode and threads it here; the executor applies the pure shouldIntercept per step.
   */
  mode?: RunMode;
}

export interface StepResult {
  stepId: string;
  kind: AppStep['kind'];
  status: 'done' | 'error' | 'awaiting_human';
  output?: string;
  refs?: { name: string; position?: number }[];
  detail?: string;
  childRunId?: string;
  /**
   * When this step was INTERCEPTED in shadow mode: what it WOULD have performed (sink + recipient +
   * subject + payload preview). Present only on shadowed side-effecting steps so the trace + review
   * screen can render the dry-run action clearly. Absent on every executed (live) step.
   */
  wouldPerform?: import('@/lib/app-run-controls').WouldPerform;
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
    context?: import('@/lib/agent-run-context').RunContext,
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
  ) => Promise<{
    result: { rows: unknown[]; count: number; dialect: string } | null;
    detail: string;
  }>;
  /**
   * Guardrail check path (reuse of the existing runChecks + outcomeFromChecks). `orgId` is threaded
   * EXPLICITLY (gap #121) so the PII deep config (org custom recognizers + thresholds) resolves on
   * the durable worker path, which has no request scope for `headers()`-based org resolution — the
   * worker then behaves identically to a request. Optional (2nd arg) keeps the seam back-compat.
   */
  runGuardrail: (text: string, orgId?: string) => Promise<{ blocked: boolean; detail: string }>;
  /**
   * PII scan (the guardrails port) → a redacted form of the text, for the mask-before-model
   * substitution on an agent step when the bound pipeline's overlay ESCALATES masking on (PA-16c).
   * Injected so the escalation is unit-testable without a live detector; production wires getPii().
   * `orgId` scopes the deep config on the worker path (gap #121).
   */
  scanPii: (
    text: string,
    orgId?: string,
  ) => Promise<{ hits: boolean; redacted?: string; entities: string[]; engine: string }>;
  /**
   * Persist the live app-run state (create on start, update per step). No-op sink is allowed.
   * `orgId` is threaded EXPLICITLY (G-ISO-2) so the `app_runs` row is written under the RUN's real
   * org — not the store's DEFAULT_ORG fallback — so a non-default tenant's run reads back under its
   * own org (getAppRunView(runId, '<thatorg>')), never lands cross-tenant under 'default'.
   */
  persist: (state: AppRunState, input: Record<string, unknown>, orgId: string) => Promise<void>;
  /**
   * Materialize an inline agent (systemPrompt/model/grounded/tools, no agentId) into a real
   * customAgent and return its id. Used by an agent step that has an `inlineAgent` but no `agentId`
   * (GAP #113) so a freshly-compiled multi-step app's decision step can run through runAgent. The
   * created agent id is cached back onto the step + persisted to the app so re-runs don't duplicate.
   */
  materializeAgent: (
    spec: AppSpec,
    step: Extract<AppStep, { kind: 'agent' }>,
    orgId: string,
  ) => Promise<string>;
  /**
   * OUTPUT SINK — render a signed, auditable report artifact for the run (Phase 4B). Injected so the
   * executor is unit-testable without the PDF/crypto layers. Production wires renderAppRunReport; the
   * report sink calls this and records the signed manifest (sha256 + signature) onto the step so the
   * artifact's provenance is captured at run time (the bytes are re-derivable via the download route).
   */
  renderReport: (
    view: import('@/lib/app-runs-view').AppRunView,
    format: 'pdf' | 'md',
  ) => Promise<{
    filename: string;
    contentType: string;
    bytes: Uint8Array;
    manifest: { algorithm: string; sha256: string; signature: string };
  }>;
  /**
   * OUTPUT SINK — deliver the run's result by on-prem SMTP (Phase 4B). Injected so the executor is
   * unit-testable without a socket. Production wires sendEmail; the email sink calls this. HONEST:
   * when SMTP is unconfigured it returns { configured:false } and the sink records "not configured" —
   * never a fake success.
   */
  sendEmail: (
    msg: {
      to: string;
      subject: string;
      text: string;
      attachments?: { filename: string; contentType: string; bytes: Uint8Array }[];
    },
    provider?: import('@/lib/email-sink-governance').EmailProvider,
  ) => Promise<{ ok: boolean; configured: boolean; reason: string }>;
}

// ─── defaultDeps — wire the real subsystems (lazy imports keep this module light + test-friendly) ─
// Each boundary is imported inside the closure so tests that inject their own deps never load the
// DB/gateway/Temporal modules. resolveDomain is applied over listDomains BY ID/LABEL — the executor
// binds a connector-query step to a DECLARED domain (a rule), never a fuzzy guess at runtime.
export function defaultDeps(): AppRunDeps {
  return {
    async runAgent(agentId, query, caller, requireReview, orgId, context) {
      const { runAgent } = await import('@/lib/agentrun');
      return runAgent(agentId, query, caller, requireReview, orgId, context);
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
        // Pass `id` so connector-exec resolves the vaulted credential at query time (credential-free
        // endpoint + secret from OpenBao). Without it, a vaulted connector would connect password-less.
        { type: connector.type, endpoint: connector.endpoint, id: connector.id },
        opts,
      );
      return {
        result: result ? { rows: result.rows, count: result.count, dialect: result.dialect } : null,
        detail: describeDecision(decision),
      };
    },
    async runGuardrail(text, orgId) {
      // Route through the SHARED fail-CLOSED seam (G-ADV-GOV-3): a screen that THROWS or TIMES OUT is
      // a BLOCK, never a swallowed error that lets the accumulated output flow to the next step. The
      // explicit orgId scopes the PII deep config without `headers()` on the worker path (gap #121).
      const { screenGuardrail } = await import('@/lib/guardrail-seam');
      const screen = await screenGuardrail('pre', { input: text, orgId });
      return { blocked: screen.outcome === 'blocked', detail: screen.detail };
    },
    async scanPii(text, orgId) {
      // Reuse the SAME guardrails PII port the agent/chat/pipeline paths use (regex floor by default,
      // Presidio when configured). orgId scopes the deep config without `headers()` on the worker path.
      const { getPii } = await import('@/lib/adapters/registry');
      return getPii().scan(text, orgId);
    },
    async persist(state, input, orgId) {
      // Best-effort persistence to the appRuns row so screens 3/4 can read the live trace. Uses an
      // upsert-by-id: create on the first write, update on subsequent ones. Import lazily + swallow
      // errors so a persistence outage never fails the run (the outcome is still returned to the
      // caller / durable workflow, which owns the authoritative state). G-ISO-2: the RUN's org is
      // threaded through so the row is written under the real tenant, never the DEFAULT_ORG fallback.
      try {
        const { upsertAppRunState } = await import('@/lib/app-run-store');
        await upsertAppRunState(state, input, orgId);
      } catch {
        /* app-run-store not present or DB unreachable — degrade to no-op */
      }
    },
    async materializeAgent(spec, step, orgId) {
      // The App row and runtime-agent row are one ownership aggregate. A row lock serializes two
      // simultaneous first runs; insert + App step update commit or roll back together.
      const { materializeAppAgent } = await import('@/lib/apps-store');
      const agentId = await materializeAppAgent(spec.id, step.id, orgId);
      step.agentId = agentId;
      return agentId;
    },
    async renderReport(view, format) {
      const { renderAppRunReport } = await import('@/lib/adapters/sinks/report');
      const report = await renderAppRunReport(view, format);
      return {
        filename: report.filename,
        contentType: report.contentType,
        bytes: report.bytes,
        manifest: {
          algorithm: report.manifest.algorithm,
          sha256: report.manifest.sha256,
          signature: report.manifest.signature,
        },
      };
    },
    async sendEmail(msg, provider = 'smtp') {
      if (provider === 'resend') {
        const { sendViaResend } = await import('@/lib/adapters/sinks/email-resend');
        // The run path already masked the body + cleared the egress leash; shape as HTML + tag the send.
        const res = await sendViaResend(msg, { html: true, tags: { source: 'offgrid_app_run' } });
        return { ok: res.ok, configured: res.configured, reason: res.reason };
      }
      const { sendEmail } = await import('@/lib/adapters/sinks/email-smtp');
      return sendEmail(msg);
    },
  };
}

// ─── threading prior outputs into a downstream agent step ────────────────────────────────────────
// A downstream agent must see what upstream steps produced. Non-connector outputs (earlier agent
// decisions, human review) stay in-band in a compact CONTEXT block. Connector evidence does NOT:
// it already travels through `providedSourcesFromPriorResults`, where it remains independently
// maskable, citeable and groundable. Copying those rows into the query duplicates sensitive data,
// forces redundant guardrail scans and collapses source provenance into prompt text.
export function buildAgentQuery(step: AppStep, priorResults: StepResult[]): string {
  const label = step.label || step.id;
  const contextBlocks = priorResults
    .filter((r) => r.kind !== 'connector-query' && r.output?.trim())
    .map((r) => `- [${r.kind}] ${r.output!.trim()}`);
  if (contextBlocks.length === 0) return label;
  return `CONTEXT FROM PRIOR STEPS:\n${contextBlocks.join('\n')}\n\nTASK: ${label}`;
}

/**
 * Project connector outputs into the canonical source shape consumed by a grounded agent. The
 * connector step has already resolved the tenant domain and passed the pipeline data ceiling, so
 * these are the exact authorized sources for the downstream decision—not a cue to search again.
 */
export function providedSourcesFromPriorResults(priorResults: StepResult[]): RetrievalHit[] {
  return priorResults
    .filter((result) => result.kind === 'connector-query' && result.output?.trim())
    .map((result) => ({
      sourceId: result.stepId,
      sourceKind: 'database' as const,
      title: result.refs?.[0]?.name ?? `App step ${result.stepId}`,
      snippet: result.output!.trim(),
      ref: result.refs?.[0]?.name ?? `app-step:${result.stepId}`,
      score: 1,
    }));
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
  resolveByPhrase: (
    phrase: string,
    doms: never,
  ) => {
    id: string;
    label: string;
    connectorId: string;
    resource: string;
    opHints?: Record<string, unknown>;
  } | null,
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
        return await executeGuardrailStep(step, priorResults, ctx, deps);
      case 'human':
        // Do NOT block here — the durable workflow (2B) owns the wait/resume. Signal the pause.
        return {
          stepId: step.id,
          kind: 'human',
          status: 'awaiting_human',
          detail: `awaiting human decision at "${step.label || step.id}"`,
        };
      case 'output':
        // SHADOW-MODE INTERCEPT (BFSI blast-radius) — an ADDITIONAL gate IN FRONT of the sink's own
        // egress/PII governance. In shadow, a side-effecting sink (email/report/whatsapp) NO-OPs and
        // records what it WOULD have sent (recipient/subject/payload preview) instead of delivering.
        // The console sink is pure record-keeping (never intercepted) and read/reason steps run
        // normally, so the operator sees the REAL decision the app would make — just no actions fire.
        if (shouldIntercept(ctx.mode ?? 'live', step)) {
          const outcome = aggregateOutcome(priorResults);
          const would = buildWouldPerform(step.sink, step.config, outcome);
          return {
            stepId: step.id,
            kind: 'output',
            status: 'done',
            output: outcome,
            detail: shadowDetail(would),
            wouldPerform: would,
          };
        }
        return await executeOutputStep(spec, step, priorResults, ctx, deps);
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
  // PA-16 — egress leash + policy/guardrail overlay on the MODEL call. Before the governed agent
  // pipeline runs (which makes the gateway call), apply the bound pipeline's routing leash for this
  // run's data-class (pure enforceModelCall). A `block` verdict stops the call (audited, governed
  // error); the pipeline can only be MORE restrictive than the leash, never less. No pipeline ⇒ the
  // noPipeline verdict allows it (legacy routing). The data-class is derived from whether an upstream
  // step read a connector (real data flowing to the model → 'general'; else 'none' — a pure prompt).
  const dataClass = priorResults.some((r) => r.kind === 'connector-query') ? 'general' : 'none';
  const modelVerdict = enforceModelCall(ctx.contract ?? null, dataClass);
  if (!modelVerdict.allow) {
    auditEnforcement(
      { orgId: ctx.orgId, actor: ctx.actor, runId: ctx.runId, contract: ctx.contract ?? null },
      'pipeline.egress.block',
      `model:agent:${agentId}`,
      'blocked',
      modelVerdict.reason,
    );
    return errorResult(step, `model call blocked by pipeline egress leash: ${modelVerdict.reason}`);
  }

  // PA-16c — PII MASK BEFORE THE MODEL. When the bound pipeline's guardrail overlay ESCALATES
  // masking ON above the org floor (modelVerdict.requirePiiMasking, decided by the ONE pure
  // authority effectivePiiMasking — max(floor, overlay)), the raw query MUST be replaced with its
  // PII-redacted form BEFORE it reaches the agent step's model call. The query here folds in the
  // upstream connector-query outputs (the retrieved rows), so this is exactly where a raw PAN/email
  // read from a data source would otherwise leak into the prompt. The raw→redacted substitution is
  // the same pure applyPiiEscalation() the agent/chat/pipeline paths use. Best-effort: a detector
  // outage leaves the query as-is (the egress leash's local-only guarantee still holds). Additive:
  // with no pipeline / masking not escalated, the query is untouched (legacy behaviour).
  let query = buildAgentQuery(step, priorResults);
  const requireMasking = effectivePiiMasking(false, modelVerdict);
  if (requireMasking) {
    // FAIL CLOSED (SECURITY #236 fix 2): masking is MANDATED for this call, so a masker that errors
    // must BLOCK the step — the raw (unmasked) query must NEVER reach the model. The pure maskOrBlock
    // is the ONE authority: on a scan throw it returns { block:true }; only a successful scan yields
    // forwardable (redacted) text. The old `catch { /* send unmasked */ }` was a fail-open PII leak.
    let scanResult:
      | { ok: true; scan: Awaited<ReturnType<AppRunDeps['scanPii']>> }
      | { ok: false; error: unknown };
    try {
      scanResult = { ok: true, scan: await deps.scanPii(query, ctx.orgId) };
    } catch (err) {
      scanResult = { ok: false, error: err };
    }
    const decision = maskOrBlock(requireMasking, query, scanResult);
    if (decision.block) {
      auditEnforcement(
        { orgId: ctx.orgId, actor: ctx.actor, runId: ctx.runId, contract: ctx.contract ?? null },
        'pipeline.pii.mask',
        `model:agent:${agentId}`,
        'error',
        decision.reason ?? 'PII masking failed',
      );
      return errorResult(step, `agent step blocked: ${decision.reason}`);
    }
    query = decision.text;
    if (decision.masked && scanResult.ok) {
      auditEnforcement(
        { orgId: ctx.orgId, actor: ctx.actor, runId: ctx.runId, contract: ctx.contract ?? null },
        'pipeline.pii.mask',
        `model:agent:${agentId}`,
        'redacted',
        `masked ${scanResult.scan.entities.join(', ')} (${scanResult.scan.engine}) before model call`,
      );
    }
  }
  const run = await deps.runAgent(agentId, query, ctx.actor, false, ctx.orgId, {
    org: ctx.orgId,
    contract: ctx.contract ?? null,
    pipelineId: ctx.pipelineId ?? ctx.contract?.pipelineId ?? null,
    asker: ctx.asker,
    providedSources: providedSourcesFromPriorResults(priorResults),
  });
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
  const { domainMatchTokens } = await import('@/lib/pipelines-policy');
  const resolved = resolveDomainByIdOrLabel(step.domain, domains, resolveDomain);
  if (!resolved) {
    return errorResult(step, `no data-domain binds "${step.domain}" (unbound — not guessed)`);
  }
  // PA-16 — HARD data-allowlist ceiling. Before the connector is HIT, check the resolved data-domain
  // against the bound pipeline's allowlist (pure enforceDataAccess). Outside the ceiling ⇒ deny +
  // audit (a governed error, never a crash). No pipeline ⇒ noPipeline verdict allows it (legacy).
  const dataVerdict = enforceDataAccess(
    ctx.contract ?? null,
    resolved.id,
    domainMatchTokens(resolved),
  );
  if (!dataVerdict.allow) {
    auditEnforcement(
      { orgId: ctx.orgId, actor: ctx.actor, runId: ctx.runId, contract: ctx.contract ?? null },
      'pipeline.data.deny',
      `data:${resolved.id}`,
      'blocked',
      dataVerdict.reason,
    );
    return errorResult(step, `data access denied by pipeline: ${dataVerdict.reason}`);
  }
  const connector = await deps.getConnector(resolved.connectorId, ctx.orgId);
  if (!connector) {
    return errorResult(
      step,
      `domain "${resolved.label}" binds connector ${resolved.connectorId} which is missing`,
    );
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
  ctx: AppRunContext,
  deps: AppRunDeps,
): Promise<StepResult> {
  // Apply the guardrail over the accumulated prior-step output (what would flow onward). Reuses the
  // existing runChecks path via deps.runGuardrail. A 'blocked' verdict fails the step → halts the run.
  // ctx.orgId is threaded through so the PII deep config applies on the worker path (gap #121).
  const text = priorResults
    .map((r) => r.output ?? '')
    .filter(Boolean)
    .join('\n');
  const { blocked, detail } = await deps.runGuardrail(text || step.label, ctx.orgId);
  if (blocked) {
    return {
      stepId: step.id,
      kind: 'guardrail',
      status: 'error',
      detail: `guardrail blocked: ${detail}`,
    };
  }
  return { stepId: step.id, kind: 'guardrail', status: 'done', detail: `guardrail ok: ${detail}` };
}

// ─── buildInRunView — a self-contained AppRunView from the run-in-progress (PURE) ─────────────────
// The report sink needs an AppRunView (the shape renderAppRunReport consumes) but the output step
// runs BEFORE the run row is finalized, so we assemble the view from what we have in hand: the spec
// (appId), the runId/input from ctx, and the prior StepResults mapped to the row's step shape. This is
// pure + deterministic (no DB read), so the report reflects exactly the steps that ran up to here.
export function buildInRunView(
  spec: AppSpec,
  priorResults: StepResult[],
  ctx: AppRunContext,
  input: Record<string, unknown>,
): import('@/lib/app-runs-view').AppRunView {
  return {
    id: ctx.runId,
    appId: spec.id,
    status: 'running',
    input,
    steps: priorResults.map((r) => ({
      id: r.stepId,
      kind: r.kind,
      label: r.stepId,
      status: r.status,
      outcome: r.output,
      refs: (r.refs ?? []).map((x) => x.name),
      detail: r.detail,
      childRunId: r.childRunId,
    })),
    outcome: aggregateOutcome(priorResults),
    provenance: null,
    startedAt: null,
    finishedAt: null,
  };
}

// ─── executeOutputStep — deliver the run's result to the step's sink (Phase 4B) ───────────────────
// console  → record the accumulated outcome (no external delivery).
// report   → render a signed PDF (renderReport dep) and ATTACH it to the step: the signed manifest
//            (sha256 + ed25519 signature) is recorded in the step detail/refs so provenance is
//            captured at run time; the bytes are re-derivable on demand via the report download route.
// email    → send the outcome (+ the report PDF when a report step ran) via the on-prem SMTP sink.
//            HONEST: unconfigured SMTP → an "email not configured" outcome, never a fake success.
// whatsapp → not yet wired (no on-prem gateway sink in this round) — recorded honestly as deferred.
async function executeOutputStep(
  spec: AppSpec,
  step: Extract<AppStep, { kind: 'output' }>,
  priorResults: StepResult[],
  ctx: AppRunContext,
  deps: AppRunDeps,
): Promise<StepResult> {
  const outcome = aggregateOutcome(priorResults);

  if (step.sink === 'console') {
    return {
      stepId: step.id,
      kind: 'output',
      status: 'done',
      output: outcome,
      detail: 'sink: console',
    };
  }

  if (step.sink === 'report') {
    const view = buildInRunView(spec, priorResults, ctx, {});
    const format = step.config?.format === 'md' ? 'md' : 'pdf';
    try {
      const report = await deps.renderReport(view, format);
      // Attach the artifact to the run by recording its signed provenance on the step. The bytes are
      // re-derivable via GET /api/v1/admin/app-runs/[id]/report (the same renderer), so the download
      // link IS the durable artifact; here we capture the signature at run time for the audit trail.
      const downloadPath = `/api/v1/admin/app-runs/${ctx.runId}/report?format=${format}`;
      return {
        stepId: step.id,
        kind: 'output',
        status: 'done',
        output: outcome,
        refs: [{ name: report.filename }, { name: downloadPath }],
        detail:
          `sink: report → ${report.filename} (${report.contentType}); ` +
          `signed ${report.manifest.algorithm} sha256=${report.manifest.sha256.slice(0, 12)}…; ` +
          `download: ${downloadPath}`,
      };
    } catch (e) {
      return errorResult(step, `report sink failed to render: ${(e as Error).message}`);
    }
  }

  if (step.sink === 'email') {
    const to = typeof step.config?.to === 'string' ? step.config.to : '';
    let subject =
      (typeof step.config?.subject === 'string' && step.config.subject) ||
      `${spec.title || 'App'} run ${ctx.runId}`;
    const contract = ctx.contract ?? null;
    const provider = selectEmailProvider(step.config);
    const enforceCtx = { orgId: ctx.orgId, actor: ctx.actor, runId: ctx.runId, contract };

    // GOVERNANCE 1 — EGRESS LEASH. A cloud provider (Resend) may only deliver if the bound pipeline's
    // egress leash permits leaving the box; a local-only pipeline must not fan its result out to a
    // third-party mailer. SMTP is air-gapped → always allowed. A block ⇒ audited deny, honest step.
    const egress = emailEgressVerdict(contract, provider);
    if (!egress.allow) {
      auditEnforcement(
        enforceCtx,
        'pipeline.egress.block',
        `sink:email:${provider}`,
        'blocked',
        egress.reason,
      );
      return errorResult(step, `email delivery blocked by pipeline egress leash: ${egress.reason}`);
    }

    // GOVERNANCE 2 — PII MASK BEFORE SEND. When the org floor / pipeline overlay requires masking, the
    // OUTBOUND subject + body are redacted BEFORE they cross the wire (mirrors the model-call path,
    // reusing the ONE pure applyPiiEscalation authority). Best-effort: a detector outage sends as-is
    // for the air-gapped SMTP sink, but a CLOUD send is HELD when masking is required and can't run.
    let text = outcome;
    const requireMask = emailMaskingRequired(contract);
    if (requireMask) {
      try {
        const [scanSubject, scanText] = await Promise.all([
          deps.scanPii(subject, ctx.orgId),
          deps.scanPii(text, ctx.orgId),
        ]);
        const masked = maskEmailForSend(subject, text, true, scanSubject, scanText);
        subject = masked.subject;
        text = masked.text;
        if (masked.masked) {
          auditEnforcement(
            enforceCtx,
            'pipeline.pii.mask',
            `sink:email:${provider}`,
            'redacted',
            `masked PII in email subject/body before ${provider} send`,
          );
        }
      } catch (e) {
        if (provider === 'resend') {
          // Refuse to leak unmasked PII to a cloud mailer when the detector is down — honest deny.
          auditEnforcement(
            enforceCtx,
            'pipeline.pii.mask',
            `sink:email:${provider}`,
            'error',
            'PII detector unavailable — cloud send held',
          );
          return errorResult(
            step,
            `email send held: PII masking required but the detector is unavailable (${(e as Error).message})`,
          );
        }
        /* SMTP (air-gapped): the body stays on-prem — proceed unmasked (leash guarantee holds) */
      }
    }

    // If a prior report step attached a PDF, include the freshly-rendered report as an attachment.
    let attachments: { filename: string; contentType: string; bytes: Uint8Array }[] | undefined;
    if (step.config?.attachReport === true) {
      try {
        const report = await deps.renderReport(buildInRunView(spec, priorResults, ctx, {}), 'pdf');
        attachments = [
          { filename: report.filename, contentType: report.contentType, bytes: report.bytes },
        ];
      } catch {
        /* report render failed — send the text body without the attachment (honest degrade) */
      }
    }
    const result = await deps.sendEmail({ to, subject, text, attachments }, provider);
    if (!result.configured) {
      // Not a failure of the run — the run's outcome is available; delivery is simply not set up.
      // Recorded HONESTLY as "not configured", never a fake success.
      return {
        stepId: step.id,
        kind: 'output',
        status: 'done',
        output: outcome,
        detail: `sink: email (${provider}) — NOT CONFIGURED (${result.reason}). Outcome available, not sent.`,
      };
    }
    if (!result.ok) {
      return errorResult(step, `email sink (${provider}) failed: ${result.reason}`);
    }
    return {
      stepId: step.id,
      kind: 'output',
      status: 'done',
      output: outcome,
      detail: `sink: email (${provider}) — ${result.reason}`,
    };
  }

  // whatsapp (and any future sink) — no on-prem gateway sink wired this round. Recorded honestly.
  return {
    stepId: step.id,
    kind: 'output',
    status: 'done',
    output: outcome,
    detail: `sink: ${step.sink} — delivery not wired (outcome available, not sent)`,
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
  const state = initState(spec, ctx.runId);
  await deps.persist(state, input, ctx.orgId);
  return driveRunnableSteps(spec, state, [], input, ctx, deps);
}

// ─── driveRunnableSteps — the ONE step-driving loop (DRY: runApp + resumeAppRun both use it) ──────
// Given a starting AppRunState (fresh from initState for a first run, or rebuilt-and-decision-applied
// for a resume) plus the StepResults already produced, drive the pure scheduler to completion or to
// the next human pause: repeatedly take the next runnable steps, mark running + execute + fold the
// result in + persist, and stop on a terminal state, a step error, or an awaiting_human step. Returns
// the AppRunOutcome. This is the shared engine — no scheduling rule is duplicated between the two
// entry points. `priorResults` seeds the downstream-context threading + aggregate outcome with the
// steps that already ran (so a resume's downstream agent still sees the upstream outputs, and the
// aggregate outcome reflects the whole run, not just the steps run after the pause).
export async function driveRunnableSteps(
  spec: AppSpec,
  startState: AppRunState,
  priorResults: StepResult[],
  input: Record<string, unknown>,
  ctx: AppRunContext,
  deps: AppRunDeps,
): Promise<AppRunOutcome> {
  let state = startState;
  const results: StepResult[] = [...priorResults];

  // Bounded loop: at most one pass per step (a validated DAG). Guards against a pathological cycle.
  const maxIterations = (spec.steps?.length ?? 0) + 1;
  for (let i = 0; i <= maxIterations; i++) {
    const runnable = nextRunnableSteps(spec, completedStepIds(state));
    if (runnable.length === 0) break;

    let paused = false;
    for (const step of runnable) {
      // Mark running (for the live screen), then execute.
      state = applyStepResult(state, step.id, { status: 'running' });
      await deps.persist(state, input, ctx.orgId);

      const result = await executeStep(spec, step, results, ctx, deps);
      results.push(result);
      state = applyStepResult(state, step.id, {
        status: result.status,
        output: result.output,
        refs: result.refs,
        detail: result.detail,
        childRunId: result.childRunId,
        wouldPerform: result.wouldPerform,
      });
      await deps.persist(state, input, ctx.orgId);

      if (result.status === 'error') {
        // Halt the whole run on a step error (the run status is already 'error' via the reducer).
        return finalize(state, results);
      }
      if (result.status === 'awaiting_human') {
        // Stop here — the human decision resumes it (inline via resumeAppRun, or the durable workflow).
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
    if (o?.trim()) return o;
  }
  return '';
}

// A governed source must contain enough of the live result to substantiate the decision it drives.
// Five rows silently hid most small reference tables (for example 15/20 rate-card rows), allowing
// the model to make a global comparison that grounding could not verify. Keep the prompt bounded,
// but retain complete small operational tables and state explicitly when a larger result is clipped.
export const MAX_GOVERNED_SOURCE_ROWS = 20;
export function summarizeRows(label: string, resource: string, rows: unknown[], count: number): string {
  const shown = rows.slice(0, MAX_GOVERNED_SOURCE_ROWS);
  const head = `${label} (${resource}): ${count} row(s).`;
  if (shown.length === 0) return head;
  const coverage = count > shown.length ? ` Showing ${shown.length} of ${count}.` : '';
  return `${head}${coverage}\n${JSON.stringify(shown)}`;
}

function errorResult(step: AppStep, detail: string): StepResult {
  return { stepId: step.id, kind: step.kind, status: 'error', detail };
}

// mint a run id when a caller doesn't supply one (kept here so callers/tests can reuse it).
export function newAppRunId(): string {
  return `apprun_${randomUUID().slice(0, 8)}`;
}
