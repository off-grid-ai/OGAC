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
}

export async function runQaSweep(): Promise<QaSweep> {
  const at = new Date().toISOString();
  const [evalRun, drift] = await Promise.all([getEvals().run(), getDrift().analyze()]);

  const reasons: string[] = [];
  if (evalRun.score < MIN_SCORE) {
    reasons.push(`offline eval ${evalRun.score} < threshold ${MIN_SCORE}`);
  }
  if (drift.status === 'drift') reasons.push(`drift detected (${drift.engine})`);
  else if (drift.status === 'warning') reasons.push(`drift warning (${drift.engine})`);
  const degraded = evalRun.score < MIN_SCORE || drift.status === 'drift';

  // The alert seam: a span carrying the verdict. Backends (VictoriaMetrics / Langfuse) alert on
  // degraded=true; the same data is returned to the caller for a dashboard or CI gate.
  emitSpan('qa.sweep', {
    degraded,
    'eval.engine': evalRun.engine,
    'eval.score': evalRun.score,
    'drift.engine': drift.engine,
    'drift.status': drift.status,
    reasons: reasons.join('; ') || 'none',
  });

  return {
    at,
    degraded,
    reasons,
    eval: { engine: evalRun.engine, score: evalRun.score, passed: evalRun.passed, total: evalRun.total },
    drift: { engine: drift.engine, status: drift.status, note: drift.note },
  };
}
