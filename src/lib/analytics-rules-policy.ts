// PURE analytics-rules policy — ZERO imports, ZERO I/O, fully unit-testable. Mirrors the
// tenancy-policy.ts / tenancy.ts split: this file holds the rule-validation, comparator, firing
// decision, and metric-extraction logic; analytics-rules.ts is its DB/OpenSearch adapter. Keeping
// this import-free lets the tests exercise the load-bearing logic without pulling in `@/db` (pg).

// The metrics an alert rule can watch — each maps to a scalar on the Analytics snapshot.
export const METRICS = [
  'p50',
  'p95',
  'totalEvents',
  'totalTokens',
  'egressRate',
  'blockedRate',
] as const;
export type Metric = (typeof METRICS)[number];

export const COMPARATORS = ['gt', 'gte', 'lt', 'lte'] as const;
export type Comparator = (typeof COMPARATORS)[number];

export interface RuleInput {
  name: string;
  metric: Metric;
  comparator: Comparator;
  threshold: number;
  windowMinutes: number;
  enabled: boolean;
}

export interface RuleValidation {
  valid: boolean;
  errors: string[];
  value?: RuleInput; // normalized input when valid
}

// Validate + normalize raw (untrusted) rule input. Pure — never throws, returns collected errors.
export function validateRule(raw: unknown): RuleValidation {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) errors.push('name is required');
  if (name.length > 120) errors.push('name must be 120 characters or fewer');

  const metric = r.metric as Metric;
  if (!METRICS.includes(metric)) errors.push(`metric must be one of: ${METRICS.join(', ')}`);

  const comparator = r.comparator as Comparator;
  if (!COMPARATORS.includes(comparator))
    errors.push(`comparator must be one of: ${COMPARATORS.join(', ')}`);

  const threshold = Number(r.threshold);
  if (!Number.isFinite(threshold)) errors.push('threshold must be a finite number');

  const windowMinutes = Number(r.windowMinutes);
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0)
    errors.push('windowMinutes must be a positive number');

  const enabled = r.enabled === undefined ? true : Boolean(r.enabled);

  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    value: {
      name,
      metric,
      comparator,
      threshold,
      windowMinutes: Math.floor(windowMinutes),
      enabled,
    },
  };
}

// Pure comparator application: is `value <comparator> threshold` true?
export function compare(value: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    default:
      return false;
  }
}

// Pure threshold evaluation: given the current metric value and a rule, is the rule FIRING?
// A disabled rule never fires. This is the load-bearing decision, kept pure for unit tests.
export function evaluateRule(
  rule: { enabled: boolean; comparator: string; threshold: number },
  value: number,
): boolean {
  if (!rule.enabled) return false;
  return compare(value, rule.comparator as Comparator, rule.threshold);
}

// Map an Analytics snapshot to the scalar for a metric. Pure.
export function metricValue(
  a: {
    p50: number;
    p95: number;
    totalEvents: number;
    totalTokens: number;
    egressRate: number;
    outcomes: { ok: number; redacted: number; blocked: number };
  },
  metric: Metric,
): number {
  switch (metric) {
    case 'p50':
      return a.p50;
    case 'p95':
      return a.p95;
    case 'totalEvents':
      return a.totalEvents;
    case 'totalTokens':
      return a.totalTokens;
    case 'egressRate':
      return a.egressRate;
    case 'blockedRate': {
      const total = a.outcomes.ok + a.outcomes.redacted + a.outcomes.blocked;
      if (total === 0) return 0;
      return Math.round(((a.outcomes.blocked + a.outcomes.redacted) / total) * 1000) / 10;
    }
    default:
      return 0;
  }
}

export interface ViewInput {
  name: string;
  range: string;
  model: string;
  outcome: string;
}

export function validateView(raw: unknown): {
  valid: boolean;
  errors: string[];
  value?: ViewInput;
} {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) errors.push('name is required');
  if (name.length > 120) errors.push('name must be 120 characters or fewer');
  const range = typeof r.range === 'string' && r.range.trim() ? r.range.trim() : '7d';
  const model = typeof r.model === 'string' ? r.model.trim() : '';
  const outcome = typeof r.outcome === 'string' ? r.outcome.trim() : '';
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], value: { name, range, model, outcome } };
}
