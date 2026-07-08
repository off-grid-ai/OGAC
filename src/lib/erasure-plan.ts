// DSAR / right-to-erasure — the PURE PROPAGATION planner (zero-I/O, unit-testable).
//
// The console-owned Postgres tables are erased by the existing DSAR planner + executor
// (src/lib/erasure.ts). But a subject's data also lives OUTSIDE Postgres:
//
//   1. the VECTOR index (Qdrant) — subject-scoped embeddings/chunks,
//   2. the external DATA LAKE (SeaweedFS/S3) — subject-scoped objects,
//   3. DEVICE replicas (mobile/desktop) — long-term on-device memory.
//
// Historically all three were reported as `deferred` (honest, but unpropagated). This module makes
// the propagation REAL and pluggable: given the subject plus WHICH external targets are configured
// (env-derived, passed in — this file reads no env, does no I/O), it produces the ordered PROPAGATION
// PLAN. Each target that is configured becomes a plan step carrying the exact filter/key an adapter
// will use; each target that is NOT configured is classified as `not-configured` with a reason, so
// the orchestrator can report it honestly as `deferred` — NEVER as a fake success.
//
// SOLID: this is the RULE (which targets, in what order, keyed how). The thin I/O adapters
// (erasure-vector.ts / erasure-lake.ts / erasure-device.ts) do the deletes; they do NOT import this.
// DRY: the subject-key derivation for every propagation target lives here, once.

/** The external planes a subject-erasure must propagate to, beyond console Postgres. */
export type PropagationTarget = 'vector' | 'lake' | 'device';

/** Whether an adapter for a target is reachable/configured in this environment. */
export interface PropagationConfig {
  /** Vector index (Qdrant) configured — an OFFGRID_QDRANT_URL is always defaulted, so this is
   *  driven by whether the adapter is enabled (health/URL present). */
  vector: boolean;
  /** External data lake (SeaweedFS/S3) configured — a bucket endpoint is reachable. */
  lake: boolean;
  /** A device-sync channel exists to push tombstones to. When false, the plan still records the
   *  request durably (a real tombstone row) rather than silently skipping. */
  device: boolean;
}

/** One planned propagation step for a CONFIGURED target. */
export interface PropagationStep {
  target: PropagationTarget;
  /** Human label the operator sees. */
  label: string;
  /** The subject-derived key/filter value the adapter matches on (owner/subject id). */
  subjectKey: string;
}

/** A target that could NOT be actioned — reported honestly, never counted as erased. */
export interface NotConfigured {
  target: PropagationTarget;
  label: string;
  reason: string;
}

export interface PropagationPlan {
  subject: string;
  /** Configured targets, in execution order (vector → lake → device). */
  steps: PropagationStep[];
  /** Unconfigured/unreachable targets, each with a reason. */
  notConfigured: NotConfigured[];
}

// One label per target — the single source of truth for the operator-facing store name.
export const TARGET_LABELS: Readonly<Record<PropagationTarget, string>> = {
  vector: 'Vector index (Qdrant) — subject-scoped chunks',
  lake: 'External data lake (SeaweedFS/S3) — subject-scoped objects',
  device: 'Device replicas (mobile/desktop) — long-term on-device memory',
} as const;

// Deterministic execution order: purge the derived index first, then source objects, then push the
// tombstone to devices. Kept as a const so plan order is stable and testable.
const ORDER: readonly PropagationTarget[] = ['vector', 'lake', 'device'] as const;

/**
 * Derive the key an adapter matches a subject on. ONE place — every adapter and the plan agree.
 * Subjects are emails/ids; we trim and lower-case so matching is case-insensitive and whitespace
 * never leaks into a filter. Returns '' for a blank subject (the planner then yields no steps).
 */
export function subjectKey(subject: string): string {
  return (subject ?? '').trim().toLowerCase();
}

// The reason string for an unconfigured target — DRY, so the orchestrator/tests read one phrasing.
function reasonFor(target: PropagationTarget): string {
  switch (target) {
    case 'vector':
      return 'Vector index adapter not configured/reachable — deferred, not erased.';
    case 'lake':
      return 'External data lake (S3/SeaweedFS) not configured/reachable — deferred, not erased.';
    case 'device':
      return 'No device-sync channel configured — tombstone recorded, propagation deferred.';
  }
}

/**
 * Build the propagation plan for a subject. PURE — never throws, never touches env or I/O.
 * A configured target → a step (with its subject-derived key); an unconfigured one → notConfigured
 * with a reason. A blank subject yields empty steps but still lists every target as notConfigured so
 * the report is complete.
 */
export function planPropagation(subject: string, config: PropagationConfig): PropagationPlan {
  const key = subjectKey(subject);
  const steps: PropagationStep[] = [];
  const notConfigured: NotConfigured[] = [];

  for (const target of ORDER) {
    const configured = config[target] === true;
    const label = TARGET_LABELS[target];
    // A blank subject can never be actioned — surface every target as deferred with a reason.
    if (!key || !configured) {
      notConfigured.push({
        target,
        label,
        reason: !key
          ? 'Blank subject — nothing to propagate.'
          : reasonFor(target),
      });
      continue;
    }
    steps.push({ target, label, subjectKey: key });
  }

  return { subject: key, steps, notConfigured };
}

// ── Result shaping (pure) ───────────────────────────────────────────────────────
/** The outcome classification for one propagation target. */
export type PropagationOutcome = 'erased' | 'deferred' | 'error';

export interface PropagationResult {
  target: PropagationTarget;
  label: string;
  outcome: PropagationOutcome;
  /** Rows/objects actually removed (only meaningful for 'erased'). */
  removed: number;
  /** Why deferred/errored — always present unless erased. */
  reason: string | null;
}

export interface PropagationReport {
  subject: string;
  /** Targets whose deletes really ran. */
  propagated: PropagationResult[];
  /** Targets not actioned (not-configured / unreachable / errored) — honest, never counted erased. */
  deferred: PropagationResult[];
}

/**
 * Fold executed adapter results + the plan's not-configured targets into an honest report. PURE.
 * An `erased` outcome goes to `propagated`; everything else (deferred/error) goes to `deferred`.
 * The not-configured targets from the plan are merged in as deferred so the report is exhaustive.
 */
export function summarizePropagation(
  subject: string,
  executed: readonly PropagationResult[],
  notConfigured: readonly NotConfigured[],
): PropagationReport {
  const deferredFromPlan: PropagationResult[] = notConfigured.map((n) => ({
    target: n.target,
    label: n.label,
    outcome: 'deferred',
    removed: 0,
    reason: n.reason,
  }));
  const propagated = executed.filter((r) => r.outcome === 'erased');
  const deferred = [...executed.filter((r) => r.outcome !== 'erased'), ...deferredFromPlan];
  return { subject: subjectKey(subject), propagated, deferred };
}
