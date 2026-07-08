// ─── M4 data governance — the PURE retention evaluator (zero-I/O, unit-testable) ───────────────
//
// Retention answers "how long may we keep this, and when is it due for disposal". Each asset can
// carry a retention policy: keep for N days from its last refresh, then delete / anonymize / archive.
// A legal hold overrides everything (never auto-purge while held). This module decides, purely, the
// retention STATE of an asset given its policy + its last-refresh time + `now`. No DB, no clock in
// the logic — the caller injects `now` so the rule is deterministic and testable.

export const RETENTION_ACTIONS = ['delete', 'anonymize', 'archive'] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];

export function normalizeRetentionAction(a: string | null | undefined): RetentionAction {
  const v = (a ?? '').trim().toLowerCase();
  return (RETENTION_ACTIONS as readonly string[]).includes(v) ? (v as RetentionAction) : 'delete';
}

// The policy facts the evaluator needs. `retainDays` 0/absent = keep indefinitely.
export interface RetentionInput {
  retainDays?: number | null;
  action?: string | null;
  legalHold?: boolean | null;
  /** The clock the retention window runs from — the asset's last refresh (or created) time. */
  anchorAt?: Date | string | null;
}

export type RetentionState = 'held' | 'due' | 'active' | 'indefinite' | 'unknown';

export interface RetentionResult {
  state: RetentionState;
  action: RetentionAction;
  retainDays: number | null;
  /** Days remaining before disposal (negative once overdue), or null when indefinite/unknown. */
  daysRemaining: number | null;
  /** True when this asset is past its retention window and should be disposed of. */
  dueForDisposal: boolean;
  reason: string;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Evaluate one asset's retention. PURE — `now` injected. Precedence: legal hold first (never purge),
// then indefinite (no window), then window math.
export function evaluateRetention(input: RetentionInput, now: Date = new Date()): RetentionResult {
  const action = normalizeRetentionAction(input.action);
  const retainDays = typeof input.retainDays === 'number' && input.retainDays > 0
    ? Math.floor(input.retainDays)
    : null;

  if (input.legalHold) {
    return {
      state: 'held', action, retainDays, daysRemaining: null, dueForDisposal: false,
      reason: 'Legal hold — retained indefinitely, never auto-purged.',
    };
  }

  if (retainDays == null) {
    return {
      state: 'indefinite', action, retainDays: null, daysRemaining: null, dueForDisposal: false,
      reason: 'No retention window — kept indefinitely.',
    };
  }

  const anchor = toDate(input.anchorAt);
  if (anchor == null) {
    return {
      state: 'unknown', action, retainDays, daysRemaining: null, dueForDisposal: false,
      reason: 'No refresh/created date to run the retention window from.',
    };
  }

  const ageDays = Math.floor((now.getTime() - anchor.getTime()) / 86_400_000);
  const daysRemaining = retainDays - ageDays;
  if (daysRemaining <= 0) {
    return {
      state: 'due', action, retainDays, daysRemaining, dueForDisposal: true,
      reason: `Past the ${retainDays}-day window by ${Math.abs(daysRemaining)}d — due to ${action}.`,
    };
  }

  return {
    state: 'active', action, retainDays, daysRemaining, dueForDisposal: false,
    reason: `${daysRemaining}d remaining of the ${retainDays}-day window.`,
  };
}
