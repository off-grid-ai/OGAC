import { getDrift, getEvals } from '@/lib/adapters/registry';
import { emitSpan } from '@/lib/otel';

// Scheduled Agent-QA sweep — run an offline eval + a drift/degradation analysis, decide whether the
// fleet of agents has degraded, and emit the verdict as an OTLP span (`qa.sweep`) so the
// observability backend can alert on `degraded=true`. Meant to be hit on a cadence (cron / CI /
// scheduler) against the admin API; it's the out-of-band complement to the per-request online score.
const MIN_SCORE = Number(process.env.OFFGRID_QA_MIN_SCORE ?? '70');

export interface QaSweep {
  at: string;
  degraded: boolean;
  reasons: string[];
  eval: { engine: string; score: number; passed: number; total: number };
  drift: { engine: string; status: string; note?: string };
  /** When AUTO-ROLLBACK fired off a drift breach: how many published pipelines were reverted to
   *  their last-good version. Absent when auto-rollback is disabled or no breach occurred. */
  autoRollback?: { fired: boolean; reason: string | null; rolledBack: number; detail: string };
}

// Auto-rollback on a drift breach is gated behind an env flag: automatically reverting live pipeline
// config is high-impact, so it's OPT-IN (OFFGRID_AUTO_ROLLBACK_ON_DRIFT=1). When off, the sweep still
// reports degraded — an operator can then roll back manually — but nothing reverts on its own.
const AUTO_ROLLBACK_ON_DRIFT = process.env.OFFGRID_AUTO_ROLLBACK_ON_DRIFT === '1';

export async function runQaSweep(opts: { orgId?: string } = {}): Promise<QaSweep> {
  const at = new Date().toISOString();
  const [evalRun, drift] = await Promise.all([
    getEvals().run(opts.orgId),
    getDrift().analyze({ orgId: opts.orgId }),
  ]);

  const reasons: string[] = [];
  if (evalRun.score < MIN_SCORE) {
    reasons.push(`offline eval ${evalRun.score} < threshold ${MIN_SCORE}`);
  }
  if (drift.status === 'drift') reasons.push(`drift detected (${drift.engine})`);
  else if (drift.status === 'warning') reasons.push(`drift warning (${drift.engine})`);
  const degraded = evalRun.score < MIN_SCORE || drift.status === 'drift';

  // AUTO-ROLLBACK: on a real drift BREACH, revert the org's published pipelines to their last-good
  // version automatically (the trigger that makes "auto-rollback" true). Best-effort — a rollback
  // failure never breaks the sweep's own report. Only runs when the opt-in flag is set.
  let autoRollback: QaSweep['autoRollback'];
  if (AUTO_ROLLBACK_ON_DRIFT && drift.status === 'drift') {
    try {
      const { autoRollbackOnSweep } = await import('@/lib/auto-rollback');
      const summary = await autoRollbackOnSweep(drift.status, { orgId: opts.orgId });
      autoRollback = {
        fired: summary.fired,
        reason: summary.reason,
        rolledBack: summary.rolledBack,
        detail: summary.detail,
      };
      if (summary.fired && summary.rolledBack > 0) {
        reasons.push(`auto-rollback reverted ${summary.rolledBack} pipeline(s) to last-good`);
      }
    } catch (err) {
      autoRollback = {
        fired: false,
        reason: null,
        rolledBack: 0,
        detail: `auto-rollback failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // The alert seam: a span carrying the verdict. Backends (VictoriaMetrics / Langfuse) alert on
  // degraded=true; the same data is returned to the caller for a dashboard or CI gate.
  emitSpan('qa.sweep', {
    degraded,
    'eval.engine': evalRun.engine,
    'eval.score': evalRun.score,
    'drift.engine': drift.engine,
    'drift.status': drift.status,
    'autorollback.fired': autoRollback?.fired ?? false,
    'autorollback.rolledback': autoRollback?.rolledBack ?? 0,
    reasons: reasons.join('; ') || 'none',
  });

  return {
    at,
    degraded,
    reasons,
    eval: { engine: evalRun.engine, score: evalRun.score, passed: evalRun.passed, total: evalRun.total },
    drift: { engine: drift.engine, status: drift.status, note: drift.note },
    ...(autoRollback ? { autoRollback } : {}),
  };
}
