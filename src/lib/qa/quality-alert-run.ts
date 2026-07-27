// Evaluate one subject's answer quality and tell someone if that is news (I/O orchestration only —
// every decision belongs to the pure planQualityAlerts).
//
// Runs opportunistically right after a verdict is retained, which is exactly when the data changed —
// so there is no new scheduler to operate, and no polling loop that is quiet precisely when the fleet
// is busy.

import { readQualityRegression } from '@/lib/qa/quality-regression';
import { planQualityAlerts, type QualityAlert } from '@/lib/qa/quality-alert-plan';
import { listAlertState, saveAlertState } from '@/lib/qa/quality-alert-store';
import {
  type DestinationSource,
  resolveDestination,
  sendQualityAlert,
} from '@/lib/qa/quality-alert-dispatch';
import { getAlertDestination } from '@/lib/qa/quality-alert-destination-store';

export interface AlertSweepResult {
  evaluated: number;
  alerts: QualityAlert[];
  delivered: number;
  configured: boolean;
  /** Which destination was in force — so a caller can tell a console setting from the env fallback. */
  source?: DestinationSource;
}

/** Resolve this org's destination: the console setting first, then the env fallback. */
export async function resolveOrgDestination(orgId: string) {
  const stored = await getAlertDestination(orgId);
  return resolveDestination(stored ? { url: stored.url, enabled: stored.enabled } : null);
}

/**
 * Check this org for newly-regressed (or newly-recovered) subjects and deliver alerts. NEVER throws.
 *
 * `subjectId` narrows the evaluation to the subject whose verdict just landed — the others cannot
 * have changed, so re-alerting on them would be wasted work and a re-delivery risk.
 */
export async function runQualityAlertSweep(
  orgId: string,
  subjectId?: string,
): Promise<AlertSweepResult> {
  const empty: AlertSweepResult = { evaluated: 0, alerts: [], delivered: 0, configured: false };
  try {
    // Skip the whole read when the operator has not opted in (or has paused alerts) — an
    // unconfigured fleet should not pay a regression query per governed run for alerts nobody gets.
    const destination = await resolveOrgDestination(orgId);
    const configured = Boolean(destination.url);
    if (!configured) return { ...empty, source: destination.source };

    const view = await readQualityRegression(orgId);
    const subjects = subjectId
      ? view.subjects.filter((s) => s.subjectId === subjectId)
      : view.subjects;
    if (subjects.length === 0) return { ...empty, configured, source: destination.source };

    const prev = await listAlertState(orgId);
    const { alerts, next } = planQualityAlerts(prev, subjects);
    if (alerts.length === 0)
      return { evaluated: subjects.length, alerts: [], delivered: 0, configured, source: destination.source };

    let delivered = 0;
    for (const alert of alerts) {
      const res = await sendQualityAlert(alert, orgId, destination.url);
      if (res.ok) delivered += 1;
    }

    // Remember only what we actually told someone about. If delivery failed, leaving the memory
    // unchanged means the next verdict retries the alert — better a duplicate than permanent silence
    // on a real regression.
    if (delivered > 0) {
      const deliveredIds = new Set(alerts.map((a) => a.subjectId));
      await saveAlertState(
        orgId,
        next.filter((s) => deliveredIds.has(s.subjectId)),
      );
    }

    return { evaluated: subjects.length, alerts, delivered, configured, source: destination.source };
  } catch {
    return empty; // best-effort: alerting must never disturb the run that triggered it
  }
}
