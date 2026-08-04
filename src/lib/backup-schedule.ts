// ─── Is the nightly backup actually scheduled? ─────────────────────────────────────────────────────────
//
// LIVE FINDING (2026-08-04). The Backups & DR page said:
//
//   "not scheduled — launchd job co.getoffgridai.backup is NOT loaded. Install
//    /Library/LaunchDaemons/co.getoffgridai.backup.plist to schedule the nightly backup"
//
// while the same page listed backups from 20260804, 20260803, 20260802, 20260801 … one every night. The
// job is loaded. It is a SYSTEM-domain LaunchDaemon, and `launchctl list <label>` run by an unprivileged
// process cannot see the system domain, so it exits non-zero — which the reader turned into "NOT loaded".
//
// The console must not gain sudo to fix this; a reporting surface acquiring root to read a status is a
// worse outcome than an inaccurate status. So the rule below does what the rest of this codebase does with
// an unreadable source: it refuses to convert "I cannot see it" into "it is not there", and it corroborates
// with evidence it DOES have — the artefacts. If a backup has landed every night, something is scheduling
// them, whatever this process can or cannot query.
//
// Pure. Zero IO.

/** What the unprivileged `launchctl list <label>` probe could establish. */
export type LaunchdProbe =
  | 'loaded' // the command succeeded — definitely scheduled
  | 'not-visible' // non-zero exit: either not loaded, OR loaded in a domain we cannot query
  | 'unavailable'; // launchctl absent entirely (not macOS / a dev box)

export interface BackupEvidence {
  /** Hours since the newest backup, or null when there are none at all. */
  newestAgeHours: number | null;
  /** How many of the last 7 days have at least one backup. */
  daysCoveredOfSeven: number;
}

export type ScheduleConfidence = 'confirmed' | 'evidenced' | 'absent' | 'unknown';

export interface ScheduleVerdict {
  confidence: ScheduleConfidence;
  /** True when an operator can rely on the nightly backup happening. */
  scheduled: boolean;
  /** What to show. Never claims to have read a status it could not read. */
  detail: string;
}

/** A nightly job should have produced something within this many hours. */
const NIGHTLY_GRACE_HOURS = 36;
/** Days-of-seven at or above which the cadence is convincing on its own. */
const CONVINCING_DAYS = 5;

/**
 * Decide whether the nightly backup is scheduled, from the probe AND the artefacts.
 *
 * The interesting case is `not-visible`. Alone it means nothing — an unprivileged process cannot query a
 * system-domain daemon — so the artefacts decide:
 *   · backups landing nightly ⇒ `evidenced`: say the outcome is happening and say plainly that the job
 *     status itself could not be read from here. That is two facts, and both are true.
 *   · nothing landing ⇒ `absent`: now the probe and the evidence agree, and the warning is real.
 */
export function scheduleVerdict(probe: LaunchdProbe, evidence: BackupEvidence, label: string): ScheduleVerdict {
  if (probe === 'loaded') {
    return {
      confidence: 'confirmed',
      scheduled: true,
      detail: `The nightly backup job (${label}) is loaded and runs at 02:00.`,
    };
  }

  const fresh = evidence.newestAgeHours !== null && evidence.newestAgeHours <= NIGHTLY_GRACE_HOURS;
  const cadence = evidence.daysCoveredOfSeven >= CONVINCING_DAYS;

  if (probe === 'unavailable') {
    return {
      confidence: fresh && cadence ? 'evidenced' : 'unknown',
      scheduled: fresh && cadence,
      detail:
        fresh && cadence
          ? `Backups have landed on ${evidence.daysCoveredOfSeven} of the last 7 days, so the nightly job is running. Its scheduler status cannot be read in this environment.`
          : 'The scheduler cannot be read in this environment, so whether the nightly backup is scheduled is unknown here.',
    };
  }

  // not-visible
  if (fresh && cadence) {
    return {
      confidence: 'evidenced',
      scheduled: true,
      // Both facts, neither dressed up as the other.
      detail: `Backups have landed on ${evidence.daysCoveredOfSeven} of the last 7 days — the newest ${Math.round(evidence.newestAgeHours ?? 0)}h ago — so the nightly job is running. Its status could not be read from here: ${label} is a system-domain daemon and this process is unprivileged, which is deliberate.`,
    };
  }
  if (evidence.newestAgeHours === null) {
    return {
      confidence: 'absent',
      scheduled: false,
      detail: `No backups exist and the nightly job (${label}) could not be found. Install /Library/LaunchDaemons/${label}.plist and run one now.`,
    };
  }
  return {
    confidence: 'absent',
    scheduled: false,
    detail: `The newest backup is ${Math.round(evidence.newestAgeHours)}h old and only ${evidence.daysCoveredOfSeven} of the last 7 days are covered — the nightly job (${label}) is not running reliably.`,
  };
}

/**
 * Summarise the backup artefacts into the evidence the verdict needs.
 *
 * `days` are UTC calendar days so a run near midnight cannot be counted twice.
 */
export function backupEvidence(
  timestamps: readonly (number | null | undefined)[],
  now: number,
): BackupEvidence {
  const valid = timestamps.filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  if (valid.length === 0) return { newestAgeHours: null, daysCoveredOfSeven: 0 };
  const newest = Math.max(...valid);
  const cutoff = now - 7 * 86_400_000;
  const days = new Set(
    valid.filter((t) => t >= cutoff).map((t) => new Date(t).toISOString().slice(0, 10)),
  );
  return {
    // Never negative: a clock skew must not read as a backup from the future.
    newestAgeHours: Math.max(0, (now - newest) / 3_600_000),
    daysCoveredOfSeven: days.size,
  };
}
