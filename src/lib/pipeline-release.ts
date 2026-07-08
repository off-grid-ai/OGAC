// M1 "close the loop" ORCHESTRATION (I/O seam) — ties the PURE decisions (release-gate.ts,
// rollback-policy.ts) to the real eval runner + pipeline store + audit. Thin: it runs I/O and
// delegates every verdict to a pure function. Two entry points:
//
//   1. publishWithGate — run the pipeline's attached evals, apply evaluateReleaseGate, and either
//      publish (gate pass / ungated) or BLOCK (gate fail) unless `override` is set (then publish +
//      an honest `pipeline.publish.override` audit). Returns the decision either way so the route
//      surfaces WHY.
//   2. rollbackToLastGood — read the version history, pick the last-good published version
//      (pickRollbackTarget), restore it as live, freeze an `autorollback` snapshot, and audit
//      `pipeline.autorollback`. Fired on an eval-gate fail after publish OR a drift breach. Honest:
//      returns { rolledBack:false, reason } when there is no prior good version — never fakes it.
//
// Keeping this out of pipelines.ts avoids pulling the eval runner (which imports the gateway/brain)
// into the low-level store, and keeps the store free of a policy dependency (SOLID / no cycles).
import { recordAudit } from '@/lib/store';
import { actorFrom } from '@/lib/audit-event';
import { listEvalDefs, type EvalDef } from '@/lib/eval-defs';
import { runEvalDef } from '@/lib/eval-runner';
import {
  getPipeline,
  listPipelineVersions,
  publishPipeline,
  rollbackPipeline,
  type PipelineView,
} from '@/lib/pipelines';
import {
  evaluateReleaseGate,
  thresholdToPct,
  type GateEvalDef,
  type GateEvalResult,
  type ReleaseGateDecision,
} from '@/lib/release-gate';
import {
  pickRollbackTarget,
  rollbackNote,
  type RollbackCandidate,
  type RollbackReason,
} from '@/lib/rollback-policy';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// ─── 1. Release gate on publish ─────────────────────────────────────────────────────────────────────

export interface PublishGateResult {
  /** The pipeline view after publish, or null if it was blocked (gate failed, no override). */
  pipeline: PipelineView | null;
  /** The gate decision (always present — surfaced so the operator sees the verdict + reasons). */
  decision: ReleaseGateDecision;
  /** True when the gate failed but publish proceeded because `override` was set (audited). */
  overridden: boolean;
  /** True when publish was BLOCKED by a failing gate (no override). */
  blocked: boolean;
}

// Run ONE eval def and reduce it to the gate's per-eval input. Never throws — a runner failure is
// carried as `scored:false` (unavailable), which the pure gate treats honestly (no fake pass/fail).
async function runOneForGate(def: EvalDef, orgId: string): Promise<GateEvalResult> {
  const base = { evalId: def.id, name: def.name, thresholdPct: thresholdToPct(def.threshold) };
  try {
    const res = await runEvalDef(def, orgId);
    const scored = res.computedBy !== 'unavailable' && res.run.total > 0;
    return { ...base, score: scored ? res.run.score : 0, scored };
  } catch {
    return { ...base, score: 0, scored: false };
  }
}

/**
 * Publish a pipeline THROUGH its release gate. Runs the pipeline's attached evals, applies the pure
 * gate, and publishes iff the gate passes (or is ungated / no evals). On a failing gate: blocks
 * unless `override` — then publishes and records a `pipeline.publish.override` audit naming the
 * failing evals. Additive/safe: a pipeline with no evals publishes exactly as before.
 */
export async function publishWithGate(
  id: string,
  opts: { orgId?: string; by?: string; override?: boolean } = {},
): Promise<PublishGateResult | null> {
  const orgId = opts.orgId ?? DEFAULT_ORG;
  const by = opts.by ?? '';
  const pipeline = await getPipeline(id, orgId);
  if (!pipeline) return null;

  const defs = await listEvalDefs({ pipelineId: id });
  const gateDefs: GateEvalDef[] = defs.map((d) => ({
    id: d.id,
    name: d.name,
    threshold: d.threshold,
  }));

  // Run each attached eval (sequentially — each is a chain of gateway calls; parallel would saturate
  // the fixed local fleet). No evals ⇒ empty results ⇒ ungated pass (no runs fired).
  const results: GateEvalResult[] = [];
  for (const def of defs) results.push(await runOneForGate(def, orgId));

  const decision = evaluateReleaseGate(gateDefs, results);
  const actor = actorFrom({ email: by });

  if (decision.pass) {
    const published = await publishPipeline(id, orgId, by);
    return { pipeline: published, decision, overridden: false, blocked: false };
  }

  // Gate failed.
  if (opts.override) {
    const published = await publishPipeline(id, orgId, by);
    recordAudit({
      actor,
      org: orgId,
      action: 'pipeline.publish.override',
      resource: `pipeline:${id}`,
      outcome: 'ok',
    });
    return { pipeline: published, decision, overridden: true, blocked: false };
  }

  // Blocked — audit the blocked attempt so the trail shows the gate did its job.
  recordAudit({
    actor,
    org: orgId,
    action: 'pipeline.publish',
    resource: `pipeline:${id}`,
    outcome: 'blocked',
  });
  return { pipeline: null, decision, overridden: false, blocked: true };
}

// ─── 2. Auto-rollback to last-good published version ─────────────────────────────────────────────────

export interface RollbackResult {
  rolledBack: boolean;
  /** The restored pipeline view when a rollback happened; null otherwise. */
  pipeline: PipelineView | null;
  /** The version rolled back TO (null when nothing to roll back to). */
  toVersion: number | null;
  /** The version rolled back FROM. */
  fromVersion: number | null;
  /** Honest reason a rollback did NOT happen (no prior good version / unknown pipeline). */
  reason?: string;
}

/**
 * Roll a pipeline back to its LAST-GOOD published version. Fired on an eval-gate fail after publish
 * or a drift breach. Reads the version history, picks the target (pure), restores it as live, and
 * audits `pipeline.autorollback`. Honest: if there is no prior published version, returns
 * { rolledBack:false, reason } and leaves the pipeline untouched — never fabricates a rollback.
 */
export async function rollbackToLastGood(
  id: string,
  reason: RollbackReason,
  opts: { orgId?: string; by?: string; detail?: string } = {},
): Promise<RollbackResult> {
  const orgId = opts.orgId ?? DEFAULT_ORG;
  const by = opts.by ?? 'system@offgrid.local';
  const pipeline = await getPipeline(id, orgId);
  if (!pipeline) {
    return { rolledBack: false, pipeline: null, toVersion: null, fromVersion: null, reason: 'unknown pipeline' };
  }

  const versions = await listPipelineVersions(id, orgId);
  const candidates: RollbackCandidate[] = versions.map((v) => ({
    version: v.version,
    note: v.note,
    snapshot: v.snapshot as RollbackCandidate['snapshot'],
  }));

  const target = pickRollbackTarget(pipeline.version, candidates);
  if (!target) {
    return {
      rolledBack: false,
      pipeline: null,
      toVersion: null,
      fromVersion: pipeline.version,
      reason: 'no prior good (published) version to roll back to',
    };
  }

  const snap = target.snapshot as Record<string, unknown>;
  const note = rollbackNote(reason, pipeline.version, target.version, opts.detail);
  const restored = await rollbackPipeline(
    id,
    {
      name: typeof snap.name === 'string' ? snap.name : undefined,
      description: typeof snap.description === 'string' ? snap.description : undefined,
      visibility: typeof snap.visibility === 'string' ? snap.visibility : undefined,
      gatewayId: (snap.gatewayId as string | null | undefined) ?? undefined,
      defaultModel: (snap.defaultModel as string | null | undefined) ?? undefined,
      routing: snap.routing,
      dataAllowlist: Array.isArray(snap.dataAllowlist) ? (snap.dataAllowlist as string[]) : undefined,
      policyOverlay:
        snap.policyOverlay && typeof snap.policyOverlay === 'object'
          ? (snap.policyOverlay as Record<string, unknown>)
          : undefined,
      guardrailOverlay:
        snap.guardrailOverlay && typeof snap.guardrailOverlay === 'object'
          ? (snap.guardrailOverlay as Record<string, unknown>)
          : undefined,
      isTemplate: typeof snap.isTemplate === 'boolean' ? snap.isTemplate : undefined,
    },
    note,
    orgId,
    by,
  );

  if (!restored) {
    return { rolledBack: false, pipeline: null, toVersion: null, fromVersion: pipeline.version, reason: 'restore failed' };
  }

  recordAudit({
    actor: actorFrom({ email: by }),
    org: orgId,
    action: 'pipeline.autorollback',
    resource: `pipeline:${id}`,
    outcome: 'ok',
  });

  return {
    rolledBack: true,
    pipeline: restored,
    toVersion: target.version,
    fromVersion: pipeline.version,
  };
}

// ─── Rollback history read (for the Quality / Versions tab) ──────────────────────────────────────────
export interface RollbackHistoryEntry {
  version: number;
  note: string;
  at: string | null;
  by: string;
}

/** The pipeline's rollback events, newest first — the `autorollback` version snapshots. Reuses the
 *  existing append-only version history (no separate table); the Versions/Quality tab renders these. */
export async function listRollbackHistory(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<RollbackHistoryEntry[]> {
  const versions = await listPipelineVersions(id, orgId);
  return versions
    .filter((v) => v.note.toLowerCase().startsWith('auto-rollback'))
    .map((v) => ({ version: v.version, note: v.note, at: v.createdAt, by: v.createdBy }));
}
