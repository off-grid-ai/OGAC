// M2 lifecycle ORCHESTRATION (I/O seam) — ties the PURE decisions (pipeline-lifecycle-model.ts,
// teams-policy.ts) to the pipeline store, the team-membership store, M1's release gate, and audit.
// Thin: it runs I/O and delegates every verdict to a pure function. Entry points:
//
//   1. resolvePipelineRole(actor, pipeline) — resolve the actor's LifecycleRole ON a pipeline from
//      admin ∪ approver ∪ ownership ∪ team membership (reads the actor's memberships, applies the pure
//      resolveLifecycleRole). The seam every guarded action + the Overview control uses.
//   2. transitionPipeline(...) — perform a lifecycle action (promote/withdraw/approve/reject/
//      deprecate/revive). Guards with the pure canTransition (role × status), then:
//        • approve → runs THROUGH M1's publishWithGate (publish iff evals pass) and audits
//          `pipeline.approve` — no plain-language pipeline reaches published without an approver AND a
//          passing gate;
//        • every other action → a plain status set + the matching audit (pipeline.promote /
//          pipeline.deprecate / …). Honest: an illegal move (role/status) returns a `forbidden`
//          result and does nothing.
//
// Keeping this out of pipelines.ts avoids pulling the eval runner + team store into the low-level
// store (SOLID / no cycles), mirroring pipeline-release.ts.
import { actorFrom, type AuditAction } from '@/lib/audit-event';
import {
  type LifecycleAction,
  type LifecycleRole,
  canTransition,
  transitionTarget,
} from '@/lib/pipeline-lifecycle-model';
import { publishWithGate, type PublishGateResult } from '@/lib/pipeline-release';
import { getPipeline, updatePipeline, type PipelineView } from '@/lib/pipelines';
import { listPipelineConsumers, type PipelineConsumer } from '@/lib/pipeline-consumers';
import { recordAudit } from '@/lib/store';
import { listMembershipsForUser } from '@/lib/teams';
import { type ActorContext, resolveLifecycleRole } from '@/lib/teams-policy';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// ─── 1. resolve the actor's role on a pipeline ──────────────────────────────────────────────────────

export interface LifecycleActor {
  /** The acting user's email / id. */
  email: string;
  /** The actor's console RBAC role ('admin' | 'compliance' | 'viewer' | custom). */
  role?: string;
}

// Map the console RBAC role to the approver flag: an org admin is resolved to 'admin' directly; a
// `compliance` officer is a designated APPROVER (the sign-off authority for governed releases).
function actorContextFrom(actor: LifecycleActor): ActorContext {
  return {
    email: actor.email,
    isAdmin: actor.role === 'admin',
    isApprover: actor.role === 'compliance',
  };
}

/**
 * Resolve the actor's effective LifecycleRole on a specific pipeline (admin ∪ approver ∪ owner ∪ team).
 * Reads the actor's team memberships + the pipeline's ownership, then applies the pure resolver.
 */
export async function resolvePipelineRole(
  actor: LifecycleActor,
  pipeline: { ownerId: string; teamId: string | null },
  orgId: string = DEFAULT_ORG,
): Promise<LifecycleRole> {
  const ctx = actorContextFrom(actor);
  if (ctx.isAdmin) return 'admin'; // short-circuit — no membership read needed
  const memberships = await listMembershipsForUser(actor.email, orgId);
  return resolveLifecycleRole(
    ctx,
    { ownerId: pipeline.ownerId, teamId: pipeline.teamId },
    memberships,
  );
}

// ─── 2. perform a lifecycle transition ────────────────────────────────────────────────────────────

export interface TransitionResult {
  ok: boolean;
  /** The pipeline after the transition (null when forbidden / blocked / unknown). */
  pipeline: PipelineView | null;
  /** Set when the action was refused (role/status illegal, unknown pipeline). */
  forbidden?: boolean;
  /** For `approve`: the release-gate decision + whether publish was blocked (surfaced to the caller). */
  gate?: PublishGateResult | null;
  /** True when the approve was BLOCKED by a failing release gate (no override). */
  blocked?: boolean;
  reason?: string;
  consumers?: PipelineConsumer[];
}

// The audit action per lifecycle action — the honest promote/approve/deprecate trail the spec names.
const AUDIT_ACTION: Record<LifecycleAction, AuditAction> = {
  promote: 'pipeline.promote',
  withdraw: 'pipeline.withdraw',
  approve: 'pipeline.approve',
  reject: 'pipeline.reject',
  deprecate: 'pipeline.deprecate',
  revive: 'pipeline.revive',
};

/**
 * Perform a lifecycle `action` on a pipeline as `actor`. Guards with the pure role×status matrix, then
 * executes:
 *   • approve → publishWithGate (M1): publish iff the evals pass, or block (422) unless `override`;
 *     audited `pipeline.approve` (or `.approve` blocked).
 *   • otherwise → a plain status set to the pure transitionTarget + the matching audit.
 * Returns { forbidden } (does nothing) when the move is illegal for this actor/status.
 */
export async function transitionPipeline(
  id: string,
  action: LifecycleAction,
  actor: LifecycleActor,
  opts: { orgId?: string; override?: boolean } = {},
): Promise<TransitionResult> {
  const orgId = opts.orgId ?? DEFAULT_ORG;
  const pipeline = await getPipeline(id, orgId);
  if (!pipeline) return { ok: false, pipeline: null, forbidden: true, reason: 'unknown pipeline' };

  const role = await resolvePipelineRole(actor, pipeline, orgId);
  if (!canTransition(pipeline.status, role, action)) {
    return {
      ok: false,
      pipeline: null,
      forbidden: true,
      reason: `role '${role}' may not '${action}' from '${pipeline.status}'`,
    };
  }

  const by = actor.email || 'service@offgrid.local';
  const auditActor = actorFrom({ email: by, role: actor.role });

  // approve → publish through the M1 release gate.
  if (action === 'approve') {
    const gate = await publishWithGate(id, { orgId, by, override: opts.override === true });
    if (!gate) return { ok: false, pipeline: null, forbidden: true, reason: 'unknown pipeline' };
    if (gate.blocked) {
      recordAudit({
        actor: auditActor,
        org: orgId,
        action: 'pipeline.approve',
        resource: `pipeline:${id}`,
        outcome: 'blocked',
      });
      return { ok: false, pipeline: null, gate, blocked: true, reason: gate.decision.summary };
    }
    recordAudit({
      actor: auditActor,
      org: orgId,
      action: 'pipeline.approve',
      resource: `pipeline:${id}`,
      outcome: 'ok',
    });
    return { ok: true, pipeline: gate.pipeline, gate };
  }

  if (action === 'deprecate') {
    const consumers = await listPipelineConsumers(id, orgId);
    if (consumers.length > 0) {
      return {
        ok: false,
        pipeline: null,
        blocked: true,
        consumers,
        reason: `Rebind or remove ${consumers.length} consumer(s) before deprecating this pipeline.`,
      };
    }
  }

  // Every other action → a plain status set to the pure target.
  const to = transitionTarget(pipeline.status, action);
  if (!to) return { ok: false, pipeline: null, forbidden: true, reason: 'no target status' };
  const updated = await updatePipeline(id, { status: to }, orgId, by);
  if (!updated) return { ok: false, pipeline: null, forbidden: true, reason: 'update failed' };
  recordAudit({
    actor: auditActor,
    org: orgId,
    action: AUDIT_ACTION[action],
    resource: `pipeline:${id}`,
    outcome: 'ok',
  });
  return { ok: true, pipeline: updated };
}
