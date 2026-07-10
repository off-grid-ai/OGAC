// PURE pipeline LIFECYCLE rules — ZERO imports of db/IO, exhaustively unit-testable (mirrors
// pipelines-policy.ts / release-gate.ts / tenancy-policy.ts). M2 "lifecycle & ownership above the
// pipeline": widen the pipeline status from {draft, published, archived} to the full promotion
// lifecycle and own — with no network and no DB — the rule that decides WHICH transition a given
// actor may make from a given status.
//
// The promotion lifecycle (spec § M2):
//
//     draft ──promote──▶ in_review ──approve──▶ published ──deprecate──▶ deprecated
//       ▲                    │                      │                        │
//       └──────withdraw──────┘                      └─────deprecate──────────┘
//                                                                            │
//                                                            revive (back to draft)
//
// The RBAC rule that gives M2 its teeth:
//   • an OWNER (or a team editor, or an admin) may submit a draft for review (draft → in_review);
//   • ONLY an APPROVER or ADMIN may approve a review into published (in_review → published) — and
//     that approval is what fires M1's `publishWithGate` (publish iff the evals pass);
//   • anyone WITH ACCESS to the pipeline may deprecate it (published/in_review → deprecated) and
//     revive a deprecated/archived one back to draft to re-work it;
//   • `archived` (the legacy pre-M2 retired state) is kept working: it maps into the lifecycle as a
//     terminal retired state, revivable to draft, so existing archived pipelines don't break.
//
// The pure decision is `allowedTransitions(status, role)`; the I/O (persist the new status, run the
// gate on approve, audit) lives in pipeline-lifecycle.ts.

// ─── the full lifecycle status vocabulary ────────────────────────────────────────────────────────
// draft → in_review → published → deprecated, plus the legacy `archived` retired state (pre-M2 rows).
export type LifecycleStatus = 'draft' | 'in_review' | 'published' | 'deprecated' | 'archived';

export const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  'draft',
  'in_review',
  'published',
  'deprecated',
  'archived',
];

export function isLifecycleStatus(v: unknown): v is LifecycleStatus {
  return typeof v === 'string' && (LIFECYCLE_STATUSES as readonly string[]).includes(v);
}

// ─── the role a lifecycle decision is made under ───────────────────────────────────────────────────
// The pure model takes an already-RESOLVED role for THIS actor on THIS pipeline (the impure layer
// resolves it from admin ∪ ownership ∪ team membership). Ordered least → most authority:
//   • 'none'     — no access (sees nothing actionable);
//   • 'member'   — a team member with delegated READ (may deprecate its team's pipeline, not promote);
//   • 'editor'   — the owner OR a team editor (may edit + promote a draft for review + deprecate);
//   • 'approver' — may approve a review into published (the sign-off gate) + everything an editor can;
//   • 'admin'    — org admin: everything, across all teams.
export type LifecycleRole = 'none' | 'member' | 'editor' | 'approver' | 'admin';

export const LIFECYCLE_ROLES: readonly LifecycleRole[] = [
  'none',
  'member',
  'editor',
  'approver',
  'admin',
];

// Authority rank — higher subsumes the powers of lower. PURE.
function roleRank(role: LifecycleRole): number {
  return LIFECYCLE_ROLES.indexOf(role);
}

/** True when `role` is at least `min` on the authority ladder. PURE. */
export function roleAtLeast(role: LifecycleRole, min: LifecycleRole): boolean {
  return roleRank(role) >= roleRank(min);
}

// ─── the lifecycle actions ─────────────────────────────────────────────────────────────────────────
export type LifecycleAction = 'promote' | 'withdraw' | 'approve' | 'reject' | 'deprecate' | 'revive';

export interface LifecycleTransition {
  action: LifecycleAction;
  /** The status the pipeline lands in when this action fires. */
  to: LifecycleStatus;
  /** Button label. */
  label: string;
  /** One-line intent copy for the button/confirm/toast. */
  hint: string;
  /** True iff this action runs THROUGH M1's release gate (only `approve` does). */
  gated: boolean;
}

// The minimum role each action requires, defined ONCE so the matrix and the guard agree.
const ACTION_MIN_ROLE: Record<LifecycleAction, LifecycleRole> = {
  promote: 'editor', // owner / team-editor / admin may submit a draft for review
  withdraw: 'editor', // pull a review back to draft to keep editing
  approve: 'approver', // ONLY an approver/admin may sign off → published (fires the gate)
  reject: 'approver', // an approver sends a review back to draft
  deprecate: 'member', // anyone with access may retire their own pipeline
  revive: 'editor', // bring a retired/deprecated pipeline back to draft to re-work
};

// The candidate transitions legal from each status, BEFORE the role filter. The role gate is applied
// by allowedTransitions so the matrix is defined in one place.
const STATUS_TRANSITIONS: Record<LifecycleStatus, LifecycleTransition[]> = {
  draft: [
    {
      action: 'promote',
      to: 'in_review',
      label: 'Submit for review',
      hint: 'Send this draft to an approver — it can only publish after sign-off and a passing eval gate',
      gated: false,
    },
    {
      action: 'deprecate',
      to: 'deprecated',
      label: 'Deprecate',
      hint: 'Retire this pipeline — consumers fall back to the org default',
      gated: false,
    },
  ],
  in_review: [
    {
      action: 'approve',
      to: 'published',
      label: 'Approve & publish',
      hint: 'Sign off and publish — publish only proceeds if the release gate (evals) passes',
      gated: true,
    },
    {
      action: 'reject',
      to: 'draft',
      label: 'Send back',
      hint: 'Reject the review — return the pipeline to draft for rework',
      gated: false,
    },
    {
      action: 'withdraw',
      to: 'draft',
      label: 'Withdraw',
      hint: 'Pull this review back to draft to keep editing',
      gated: false,
    },
  ],
  published: [
    {
      action: 'deprecate',
      to: 'deprecated',
      label: 'Deprecate',
      hint: 'Retire this published pipeline — consumers fall back to the org default',
      gated: false,
    },
  ],
  deprecated: [
    {
      action: 'revive',
      to: 'draft',
      label: 'Revive',
      hint: 'Bring this pipeline back as a draft to re-work and re-promote',
      gated: false,
    },
  ],
  // Legacy pre-M2 retired state — kept working: revivable to draft like a deprecated one.
  archived: [
    {
      action: 'revive',
      to: 'draft',
      label: 'Restore',
      hint: 'Bring this archived pipeline back as a draft to edit and re-promote',
      gated: false,
    },
  ],
};

/**
 * The lifecycle transitions THIS actor (at `role`) may make from `status`. PURE — no I/O. The impure
 * layer resolves `role` from admin ∪ ownership ∪ team membership, then this decides the legal moves.
 *
 * Rules:
 *  - The candidate transitions come from the status graph (STATUS_TRANSITIONS).
 *  - Each is kept iff the actor's role is at least the action's minimum (ACTION_MIN_ROLE).
 *  - An unknown status (data from before the enum widened, or corruption) ⇒ [] (no illegal moves).
 *  - role 'none' ⇒ [] (no access — nothing actionable).
 */
export function allowedTransitions(status: string, role: LifecycleRole): LifecycleTransition[] {
  if (role === 'none') return [];
  if (!isLifecycleStatus(status)) return [];
  return STATUS_TRANSITIONS[status].filter((t) => roleAtLeast(role, ACTION_MIN_ROLE[t.action]));
}

/** Is a given action legal from `status` for `role`? PURE — the guard the I/O layer calls before acting. */
export function canTransition(status: string, role: LifecycleRole, action: LifecycleAction): boolean {
  return allowedTransitions(status, role).some((t) => t.action === action);
}

/** The status an action lands in, from a given status — null if the action is not legal from it. PURE. */
export function transitionTarget(status: string, action: LifecycleAction): LifecycleStatus | null {
  if (!isLifecycleStatus(status)) return null;
  const t = STATUS_TRANSITIONS[status].find((x) => x.action === action);
  return t ? t.to : null;
}

// ─── stage presentation (PURE) — the current stage as a labeled, ordered step ──────────────────────
// The Overview/Lifecycle control shows the current stage on the promotion track. The main track is
// draft → in_review → published; deprecated/archived are off-track terminal states.
export interface StageInfo {
  status: LifecycleStatus;
  label: string;
  /** 0-based index on the main promotion track, or -1 for the off-track terminal states. */
  trackIndex: number;
  /** A one-line description of what this stage means for an operator. */
  description: string;
}

export const PROMOTION_TRACK: readonly LifecycleStatus[] = ['draft', 'in_review', 'published'];

const STAGE_META: Record<LifecycleStatus, { label: string; description: string }> = {
  draft: { label: 'Draft', description: 'Being built — editable, not consumable. Submit for review when ready.' },
  in_review: {
    label: 'In review',
    description: 'Awaiting an approver. Publishing needs sign-off AND a passing eval gate.',
  },
  published: { label: 'Published', description: 'Live and consumable. Approved and gate-passed.' },
  deprecated: { label: 'Deprecated', description: 'Retired. Revive to draft to re-work.' },
  archived: { label: 'Archived', description: 'Retired (legacy). Restore to draft to re-work.' },
};

/** Describe a status as a stage on the promotion track. PURE — falls back to draft for unknowns. */
export function stageInfo(status: string): StageInfo {
  const s = isLifecycleStatus(status) ? status : 'draft';
  const meta = STAGE_META[s];
  return {
    status: s,
    label: meta.label,
    trackIndex: PROMOTION_TRACK.indexOf(s),
    description: meta.description,
  };
}

// ─── legacy status mapping (PURE) — keep pre-M2 rows working ────────────────────────────────────────
// Pre-M2 the enum was {draft, published, archived}. Those values are all still valid LifecycleStatus
// members, so no data migration is forced: `archived` stays archived (revivable), draft/published are
// unchanged. This helper normalises ANY stored/inbound status into the lifecycle vocabulary so a
// corrupt/legacy value degrades to `draft` rather than breaking the transition graph.
export function normalizeLifecycleStatus(v: unknown): LifecycleStatus {
  return isLifecycleStatus(v) ? v : 'draft';
}

// ─── consumability gate (PURE) — the SINGLE authority for "may this pipeline govern a run?" ─────────
// A pipeline is enforceable on a CONSUMER (chat / agent / app / trigger / the public provisioned API)
// ONLY when it is `published` — approved and gate-passed. Every other lifecycle state must NOT govern:
//   • draft / in_review — never approved, never eval-gate-passed → running it bypasses the release gate
//     (G-ADV-PIPE-3). A consumer bound to it falls back to the org default instead.
//   • deprecated / archived — retired; the lifecycle promise on deprecate is "consumers fall back to the
//     org default" (G-ADV-PIPE-2). A stale contract must not keep enforcing.
// This mirrors the public run route's `status !== 'published'` 409 — ONE rule, so every internal
// consumer resolver (resolveContract) and the public route agree. An unknown/legacy status normalises
// to 'draft' (not consumable) — fail-safe: an un-recognisable status never silently governs a run.
export function isConsumable(status: unknown): boolean {
  return normalizeLifecycleStatus(status) === 'published';
}
