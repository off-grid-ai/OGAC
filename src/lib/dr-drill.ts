// ─── Disaster-recovery drills: proving a restore actually works ────────────────────────────────────────
//
// The capability map on the secrets vault: "Backup → restore → unseal → verify + audit-device drill proven
// live and recorded (fleet vault-recovery-drill.sh). Next: surface the drill/backup record in the
// /operations/backups UI."
//
// Reading the script settled which half was missing. It proves the whole chain — restore a snapshot into a
// throwaway vault, unseal it, read a canary secret back, enable the file audit device and show the request
// recorded with the secret value HMAC'd rather than plaintext — and then prints all of that to **stdout**
// and exits. Nothing persists. So an auditor asking "when did you last prove you can restore this?" gets a
// terminal scrollback from whoever happened to run it, which is not evidence.
//
// A backup nobody has ever restored is a hope, not a backup. That is the same lesson retention and the
// access review taught earlier: a control that leaves no artefact cannot be shown to have run.
//
// Pure. Zero IO. The reader hands raw JSON here.

export interface DrillRecord {
  /** ISO of when the drill ran. */
  ranAt: string;
  /** Which backup was restored — the drill is only meaningful against a named artefact. */
  backup: string;
  /** Did every stage pass? */
  passed: boolean;
  /** The stages the drill walked, in order, with their outcome. */
  stages: readonly { name: string; ok: boolean; detail?: string }[];
  /** Who or what ran it. */
  ranBy?: string;
}

/** Beyond this, a restore proof is old enough that nobody should rely on it. */
export const DRILL_STALE_DAYS = 90;

export type DrillState = 'never' | 'fresh' | 'stale' | 'failed';

export interface DrillStatus {
  state: DrillState;
  /** One sentence for the surface. Never implies a proof that does not exist. */
  sentence: string;
  /** Whole days since the drill, or null when there has never been one. */
  ageDays: number | null;
  /** The stages that failed, when it failed. */
  failedStages: string[];
}

/** Whole days between two instants, floored, never negative. */
function daysBetween(thenIso: string, now: Date): number | null {
  const t = Date.parse(thenIso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/**
 * What to tell an operator about the last restore proof.
 *
 * `null` is reported as **never drilled**, explicitly — not as an absence the reader can mistake for
 * health. "We have backups" and "we have proven we can restore one" are different claims, and only the
 * second is worth anything during an incident.
 *
 * A drill whose record is unparseable is treated as NO drill rather than a passing one: an artefact we
 * cannot read is not an artefact we can rely on.
 */
export function drillStatus(record: DrillRecord | null, now: Date): DrillStatus {
  if (!record || !record.ranAt) {
    return {
      state: 'never',
      ageDays: null,
      failedStages: [],
      sentence:
        'No restore has ever been rehearsed. Backups exist, but nothing has proven one can actually be restored — which is the only thing that matters during an incident.',
    };
  }

  const ageDays = daysBetween(record.ranAt, now);
  const failedStages = (record.stages ?? []).filter((s) => !s.ok).map((s) => s.name);

  if (!record.passed || failedStages.length > 0) {
    return {
      state: 'failed',
      ageDays,
      failedStages,
      sentence: `The last restore rehearsal FAILED${ageDays === null ? '' : ` ${ageDays === 0 ? 'today' : `${ageDays} days ago`}`}${
        failedStages.length ? ` at: ${failedStages.join(', ')}` : ''
      }. Until it passes, assume this backup cannot be restored.`,
    };
  }

  if (ageDays !== null && ageDays > DRILL_STALE_DAYS) {
    return {
      state: 'stale',
      ageDays,
      failedStages: [],
      sentence: `The last restore rehearsal passed, but ${ageDays} days ago — beyond the ${DRILL_STALE_DAYS}-day mark. The system has changed since; rehearse again before relying on it.`,
    };
  }

  return {
    state: 'fresh',
    ageDays,
    failedStages: [],
    sentence: `A full restore was rehearsed ${ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`} and passed every stage${
      record.backup ? ` (from ${record.backup})` : ''
    } — so this backup is known to be restorable, not merely present.`,
  };
}

/**
 * Parse a drill record written by the fleet script.
 *
 * Returns null on anything malformed rather than throwing or half-trusting it. A record we cannot fully
 * read must not become a passing proof — see drillStatus.
 */
export function parseDrillRecord(raw: unknown): DrillRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const ranAt = typeof o.ranAt === 'string' ? o.ranAt.trim() : '';
  if (!ranAt || !Number.isFinite(Date.parse(ranAt))) return null;
  const stagesRaw = Array.isArray(o.stages) ? o.stages : [];
  const stages = stagesRaw
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s) => ({
      name: typeof s.name === 'string' ? s.name : 'unnamed stage',
      ok: s.ok === true,
      detail: typeof s.detail === 'string' ? s.detail : undefined,
    }));
  return {
    ranAt,
    backup: typeof o.backup === 'string' ? o.backup : '',
    // Explicitly true only. A record missing `passed` is not a pass.
    passed: o.passed === true,
    stages,
    ranBy: typeof o.ranBy === 'string' ? o.ranBy : undefined,
  };
}
