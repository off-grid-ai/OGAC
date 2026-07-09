// ─── The public-pipeline EXECUTOR (PA-11) — the thin I/O layer that actually RUNS a provisioned call ─
//
// The public route (POST /api/v1/pipeline/<id>/run) does key-auth + the governed decision
// (enforceModelCall over the pipeline's contract). Previously it STOPPED at the verdict and returned a
// "plan" — a provisioned pipeline was never actually callable end-to-end. THIS module closes that gap:
// given an ALLOWED governed verdict + the resolved pipeline, it executes the model call through the
// governed path and returns the real completion + governance metadata.
//
// The governed order (mirrors the agent-run reference path in agentrun.ts, minus retrieval — the
// public API is a direct governed completion, not a RAG agent):
//   guardrails(pre) → [block ⇒ refuse] → PII-mask-before-model (when the overlay requires it)
//   → gateway model call (the real inference) → guardrails(post, recorded) → governed result.
//
// SOLID: all scheduling/shape decisions are PURE in pipeline-run-plan.ts; this file is the thin I/O
// executor. Its external boundaries — the gateway completion, the guardrail check, the PII scan — are
// INJECTED (ExecuteDeps) so the whole path is unit-testable without a live gateway/DB, and production
// wires the real subsystems via defaultExecuteDeps(). HONESTY: a gateway outage or an empty completion
// is surfaced as a clean error (status 'error'), never a fabricated 200.

import type { CheckResult } from '@/lib/checks';
import type { ModelCallVerdict } from '@/lib/pipeline-enforcement';
import { applyPiiEscalation, effectivePiiMasking } from '@/lib/pii-escalation';
import { buildRunPlan, extractPrompt, type PipelineRunPlan } from '@/lib/pipeline-run-plan';

// ─── the resolved pipeline facts the executor needs (a DB-free snapshot) ────────────────────────────
export interface ExecutablePipeline {
  id: string;
  version: number;
  defaultModel: string | null;
  /** The bound gateway identity, echoed into the governed result's metadata (never re-resolved here). */
  gateway: { id: string; name: string } | null;
}

// ─── the injected boundaries (mocked SPARINGLY in tests — these are the only real I/O) ──────────────
export interface GatewayCompletion {
  /** The model that actually answered (echoed for FinOps/metadata). */
  model: string;
  /** The completion text. Empty/whitespace ⇒ the executor treats it as a gateway failure. */
  text: string | null;
  /** Token usage when the gateway reported it (best-effort; 0s when unknown). */
  usage?: { prompt: number; completion: number; total: number };
}

export interface ExecuteDeps {
  /**
   * Call the governed gateway for a single completion. `forceLocal` MUST keep the call on-prem (the
   * egress leash decided 'local'); the production impl passes a data-class the gateway routes locally.
   * Returns null text on any transport failure — the executor turns that into a clean error.
   */
  gatewayComplete: (args: {
    model: string;
    prompt: string;
    forceLocal: boolean;
    caller?: string;
    /** The effective (policy-clamped) request parameters to forward, e.g. { max_tokens, temperature }. */
    params?: Record<string, unknown>;
  }) => Promise<GatewayCompletion>;
  /** Guardrail check path (reuse of runChecks + outcomeFromChecks). Returns the raw results + outcome. */
  runGuardrail: (
    phase: 'pre' | 'post',
    text: string,
    orgId: string,
    model: string,
  ) => Promise<{ checks: CheckResult[]; outcome: 'ok' | 'redacted' | 'blocked' }>;
  /** PII scan → a redacted form of the text (for the mask-before-model substitution). */
  scanPii: (text: string, orgId: string) => Promise<{ hits: boolean; redacted?: string; entities: string[]; engine: string }>;
  /** Emit a governed audit event for this invocation (best-effort; never throws). */
  audit: (
    action: string,
    outcome: 'ok' | 'blocked' | 'redacted' | 'error',
    detail: string,
    model: string | null,
    tokens: number,
  ) => void;
  /** The env-configured default model when neither the leash nor the pipeline names one. */
  defaultModel: string;
}

// ─── the governed result the route returns ──────────────────────────────────────────────────────────
export type PipelineExecuteResult =
  | {
      status: 'ok';
      runId: string;
      /** The real completion text. */
      output: string;
      model: string;
      egress: 'local' | 'cloud';
      /** true when the inbound prompt was PII-masked before the model call. */
      masked: boolean;
      usage: { prompt: number; completion: number; total: number };
      checks: CheckResult[];
    }
  | {
      status: 'blocked';
      runId: string;
      /** Why the call was refused (guardrail block or a missing prompt). */
      reason: string;
      checks: CheckResult[];
    }
  | {
      status: 'error';
      runId: string;
      /** A clean, honest error — the gateway was unreachable or returned nothing. NEVER a fake answer. */
      reason: string;
    };

/**
 * Execute a provisioned pipeline call end-to-end. Precondition: `verdict.allow === true` (the route
 * refuses a blocked egress verdict BEFORE calling this — a blocked call never reaches here). PURE
 * decisions come from buildRunPlan; every I/O hop goes through an injected dep.
 *
 * @param runId       the correlation id the route minted (audit/trace key)
 * @param pipeline    the resolved published pipeline
 * @param verdict     the governed enforceModelCall verdict (allow === true)
 * @param leashModel  the model the routing leash named for this data-class (may be null)
 * @param body        the caller's request body (the prompt is extracted from it)
 * @param orgId       the key's org (tenant-scopes guardrails + PII)
 * @param caller      attribution string for FinOps (the key id)
 */
export async function executePipelineRun(
  runId: string,
  pipeline: ExecutablePipeline,
  verdict: ModelCallVerdict,
  leashModel: string | null,
  body: Record<string, unknown>,
  orgId: string,
  caller: string | undefined,
  deps: ExecuteDeps,
  /**
   * OPTIONAL deterministic REQUEST-shape gates from the pipeline contract (request-policy.ts). Absent
   * ⇒ the pre-check no-ops (additive). When present: banned-param / out-of-range temperature|top_p ⇒
   * BLOCK before the model is touched; max_tokens over the ceiling is CLAMPED and forwarded.
   */
  requestPolicy: {
    requestParamsPolicy?: import('@/lib/request-policy').RequestParamsPolicy;
    modelRules?: import('@/lib/request-policy').ModelRules;
  } = {},
): Promise<PipelineExecuteResult> {
  const plan: PipelineRunPlan = buildRunPlan(verdict, leashModel, pipeline.defaultModel, deps.defaultModel);

  // A provisioned call with no prompt is a 400-shaped refusal — never a fabricated call to the model.
  const prompt = extractPrompt(body);
  if (!prompt) {
    deps.audit('pipeline.invoke', 'blocked', 'no prompt supplied (input/prompt/messages)', plan.model, 0);
    return { status: 'blocked', runId, reason: 'no prompt supplied — provide `input`, `prompt`, or `messages`', checks: [] };
  }

  // 0. Deterministic REQUEST-POLICY pre-check (config, no ML, no network): validate the request's
  //    model parameters + the RESOLVED model against the pipeline policy. A hard BLOCK (banned param,
  //    out-of-range sampling, denylisted/non-allowlisted model) refuses BEFORE any guardrail scan or
  //    model call; a max_tokens clamp is recorded and the clamped params are forwarded to the gateway.
  //    Absent policy ⇒ no-op pass (additive). PURE decision from checkRequestPolicy.
  const { checkRequestPolicy } = await import('@/lib/request-policy');
  const pre0 = checkRequestPolicy(
    requestPolicy.requestParamsPolicy,
    requestPolicy.modelRules,
    body,
    plan.model,
  );
  if (!pre0.allow) {
    deps.audit('pipeline.invoke', 'blocked', `request policy: ${pre0.reason}`, plan.model, 0);
    return { status: 'blocked', runId, reason: pre0.reason, checks: [] };
  }
  if (pre0.params.clamped.length > 0) {
    deps.audit('pipeline.params.clamp', 'redacted', pre0.params.reason, plan.model, 0);
  }
  const effectiveParams = pre0.params.params;

  // 1. Guardrails (input) — PII + injection + operator rules on the prompt. A 'blocked' verdict refuses.
  const pre = await deps.runGuardrail('pre', prompt, orgId, plan.model);
  if (pre.outcome === 'blocked') {
    deps.audit('pipeline.invoke', 'blocked', 'input guardrail blocked the prompt', plan.model, 0);
    return { status: 'blocked', runId, reason: 'input guardrail blocked the prompt', checks: pre.checks };
  }

  // 2. PII mask BEFORE the model — when the pipeline's guardrail overlay ESCALATES masking ON above
  //    the org floor, the raw prompt is replaced with its PII-redacted form so the raw PAN/email/phone
  //    never leaves the box. The "does masking apply?" decision = max(floor, overlay) is the PURE
  //    effectivePiiMasking() and the raw→redacted substitution is the PURE applyPiiEscalation() — the
  //    SAME single authority every run path shares (agentrun / chat-run / app-run). Additive: with
  //    masking not escalated, the prompt is untouched. Best-effort — a detector outage leaves the
  //    prompt as-is (the egress leash's local-only guarantee still holds).
  let modelPrompt = prompt;
  let masked = false;
  const requireMasking = effectivePiiMasking(false, plan);
  if (requireMasking) {
    try {
      const scan = await deps.scanPii(prompt, orgId);
      const esc = applyPiiEscalation(prompt, requireMasking, scan);
      if (esc.masked) {
        modelPrompt = esc.text;
        masked = true;
        deps.audit(
          'pipeline.pii.mask',
          'redacted',
          `masked ${scan.entities.join(', ')} (${scan.engine}) before model call`,
          plan.model,
          0,
        );
      }
    } catch {
      /* detector unavailable — send the prompt unmasked (leash guarantees still hold) */
    }
  }

  // 3. The MODEL CALL — the real inference through the governed gateway. forceLocal keeps a leashed
  //    call on-prem. A null/empty completion is a gateway failure → a CLEAN error, never a fake 200.
  let completion: GatewayCompletion;
  try {
    completion = await deps.gatewayComplete({
      model: plan.model,
      prompt: modelPrompt,
      forceLocal: plan.forceLocal,
      caller,
      params: effectiveParams,
    });
  } catch (e) {
    deps.audit('pipeline.invoke', 'error', `gateway call failed: ${(e as Error).message}`, plan.model, 0);
    return { status: 'error', runId, reason: `gateway call failed: ${(e as Error).message}` };
  }
  const text = (completion.text ?? '').trim();
  if (!text) {
    deps.audit('pipeline.invoke', 'error', 'gateway returned no completion', plan.model, 0);
    return { status: 'error', runId, reason: 'gateway returned no completion (upstream unavailable or empty)' };
  }

  // 4. Guardrails (output) — scan the answer before it leaves (recorded; non-blocking, mirrors the
  //    agent-run path where the output scan is observational, so a governed answer is still returned).
  const post = await deps.runGuardrail('post', text, orgId, completion.model || plan.model);

  const usage = completion.usage ?? { prompt: 0, completion: 0, total: 0 };
  deps.audit('pipeline.invoke', 'ok', `executed on ${completion.model || plan.model}`, completion.model || plan.model, usage.total);

  return {
    status: 'ok',
    runId,
    output: text,
    model: completion.model || plan.model,
    egress: plan.egress,
    masked,
    usage,
    checks: [...pre.checks, ...post.checks],
  };
}
