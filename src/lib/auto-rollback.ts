// ─────────────────────────────────────────────────────────────────────────────────────────────
// AUTO-ROLLBACK TRIGGER — make "auto-rollback" actually automatic.
//
// The ACT half of "close the loop" already existed: rollbackToLastGood (pipeline-release.ts) restores
// a pipeline's last-good published version + audits it. But NOTHING fired it automatically — only an
// operator button did, despite comments claiming "auto". This module is the missing trigger: on a
// DRIFT BREACH or an EVAL-GATE FAILURE for a published pipeline, it invokes the rollback with an
// audit event, so auto-rollback is real.
//
// SOLID seam:
//   • shouldAutoRollback() — PURE, zero-IO, unit-testable. Given a drift status (or an eval-gate
//     decision) it returns whether a rollback should fire and WHY. No DB, no registry.
//   • autoRollbackPublished() — the thin I/O orchestration: enumerate the org's PUBLISHED pipelines
//     and roll each back to its last-good version via the existing rollbackToLastGood. Honest: a
//     pipeline with no prior good version is left untouched (rollbackToLastGood already reports that).
//
// Wiring: the QA sweep (qa/sweep.ts) — the real drift/eval signal path — calls autoRollbackOnSweep
// after it computes its verdict, so a degraded fleet self-heals. The publish gate can also call
// autoRollbackOnGateFail for a post-publish re-gate failure.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { DriftStatus } from '@/lib/adapters/types';
import type { RollbackResult } from '@/lib/pipeline-release';
import type { ReleaseGateDecision } from '@/lib/release-gate';
import type { RollbackReason } from '@/lib/rollback-policy';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// The pure verdict: does the observed quality signal warrant an automatic rollback, and why?
export interface AutoRollbackDecision {
  fire: boolean;
  reason: RollbackReason | null;
  detail: string;
}

/**
 * Decide whether a DRIFT signal warrants an auto-rollback. PURE.
 * A hard 'drift' breach fires; 'warning' and 'stable' do NOT (a warning is a heads-up, not a
 * regression worth reverting live config over — reverting on every wobble would thrash the fleet).
 */
export function shouldAutoRollbackOnDrift(status: DriftStatus): AutoRollbackDecision {
  if (status === 'drift') {
    return { fire: true, reason: 'drift-breach', detail: 'drift breach detected (PSI/degradation over threshold)' };
  }
  return { fire: false, reason: null, detail: `drift status "${status}" — no rollback` };
}

/**
 * Decide whether an EVAL-GATE decision (re-run AFTER publish) warrants an auto-rollback. PURE.
 * Fires only on a real, GATED failure (an eval produced a scored verdict below threshold). An
 * ungated decision (no eval could score) never fires — we never revert on a verdict we couldn't
 * compute, mirroring the release-gate's honesty bar.
 */
export function shouldAutoRollbackOnGate(decision: ReleaseGateDecision): AutoRollbackDecision {
  if (decision.gated && !decision.pass && decision.failing.length > 0) {
    const names = decision.failing.map((f) => f.name).join(', ');
    return { fire: true, reason: 'eval-gate-fail', detail: `post-publish eval gate failed: ${names}` };
  }
  return { fire: false, reason: null, detail: 'eval gate passed or ungated — no rollback' };
}

// ─── I/O orchestration ──────────────────────────────────────────────────────────────────────────

export interface AutoRollbackSummary {
  fired: boolean;
  reason: RollbackReason | null;
  detail: string;
  /** Per-pipeline rollback results (only the ones we attempted). */
  results: { pipelineId: string; result: RollbackResult }[];
  /** Count of pipelines actually rolled back (had a prior good version). */
  rolledBack: number;
}

// Roll back EVERY published pipeline in an org to its last-good version. Used by the drift trigger
// (a fleet-wide degradation isn't pipeline-specific — every live pipeline is suspect). Honest: a
// pipeline with no prior good version is left as-is (rollbackToLastGood reports rolledBack:false).
async function rollbackAllPublished(
  orgId: string,
  reason: RollbackReason,
  detail: string,
  by: string,
): Promise<AutoRollbackSummary['results']> {
  const { listPipelines } = await import('@/lib/pipelines');
  const { rollbackToLastGood } = await import('@/lib/pipeline-release');
  const pipelines = await listPipelines(orgId);
  const published = pipelines.filter((p) => p.status === 'published');
  const results: AutoRollbackSummary['results'] = [];
  for (const p of published) {
    const result = await rollbackToLastGood(p.id, reason, { orgId, by, detail });
    results.push({ pipelineId: p.id, result });
  }
  return results;
}

/**
 * Fire an auto-rollback for an org when a DRIFT breach is observed. Given the drift status, it
 * decides (pure) then rolls back all published pipelines. A non-breach status is a no-op. This is
 * the automatic trigger the QA sweep calls — the thing that makes "auto-rollback" true.
 */
export async function autoRollbackOnDrift(
  driftStatus: DriftStatus,
  opts: { orgId?: string; by?: string } = {},
): Promise<AutoRollbackSummary> {
  const orgId = opts.orgId ?? DEFAULT_ORG;
  const by = opts.by ?? 'system@offgrid.local';
  const decision = shouldAutoRollbackOnDrift(driftStatus);
  if (!decision.fire || !decision.reason) {
    return { fired: false, reason: null, detail: decision.detail, results: [], rolledBack: 0 };
  }
  const results = await rollbackAllPublished(orgId, decision.reason, decision.detail, by);
  return {
    fired: true,
    reason: decision.reason,
    detail: decision.detail,
    results,
    rolledBack: results.filter((r) => r.result.rolledBack).length,
  };
}

/**
 * Fire an auto-rollback for ONE pipeline when its post-publish eval gate fails. Given the gate
 * decision, it decides (pure) then rolls that pipeline back. An ungated / passing decision is a
 * no-op.
 */
export async function autoRollbackOnGateFail(
  pipelineId: string,
  decision: ReleaseGateDecision,
  opts: { orgId?: string; by?: string } = {},
): Promise<AutoRollbackSummary> {
  const orgId = opts.orgId ?? DEFAULT_ORG;
  const by = opts.by ?? 'system@offgrid.local';
  const verdict = shouldAutoRollbackOnGate(decision);
  if (!verdict.fire || !verdict.reason) {
    return { fired: false, reason: null, detail: verdict.detail, results: [], rolledBack: 0 };
  }
  const { rollbackToLastGood } = await import('@/lib/pipeline-release');
  const result = await rollbackToLastGood(pipelineId, verdict.reason, { orgId, by, detail: verdict.detail });
  return {
    fired: true,
    reason: verdict.reason,
    detail: verdict.detail,
    results: [{ pipelineId, result }],
    rolledBack: result.rolledBack ? 1 : 0,
  };
}

/**
 * The QA-sweep entry point: called after the sweep computes its drift verdict. Auto-rolls-back the
 * org's published pipelines on a drift breach. Best-effort by contract of the caller (the sweep
 * swallows failures so a rollback attempt never breaks the sweep's own report).
 */
export async function autoRollbackOnSweep(
  driftStatus: DriftStatus,
  opts: { orgId?: string; by?: string } = {},
): Promise<AutoRollbackSummary> {
  return autoRollbackOnDrift(driftStatus, opts);
}
