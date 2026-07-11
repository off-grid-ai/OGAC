// PURE pipeline-CONTRACT ENFORCEMENT rules — ZERO imports of db/IO, exhaustively unit-testable
// (mirrors pipelines-policy.ts / routing-policy.ts / tenancy-policy.ts). This is PA-16: the decision
// layer that, at RUN TIME, turns a resolved pipeline contract + a single request into an ALLOW / DENY
// / ROUTE / MASK verdict. It owns NO I/O — the run path (app-run.ts / agentrun.ts) calls these and
// performs the enforcement (deny the call, force-local, mask) + audit.
//
// It composes the EXISTING pure primitives, never re-implementing them:
//   • canReachData(allowlist, requested)          — the HARD data ceiling (pipelines-policy.ts)
//   • deriveEgress(routing, dataClass)            — the egress leash (pipelines-policy.ts → routing-policy)
//   • effectiveGovernance(orgDefaults, overlay)   — the policy/guardrail overlay merge (pipelines-policy.ts)
//
// The contract itself (PipelineContract) is a plain, DB-free snapshot the resolver (pipeline-contract.ts,
// the I/O adapter) hands in. When there is NO bound pipeline the resolver hands in `null`, and every
// decision here returns a PERMISSIVE "no-pipeline" verdict — that is the ADDITIVE guarantee: a run with
// no pipeline behaves EXACTLY as it did before this gate existed (org default / current routing).

import {
  type EffectiveGovernance,
  type GovernanceControls,
  type PermissionLevel,
  type PipelineRouting,
  PERMISSION_SCALE,
  canReachData,
  deriveEgress,
  effectiveGovernance,
} from '@/lib/pipelines-policy';
import type { RoutingDecision } from '@/lib/routing-policy';

// ─── the resolved contract the run path enforces ───────────────────────────────────────────────────
// A DB-free snapshot of the bound pipeline's governance-relevant config. The resolver (I/O) builds this
// from getPipeline() + the org governance defaults; this pure layer never loads it.
export interface PipelineContract {
  pipelineId: string;
  /** HARD data ceiling — a consumer may only touch data-domains/ids in this list. */
  dataAllowlist: string[];
  /** Routing envelope (egress leash + rules), fed to deriveEgress per data-class. */
  routing: PipelineRouting;
  /** The org governance baseline (locked/default controls) the overlay merges onto. */
  orgPolicyDefaults: GovernanceControls;
  orgGuardrailDefaults: GovernanceControls;
  /** This pipeline's policy overlay (tightening-only merge over orgPolicyDefaults). */
  policyOverlay: GovernanceControls;
  /** This pipeline's guardrail overlay (tightening-only merge over orgGuardrailDefaults). */
  guardrailOverlay: GovernanceControls;
  /**
   * OPTIONAL deterministic REQUEST-shape gates (request-policy.ts). Absent ⇒ the pre-checks no-op
   * (additive). Kept as a DISJOINT slice from the egress/overlay decisions above so the pure
   * request-policy layer owns them without this file re-implementing anything.
   */
  requestParamsPolicy?: import('@/lib/request-policy').RequestParamsPolicy;
  modelRules?: import('@/lib/request-policy').ModelRules;
}

// ─── verdicts ────────────────────────────────────────────────────────────────────────────────────

/** Verdict for a DATA-ACCESS request (a connector/data-domain read before it is hit). */
export interface DataAccessVerdict {
  /** true ⇒ the read may proceed; false ⇒ it is denied (outside the pipeline's ceiling). */
  allow: boolean;
  /** The requested data-domain / id, echoed for the audit trail. */
  requested: string;
  /** Human reason (for the governed error + audit detail). */
  reason: string;
  /** true when NO pipeline was bound → the legacy behaviour (allow) applies. */
  noPipeline: boolean;
}

/** Verdict for a MODEL-CALL request (egress leash + effective governance). */
export interface ModelCallVerdict {
  /** true ⇒ the call may proceed; false ⇒ it is blocked (egress leash → block). */
  allow: boolean;
  /** The effective egress after the leash: 'local' | 'cloud' | 'block'. */
  egress: RoutingDecision['effective'];
  /** true ⇒ the call MUST run on-prem (local) — never a cloud gateway. */
  forceLocal: boolean;
  /** true ⇒ retrieved inputs / outputs must be PII-masked before the model (guardrail overlay). */
  requirePiiMasking: boolean;
  /** true ⇒ inbound prompts must be injection-screened (guardrail overlay). */
  blockPromptInjection: boolean;
  /** true ⇒ a stated purpose is required for this invocation (policy overlay). */
  requirePurpose: boolean;
  /** Human reason (for the governed error + audit detail). */
  reason: string;
  /** true when NO pipeline was bound → the legacy behaviour applies. */
  noPipeline: boolean;
}

// ─── the effective-governance readout (pure helpers over effectiveGovernance) ──────────────────────

/** The merged effective controls for a slice (policy OR guardrail). PURE. */
function mergeSlice(defaults: GovernanceControls, overlay: GovernanceControls): EffectiveGovernance {
  return effectiveGovernance(defaults, overlay);
}

/** Is a boolean control effectively ON after the merge? Absent control ⇒ false. PURE. */
function boolOn(merged: EffectiveGovernance, key: string): boolean {
  return merged.controls[key]?.bool === true;
}

/** The effective permission LEVEL of a control after the merge (or undefined). PURE. */
function levelOf(merged: EffectiveGovernance, key: string): PermissionLevel | undefined {
  return merged.controls[key]?.level;
}

/** Rank of a level on the scale (-1 if none). Higher = more permissive. PURE. */
function levelRank(level: PermissionLevel | undefined): number {
  if (level === undefined) return -1;
  return (PERMISSION_SCALE as readonly string[]).indexOf(level);
}

// ─── 1. data-access enforcement — the HARD ceiling at the connector read ────────────────────────────

/**
 * Decide whether a run may read a given data-domain / id. PURE. With a bound pipeline this is the HARD
 * ceiling: the request must be inside `contract.dataAllowlist` (canReachData). With NO pipeline the
 * legacy behaviour applies — the read is allowed (the org's existing domain/ABAC checks still run
 * downstream; this gate simply adds nothing). An empty requested id is a deny (nothing to authorize).
 */
export function enforceDataAccess(
  contract: PipelineContract | null,
  requested: string,
): DataAccessVerdict {
  const req = (requested ?? '').trim();
  if (!contract) {
    return {
      allow: true,
      requested: req,
      reason: 'no pipeline bound — legacy data access (org checks still apply)',
      noPipeline: true,
    };
  }
  const allow = canReachData(contract.dataAllowlist, req);
  return {
    allow,
    requested: req,
    reason: allow
      ? `"${req}" is within the pipeline data allowlist`
      : `"${req}" is OUTSIDE the pipeline data allowlist (hard ceiling) — denied`,
    noPipeline: false,
  };
}

// ─── 2/3. model-call enforcement — egress leash + policy/guardrail overlay ──────────────────────────

/**
 * Decide whether — and HOW — a model call may proceed for a request of a given data-class. PURE.
 *
 * With a bound pipeline it composes:
 *   • the egress leash: deriveEgress(routing, dataClass). effective==='block' ⇒ the call is DENIED;
 *     effective==='local' ⇒ forceLocal (never a cloud gateway). This is tightened further by the
 *     policy overlay's `maxEgress` ceiling: if the ceiling is 'local'/'mask'/'block', a 'cloud' egress
 *     is demoted (the pipeline can only be MORE restrictive than the leash, never less).
 *   • the guardrail overlay: requirePiiMasking / blockPromptInjection (the run path applies these to
 *     inputs/outputs, reusing the existing guardrail path).
 *   • the policy overlay: requirePurpose.
 *
 * With NO pipeline the legacy behaviour applies: allow, egress 'cloud' (i.e. "don't add a leash the
 * caller didn't already have"), no forced masking beyond whatever the existing path already does.
 */
export function enforceModelCall(
  contract: PipelineContract | null,
  dataClass: string,
): ModelCallVerdict {
  if (!contract) {
    return {
      allow: true,
      egress: 'cloud',
      forceLocal: false,
      requirePiiMasking: false,
      blockPromptInjection: false,
      requirePurpose: false,
      reason: 'no pipeline bound — legacy routing (existing gateway/routing rules apply)',
      noPipeline: true,
    };
  }

  const policy = mergeSlice(contract.orgPolicyDefaults, contract.policyOverlay);
  const guardrail = mergeSlice(contract.orgGuardrailDefaults, contract.guardrailOverlay);

  // (a) the routing egress leash for this data-class.
  const decision = deriveEgress(contract.routing, dataClass);
  let egress = decision.effective;

  // (b) the policy overlay's maxEgress ceiling TIGHTENS the leash further (least-permissive-wins):
  //     if the ceiling ranks below the leash's egress, demote to the ceiling. On the PERMISSION_SCALE
  //     (block < mask < local < cloud < allow), a 'mask'/'block' ceiling collapses egress to 'block'
  //     (nothing may leave) and a 'local' ceiling collapses 'cloud' → 'local' (stay on-prem).
  const ceiling = levelOf(policy, 'maxEgress');
  if (ceiling !== undefined) {
    const egressRank = levelRank(egress as PermissionLevel);
    const ceilingRank = levelRank(ceiling);
    if (ceilingRank >= 0 && egressRank > ceilingRank) {
      if (ceiling === 'cloud') egress = 'cloud';
      else if (ceiling === 'local') egress = 'local';
      else egress = 'block';
    }
  }

  const allow = egress !== 'block';
  const forceLocal = egress === 'local';
  const requirePiiMasking = boolOn(guardrail, 'requirePiiMasking');
  const blockPromptInjection = boolOn(guardrail, 'blockPromptInjection');
  const requirePurpose = boolOn(policy, 'requirePurpose');

  let reason: string;
  if (!allow) reason = `egress leash blocked this call for data-class "${dataClass}" (${decision.reason})`;
  else if (forceLocal) reason = `data-class "${dataClass}" leashed to LOCAL (on-prem only)`;
  else reason = `egress "${egress}" permitted for data-class "${dataClass}"`;

  return {
    allow,
    egress,
    forceLocal,
    requirePiiMasking,
    blockPromptInjection,
    requirePurpose,
    reason,
    noPipeline: false,
  };
}

// ─── audit shaping — a pipeline-tagged resource string for the enforced decision ────────────────────

/**
 * The canonical resource string for an enforcement audit event: `<base> pipeline:<id>` when a pipeline
 * is bound (so the FinOps/audit "per-pipeline" lens lights up), else just `<base>`. PURE — mirrors the
 * tagging the run routes already do via pipelineRunTag, kept here so the enforcement producer is DRY.
 */
export function enforcementResource(base: string, contract: PipelineContract | null): string {
  return contract ? `${base} pipeline:${contract.pipelineId}` : base;
}
