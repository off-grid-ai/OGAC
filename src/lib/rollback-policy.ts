// PURE auto-rollback target selection — ZERO imports of db/IO, exhaustively unit-testable (mirrors
// pipelines-policy.ts / release-gate.ts). M1 "close the loop", the ACT half: on an eval-gate fail
// after publish OR a drift breach, roll the pipeline's live config back to its LAST-GOOD published
// version. This file owns the pure decision — WHICH prior version to restore; the I/O (read the
// version history, write the restored config + a rollback snapshot + audit) lives in pipelines.ts.
//
// "Last-good published" = the most recent version snapshot that (a) was PUBLISHED and (b) is a good
// target to roll back TO. Honesty bar: we NEVER invent a target. If there is no prior published
// version to fall back to, pickRollbackTarget returns null and the caller reports it can't roll back
// (it does not fabricate or roll to a draft/current-broken version).

// A version snapshot as the selector sees it — only the fields the decision needs. Mirrors the shape
// listPipelineVersions returns (version, note, snapshot.status). PURE input; no DB types leaked in.
export interface RollbackCandidate {
  /** Monotonic version number (higher = newer). */
  version: number;
  /** The append-only note: 'published' | 'edited' | 'created' | 'autorollback' | … */
  note: string;
  /** The frozen governance config at this version (restored verbatim on rollback). */
  snapshot: {
    status?: string;
    [k: string]: unknown;
  };
}

export interface RollbackTarget {
  version: number;
  snapshot: RollbackCandidate['snapshot'];
}

/**
 * Pick the version to roll BACK to, given the current version and the full version history. PURE.
 *
 * The target is the highest-versioned candidate STRICTLY OLDER than `currentVersion` whose snapshot
 * was PUBLISHED — the last-good live config before the current (now-bad) one. We exclude:
 *  - the current version itself (rolling to it is a no-op / it's the bad one),
 *  - any version NEWER than current (can't roll forward),
 *  - non-published snapshots (drafts/edits were never live — never silently promote one),
 *  - prior autorollback snapshots ARE eligible if they were published-status (a chain of rollbacks
 *    still lands on a real last-good config; a rollback snapshot carries the restored published config).
 *
 * Returns null when there is NO prior published version — the caller must then honestly report that
 * the pipeline cannot be rolled back (and leave it as-is), never fabricate a target.
 */
export function pickRollbackTarget(
  currentVersion: number,
  history: RollbackCandidate[],
): RollbackTarget | null {
  const eligible = history
    .filter((v) => v.version < currentVersion)
    .filter((v) => (v.snapshot?.status ?? '') === 'published')
    .sort((a, b) => b.version - a.version);
  const best = eligible[0];
  if (!best) return null;
  return { version: best.version, snapshot: best.snapshot };
}

// ─── Rollback trigger vocabulary — WHY a rollback fired (recorded in the note/audit) ────────────────
export type RollbackReason = 'eval-gate-fail' | 'drift-breach' | 'manual';

/** A human-readable, audit-ready line explaining a rollback. PURE. */
export function rollbackNote(
  reason: RollbackReason,
  fromVersion: number,
  toVersion: number,
  detail?: string,
): string {
  const why =
    reason === 'eval-gate-fail'
      ? 'eval gate failed'
      : reason === 'drift-breach'
        ? 'drift breach detected'
        : 'manual rollback';
  const base = `Auto-rollback (${why}): v${fromVersion} → restored v${toVersion}`;
  return detail ? `${base} — ${detail}` : base;
}
