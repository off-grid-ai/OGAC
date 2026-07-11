// I/O adapter for PA-16 run-path enforcement — the impure seam behind the PURE pipeline-enforcement.ts.
//
// It does the two things the pure layer cannot:
//   1. resolveContract(pipelineId, orgId) — load the bound pipeline (getPipeline) + the org governance
//      baseline + normalize the stored overlays into a DB-free PipelineContract the pure decisions
//      consume. Returns null when no pipeline is bound / it can't be resolved → the run falls back to
//      legacy behaviour (the ADDITIVE guarantee).
//   2. auditEnforcement(...) — emit a pipeline-tagged audit event for an enforced decision (deny/route/
//      mask), reusing the canonical recordAudit path. Best-effort (never throws).
//
// The org governance baseline is the seeded ORG_POLICY_DEFAULTS / ORG_GUARDRAIL_DEFAULTS (there is no
// org-governance store yet — see pipeline-governance.ts; those constants ARE the org substrate today).

import { type PipelineContract, enforcementResource } from '@/lib/pipeline-enforcement';
import {
  ORG_GUARDRAIL_DEFAULTS,
  ORG_POLICY_DEFAULTS,
  normalizeOverlay,
} from '@/lib/pipeline-governance';
import { isConsumable } from '@/lib/pipeline-lifecycle-model';
import { getPipeline } from '@/lib/pipelines';
import { parseModelRules, parseRequestParamsPolicy } from '@/lib/request-policy';
import { recordAudit } from '@/lib/store';

/**
 * Resolve the enforceable contract for a run's bound pipeline. Returns null when:
 *   • pipelineId is null/empty (no binding) — legacy behaviour applies, OR
 *   • the pipeline can't be loaded for this org (deleted / cross-tenant) — fail OPEN to legacy so a
 *     missing pipeline never breaks a run that used to work (additive-only). This is intentional: PA-16
 *     ENFORCES a contract that exists; it does not invent one when none is resolvable.
 * Never throws — a DB hiccup degrades to null (legacy) rather than failing the run.
 */
export async function resolveContract(
  pipelineId: string | null | undefined,
  orgId: string,
): Promise<PipelineContract | null> {
  if (!pipelineId) return null;
  try {
    const pipeline = await getPipeline(pipelineId, orgId);
    if (!pipeline) return null;
    // LIFECYCLE GATE (G-ADV-PIPE-2/3): only a PUBLISHED pipeline may govern a consumer run. A
    // deprecated/archived pipeline (retired → fall back to org default) or a draft/in_review one
    // (never approved/gate-passed → the release gate must not be bypassable on the internal paths)
    // resolves to null here — exactly the "fall back to legacy / org default" path a missing binding
    // takes. ONE gate on the ONE seam every internal consumer (chat/agent/app/trigger) flows through,
    // mirroring the public run route's `status !== 'published'` 409.
    if (!isConsumable(pipeline.status)) return null;
    // The deterministic REQUEST-shape gates are OPTIONAL slices operators set on the RAW policy
    // overlay JSON (`requestParams` = param ceilings/bounds/banned-list; `modelRules` = model
    // allow/denylist). We parse them purely (parse* narrows/validates) and attach when present;
    // absent/garbage ⇒ undefined ⇒ the pre-checks no-op (additive, no behaviour change).
    const rawPolicyOverlay =
      pipeline.policyOverlay && typeof pipeline.policyOverlay === 'object'
        ? (pipeline.policyOverlay as Record<string, unknown>)
        : {};
    return {
      pipelineId: pipeline.id,
      dataAllowlist: pipeline.dataAllowlist ?? [],
      routing: pipeline.routing ?? {},
      orgPolicyDefaults: ORG_POLICY_DEFAULTS,
      orgGuardrailDefaults: ORG_GUARDRAIL_DEFAULTS,
      policyOverlay: normalizeOverlay(pipeline.policyOverlay, ORG_POLICY_DEFAULTS),
      guardrailOverlay: normalizeOverlay(pipeline.guardrailOverlay, ORG_GUARDRAIL_DEFAULTS),
      requestParamsPolicy: parseRequestParamsPolicy(rawPolicyOverlay.requestParams),
      modelRules: parseModelRules(rawPolicyOverlay.modelRules),
    };
  } catch {
    return null;
  }
}

/** The actor/org/run context an enforcement audit event is stamped with. */
export interface EnforcementAuditContext {
  orgId: string;
  actor?: string;
  runId: string;
  contract: PipelineContract | null;
}

/**
 * Emit a pipeline-tagged audit event for an enforced decision. `action` is the enforcement verb
 * (e.g. 'pipeline.data.deny', 'pipeline.egress.block', 'pipeline.mask'); `resourceBase` is the thing
 * acted on (e.g. `data:<domain>`, `model:<id>`). Best-effort — recordAudit is already fire-and-forget.
 */
export function auditEnforcement(
  ctx: EnforcementAuditContext,
  action: string,
  resourceBase: string,
  outcome: 'ok' | 'blocked' | 'redacted' | 'error',
  detail?: string,
): void {
  recordAudit({
    actor: ctx.actor
      ? { type: 'user', id: ctx.actor, label: ctx.actor }
      : { type: 'machine', id: 'system', label: 'system' },
    org: ctx.orgId,
    action,
    // The compound resource carries the pipeline tag so the per-pipeline audit lens lights up, plus
    // the reason detail appended so the ledger is self-explaining.
    resource: detail
      ? `${enforcementResource(resourceBase, ctx.contract)} — ${detail}`
      : enforcementResource(resourceBase, ctx.contract),
    outcome,
    runId: ctx.runId,
  });
}
