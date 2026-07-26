// ─── QUALITY REGRESSION — catching declining answers before your users do ─────────────────────────
//
// Drift today watches DATA (Evidently presets over columns). Nothing watched the thing an enterprise
// actually feels: the answers getting worse. Now that every governed run's judge verdict is retained
// (qa/online-scores.ts), degradation is computable from our own data — no extra engine, no sampling
// job, just a rule over what we already keep.
//
// PURE: zero I/O, so every branch of the "is this really a regression?" judgement is unit-testable.
//
// The hard part is NOT the arithmetic — it is not crying wolf. A false alarm trains operators to
// ignore the alarm, which is worse than no alarm at all. So:
//   • UNJUDGED verdicts are excluded (a judge outage is not a quality drop — same rule as the trend).
//   • Both windows must meet a MINIMUM SAMPLE count, else the verdict is 'insufficient-data' — never
//     a regression inferred from one or two runs.
//   • The drop must exceed an absolute threshold, so ordinary judge jitter does not trip it.
//   • The comparison is RECENT vs the BASELINE BEFORE IT — not recent vs all-time, which would keep
//     firing forever once quality shifted to a new (possibly accepted) level.

import type { OnlineScore, QualityTrend } from '@/lib/qa/online-scores';

export interface RegressionOptions {
  /** How many of the newest judged verdicts form the "recent" window. */
  recentSize?: number;
  /** Minimum judged verdicts required in EACH window before any verdict is issued. */
  minSamples?: number;
  /** Absolute drop (0..1) in a dimension's mean that counts as a regression. */
  dropThreshold?: number;
}

export type RegressionStatus = 'ok' | 'regressed' | 'insufficient-data';

export interface RegressionVerdict {
  subjectId: string;
  status: RegressionStatus;
  /** Judged counts actually used, so an operator can see the verdict's weight. */
  recentCount: number;
  baselineCount: number;
  recentQuality: number;
  baselineQuality: number;
  recentFaithfulness: number;
  baselineFaithfulness: number;
  /** Which dimensions regressed (empty unless status === 'regressed'). */
  dimensions: ('quality' | 'faithfulness')[];
  /** Operator-facing sentence — what happened, in plain language. */
  detail: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const mean = (nums: number[]): number =>
  nums.length ? round2(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;

/**
 * Compare the newest judged verdicts against the baseline that preceded them, per subject. PURE.
 *
 * `scores` may arrive in any order; they are sorted newest-first internally so a caller cannot change
 * the verdict by changing its query order.
 */
export function detectQualityRegression(
  scores: readonly OnlineScore[],
  options: RegressionOptions = {},
): RegressionVerdict[] {
  const recentSize = Math.max(1, options.recentSize ?? 10);
  const minSamples = Math.max(1, options.minSamples ?? 5);
  const dropThreshold = options.dropThreshold ?? 0.15;

  const bySubject = new Map<string, OnlineScore[]>();
  for (const s of scores) {
    if (!s.judged) continue; // a judge outage is not a quality drop
    const list = bySubject.get(s.subjectId) ?? [];
    list.push(s);
    bySubject.set(s.subjectId, list);
  }

  const out: RegressionVerdict[] = [];
  for (const [subjectId, list] of bySubject) {
    const sorted = [...list].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)); // newest first
    const recent = sorted.slice(0, recentSize);
    const baseline = sorted.slice(recentSize);

    const base = {
      subjectId,
      recentCount: recent.length,
      baselineCount: baseline.length,
      recentQuality: mean(recent.map((s) => s.quality)),
      baselineQuality: mean(baseline.map((s) => s.quality)),
      recentFaithfulness: mean(recent.map((s) => s.faithfulness)),
      baselineFaithfulness: mean(baseline.map((s) => s.faithfulness)),
    };

    if (recent.length < minSamples || baseline.length < minSamples) {
      out.push({
        ...base,
        status: 'insufficient-data',
        dimensions: [],
        detail: `Not enough judged runs yet to compare (${recent.length} recent, ${baseline.length} earlier; need ${minSamples} of each).`,
      });
      continue;
    }

    const dimensions: ('quality' | 'faithfulness')[] = [];
    if (base.baselineQuality - base.recentQuality >= dropThreshold) dimensions.push('quality');
    if (base.baselineFaithfulness - base.recentFaithfulness >= dropThreshold) {
      dimensions.push('faithfulness');
    }

    if (dimensions.length === 0) {
      out.push({
        ...base,
        status: 'ok',
        dimensions,
        detail: `Holding steady — quality ${base.recentQuality} vs ${base.baselineQuality} earlier.`,
      });
      continue;
    }

    const parts = dimensions.map((d) =>
      d === 'quality'
        ? `quality fell from ${base.baselineQuality} to ${base.recentQuality}`
        : `faithfulness fell from ${base.baselineFaithfulness} to ${base.recentFaithfulness}`,
    );
    out.push({
      ...base,
      status: 'regressed',
      dimensions,
      detail: `Answers are getting worse: ${parts.join(' and ')} over the last ${recent.length} runs.`,
    });
  }

  return out.sort((a, b) => a.subjectId.localeCompare(b.subjectId));
}

/** Just the regressed subjects — what an alert or a dashboard badge actually wants. PURE. */
export function regressedSubjects(verdicts: readonly RegressionVerdict[]): RegressionVerdict[] {
  return verdicts.filter((v) => v.status === 'regressed');
}

// ─── thin read (I/O) ──────────────────────────────────────────────────────────────────────────────

export interface QualityRegressionView {
  retained: number;
  /** false ⇒ nothing has been judged yet. An empty result is "not measured", NOT "all clear". */
  measured: boolean;
  subjects: RegressionVerdict[];
  regressed: RegressionVerdict[];
  /** The standing per-subject averages, from the same read — so callers need only one query. */
  trend: QualityTrend[];
}

/**
 * Read this org's retained verdicts and run the rule over them. Thin: one await plus the pure call.
 *
 * DRY — the API route and the drift page both answer "are our answers getting worse?", so they share
 * THIS composition rather than each pairing listOnlineScores with detectQualityRegression themselves.
 * Two copies of that pairing would drift the moment either side changed a default.
 */
export async function readQualityRegression(
  orgId: string,
  options: RegressionOptions = {},
  limit = 500,
): Promise<QualityRegressionView> {
  const { listOnlineScores, summarizeQuality } = await import('@/lib/qa/online-scores');
  const scores = await listOnlineScores(orgId, limit);
  const subjects = detectQualityRegression(scores, options);
  return {
    retained: scores.length,
    measured: scores.some((s) => s.judged),
    subjects,
    regressed: regressedSubjects(subjects),
    trend: summarizeQuality(scores),
  };
}
