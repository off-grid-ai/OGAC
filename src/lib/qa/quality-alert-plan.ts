// ─── QUALITY ALERT PLANNING — telling someone, without becoming noise ─────────────────────────────
//
// Detection already works: the drift surface shows when an app's answers are sliding. But it is
// PULL-only, so an operator learns about it by happening to look. This decides when to actually tell
// someone (G-QUALITY-REGRESSION-ALERT).
//
// PURE: zero I/O. The whole judgement about whether this is news is unit-testable.
//
// The hard part is the same as the detector's, one level up. A rule that fires on every evaluation
// while quality stays bad trains people to filter the alert, and then the one that mattered is
// filtered too. So alerts are TRANSITIONS, not states:
//
//   • Fire once when a subject ENTERS a regression. Stay silent while it remains regressed.
//   • Fire a recovery when it climbs back out — an operator who got the bad news is owed the good.
//   • 'insufficient-data' NEVER changes anything. This is the rule that matters most: a subject going
//     quiet (the judge is down, traffic stopped, the window emptied) must not read as recovery. The
//     alternative is an all-clear nobody earned, followed by a fresh "regressed" alert the moment
//     data returns — flapping, which is how alerting dies.

import type { RegressionVerdict } from '@/lib/qa/quality-regression';

/** What we remember between evaluations: whether we have already told someone about this subject. */
export interface QualityAlertState {
  subjectId: string;
  status: 'regressed' | 'clear';
  /** When the subject entered this status — carried so an alert can say how long it has been true. */
  since: string;
}

export type QualityAlertKind = 'regressed' | 'recovered';

export interface QualityAlert {
  kind: QualityAlertKind;
  subjectId: string;
  /** Operator-facing sentence — the whole point is that this is readable in a Slack message. */
  detail: string;
  recentQuality: number;
  baselineQuality: number;
  dimensions: ('quality' | 'faithfulness')[];
  at: string;
}

export interface QualityAlertPlan {
  alerts: QualityAlert[];
  /** The state to persist. Includes untouched subjects, so callers can write it back wholesale. */
  next: QualityAlertState[];
}

/**
 * Decide which alerts to emit and what to remember. PURE.
 *
 * `prev` may omit a subject entirely (never seen). A first-ever verdict of 'regressed' IS news, so an
 * absent state behaves like 'clear' — but a first-ever 'ok' is not news, and emits nothing.
 */
export function planQualityAlerts(
  prev: readonly QualityAlertState[],
  verdicts: readonly RegressionVerdict[],
  now: string = new Date().toISOString(),
): QualityAlertPlan {
  const prior = new Map(prev.map((s) => [s.subjectId, s]));
  const alerts: QualityAlert[] = [];
  const next = new Map(prior);

  for (const v of verdicts) {
    // Going quiet is not recovery, and it is not a new problem either. Leave the memory untouched.
    if (v.status === 'insufficient-data') continue;

    const was = prior.get(v.subjectId)?.status ?? 'clear';

    if (v.status === 'regressed' && was !== 'regressed') {
      alerts.push({
        kind: 'regressed',
        subjectId: v.subjectId,
        detail: v.detail,
        recentQuality: v.recentQuality,
        baselineQuality: v.baselineQuality,
        dimensions: v.dimensions,
        at: now,
      });
      next.set(v.subjectId, { subjectId: v.subjectId, status: 'regressed', since: now });
      continue;
    }

    if (v.status === 'ok' && was === 'regressed') {
      alerts.push({
        kind: 'recovered',
        subjectId: v.subjectId,
        detail: `Answer quality recovered — now ${v.recentQuality} against a ${v.baselineQuality} baseline.`,
        recentQuality: v.recentQuality,
        baselineQuality: v.baselineQuality,
        dimensions: [],
        at: now,
      });
      next.set(v.subjectId, { subjectId: v.subjectId, status: 'clear', since: now });
      continue;
    }

    // Steady state (still regressed, or still fine). Remember it, say nothing.
    if (!prior.has(v.subjectId)) {
      next.set(v.subjectId, { subjectId: v.subjectId, status: v.status === 'regressed' ? 'regressed' : 'clear', since: now });
    }
  }

  return { alerts, next: [...next.values()].sort((a, b) => a.subjectId.localeCompare(b.subjectId)) };
}

/** The subject line an operator sees first. PURE. */
export function alertSubjectLine(alert: QualityAlert): string {
  return alert.kind === 'regressed'
    ? `Answer quality is slipping: ${alert.subjectId}`
    : `Answer quality recovered: ${alert.subjectId}`;
}
