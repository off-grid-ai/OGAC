// PURE observability threshold logic — zero imports, zero I/O, fully unit-testable.
//
// Operators tune two things here: alert thresholds (fire when a drift score or eval pass-rate
// crosses a bound) and a baseline reset marker. This module validates a threshold rule and
// evaluates a rule against an observed value. The DB store (observability-settings.ts) persists
// them; the route handlers stay thin.

export type ThresholdMetric = 'drift_score' | 'eval_pass_rate';
export type ThresholdOp = 'gt' | 'lt' | 'gte' | 'lte';

export interface ThresholdRuleInput {
  metric?: unknown;
  op?: unknown;
  value?: unknown;
  severity?: unknown;
}

export interface ThresholdRule {
  metric: ThresholdMetric;
  op: ThresholdOp;
  value: number;
  severity: 'warning' | 'critical';
}

export interface ValidationResult {
  ok: boolean;
  rule?: ThresholdRule;
  error?: string;
}

const METRICS: ThresholdMetric[] = ['drift_score', 'eval_pass_rate'];
const OPS: ThresholdOp[] = ['gt', 'lt', 'gte', 'lte'];

// Both metrics are normalized to a 0..1 fraction (drift score, pass-rate). Reject out-of-range.
export function validateThresholdRule(input: ThresholdRuleInput): ValidationResult {
  const metric = String(input?.metric ?? '');
  if (!METRICS.includes(metric as ThresholdMetric)) {
    return { ok: false, error: `metric must be one of ${METRICS.join(', ')}` };
  }
  const op = String(input?.op ?? '');
  if (!OPS.includes(op as ThresholdOp)) {
    return { ok: false, error: `op must be one of ${OPS.join(', ')}` };
  }
  const value = Number(input?.value);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return { ok: false, error: 'value must be a number between 0 and 1' };
  }
  const severity = input?.severity === 'critical' ? 'critical' : 'warning';
  return {
    ok: true,
    rule: {
      metric: metric as ThresholdMetric,
      op: op as ThresholdOp,
      value: Math.round(value * 1000) / 1000,
      severity,
    },
  };
}

// Does an observed value breach the rule?
export function ruleBreached(rule: ThresholdRule, observed: number): boolean {
  if (!Number.isFinite(observed)) return false;
  switch (rule.op) {
    case 'gt':
      return observed > rule.value;
    case 'gte':
      return observed >= rule.value;
    case 'lt':
      return observed < rule.value;
    case 'lte':
      return observed <= rule.value;
    default:
      return false;
  }
}

export interface AlertEvaluationInput {
  driftScore?: number | null;
  evalPassRate?: number | null;
}

export interface Alert {
  metric: ThresholdMetric;
  severity: 'warning' | 'critical';
  observed: number;
  rule: ThresholdRule;
  message: string;
}

const OP_TEXT: Record<ThresholdOp, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };

// Evaluate every rule against the current observed values, returning the alerts that fire.
// Rules whose metric has no observed value are skipped (not an error).
export function evaluateAlerts(rules: ThresholdRule[], obs: AlertEvaluationInput): Alert[] {
  const observedFor = (m: ThresholdMetric): number | null =>
    m === 'drift_score' ? (obs.driftScore ?? null) : (obs.evalPassRate ?? null);
  const alerts: Alert[] = [];
  for (const rule of rules) {
    const observed = observedFor(rule.metric);
    if (observed === null || observed === undefined) continue;
    if (ruleBreached(rule, observed)) {
      alerts.push({
        metric: rule.metric,
        severity: rule.severity,
        observed,
        rule,
        message: `${rule.metric} ${observed} ${OP_TEXT[rule.op]} ${rule.value} (${rule.severity})`,
      });
    }
  }
  return alerts;
}
