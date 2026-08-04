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

export interface RegressionHeadline {
  tone: RegressionStatus;
  label: string;
}

/**
 * The one-line summary above the per-subject table. PURE.
 *
 * The distinction this exists to protect: "nothing is declining" and "nothing could be judged yet"
 * must not render as the same green badge. A summary that says "no decline detected" while every
 * subject underneath reads 'insufficient-data' is a false all-clear — precisely the lie the rule
 * avoids at the data layer, and it would sneak back in at the badge if this were computed inline.
 */
export function regressionHeadline(
  subjects: readonly RegressionVerdict[],
): RegressionHeadline {
  const regressed = subjects.filter((v) => v.status === 'regressed').length;
  if (regressed > 0) {
    return { tone: 'regressed', label: `${regressed} getting worse` };
  }
  // Only claim "no decline" when at least one subject was actually comparable.
  if (subjects.some((v) => v.status === 'ok')) {
    return { tone: 'ok', label: 'no decline detected' };
  }
  return { tone: 'insufficient-data', label: 'not enough data yet' };
}

// ─── thin read (I/O) ──────────────────────────────────────────────────────────────────────────────

/**
 * Turn a scoring subject id into the name its owner uses for it.
 *
 * The drift surface printed the raw `subjectId` — an operator was shown `app:bhapp_reimb` where the
 * app is called "Reimbursement Approval". An internal id in a column headed "App or agent" is not an
 * answer to that column.
 *
 * Falls back to the id when the entity is not in the map, deliberately: a scored subject that has since
 * been deleted must still appear as a row (its scores are real history), and inventing a friendly name
 * for something we cannot resolve would be worse than showing the key we actually have.
 *
 * Pure.
 */
export function subjectDisplayName(
  subjectId: string,
  names: Readonly<Record<string, string>>,
): { name: string; kind: 'App' | 'Agent' | null; unresolved: boolean } {
  const direct = names[subjectId];
  const [prefix] = subjectId.split(':', 1);
  const kind = prefix === 'app' ? 'App' : prefix === 'agent' ? 'Agent' : null;
  if (direct?.trim()) return { name: direct.trim(), kind, unresolved: false };
  return { name: subjectId, kind, unresolved: true };
}

export interface QualityRegressionView {
  retained: number;
  /** false ⇒ nothing has been judged yet. An empty result is "not measured", NOT "all clear". */
  measured: boolean;
  subjects: RegressionVerdict[];
  regressed: RegressionVerdict[];
  /** The standing per-subject averages, from the same read — so callers need only one query. */
  trend: QualityTrend[];
  /**
   * subjectId → the name its owner uses. Resolved in the same read so every surface showing these
   * verdicts names the app the same way, instead of each one re-deriving it (or, as before, not at all).
   */
  names: Record<string, string>;
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
    names: await resolveSubjectNames(
      subjects.map((s) => s.subjectId),
      orgId,
    ),
  };
}

/**
 * Look up the titles behind a set of scoring subject ids.
 *
 * Best-effort by design: a failed or partial lookup leaves the id in place (see subjectDisplayName)
 * rather than dropping the row, because the verdict is real evidence even when its subject has since
 * been renamed or deleted.
 */
async function resolveSubjectNames(
  subjectIds: readonly string[],
  orgId: string,
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  const appIds = subjectIds.filter((id) => id.startsWith('app:')).map((id) => id.slice(4));
  if (appIds.length > 0) {
    try {
      const { listApps } = await import('@/lib/apps-store');
      for (const a of await listApps(orgId)) {
        if (a.title?.trim()) names[`app:${a.id}`] = a.title.trim();
      }
    } catch {
      // Leave the ids; the surface degrades to keys, never to a blank column.
    }
  }
  const agentIds = subjectIds.filter((id) => id.startsWith('agent:'));
  if (agentIds.length > 0) {
    try {
      // listManagedAgents, not the runnable catalog: a DISABLED agent's past scores are still real
      // history and its row must still carry its name.
      const { listManagedAgents } = await import('@/lib/agents');
      for (const a of await listManagedAgents(orgId)) {
        if (a.name?.trim()) names[`agent:${a.id}`] = a.name.trim();
      }
    } catch {
      // Same: honest keys beat a fabricated name.
    }
  }
  return names;
}
