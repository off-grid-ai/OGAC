// ─── ETL QUALITY GATE — the pure decision that stops bad data reaching the warehouse ──────────────
//
// The problem this closes: an ETL job read rows, redacted them, projected them and wrote them into
// ClickHouse with NO quality check in the path. Data-quality checkpoints existed, but only as a
// standalone admin surface — nothing consumed a verdict, so a bad sync landed silently and every
// downstream answer inherited it. "Bad data in = confidently-wrong intelligence out."
//
// This module owns the RULE only (zero I/O, exhaustively unit-testable): given the job's configured
// gate and the checkpoint verdict, decide whether the write proceeds. The I/O (running the checkpoint,
// writing to the warehouse) stays in the store — same split as tenancy-policy.ts vs tenancy.ts.
//
// Modes, chosen so enabling the feature can never surprise an existing job:
//   • 'off'   — DEFAULT. No checkpoint runs; behaviour is byte-identical to before the gate existed.
//   • 'warn'  — run the checkpoint and RECORD the verdict, but never block. The honest first step for
//               an operator who wants to see what would have been caught before enforcing.
//   • 'block' — a FAILING verdict stops the write. The rows never land.
//
// FAIL-CLOSED on an unreachable engine, but only in 'block' mode: if the operator asked us to
// guarantee quality and we cannot verify it, writing anyway would be a false guarantee. In 'warn' the
// same outage is recorded and the sync proceeds (it never promised enforcement).

/** What the job stores. `expectations` is the Great Expectations suite body, passed through as-is. */
export interface EtlQualityGate {
  mode: 'off' | 'warn' | 'block';
  /** The expectation suite handed to the checkpoint engine. Shape owned by the GX sidecar. */
  expectations?: unknown;
  /** Optional suite name for the checkpoint + evidence trail. */
  suite?: string;
}

export const DEFAULT_QUALITY_GATE: EtlQualityGate = { mode: 'off' };

/** The verdict subset this rule needs — structurally compatible with CheckpointVerdict. */
export interface QualityVerdictLike {
  success: boolean;
  passed?: number;
  failed?: number;
  total?: number;
  /** false ⇒ the checkpoint engine could not be reached, so the verdict is synthesized, not measured. */
  engineReachable?: boolean;
}

export interface QualityGateOutcome {
  /** true ⇒ the destination write MUST NOT happen. */
  block: boolean;
  /** true ⇒ a checkpoint should be run at all (false for mode 'off'). */
  checked: boolean;
  /** Operator-facing reason, safe for a run log (never carries row data). */
  reason: string;
}

/** Normalize a persisted/loose gate value. Anything unrecognized falls back to the safe default. PURE. */
export function normalizeQualityGate(raw: unknown): EtlQualityGate {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_QUALITY_GATE };
  const r = raw as { mode?: unknown; expectations?: unknown; suite?: unknown };
  const mode = r.mode === 'block' || r.mode === 'warn' ? r.mode : 'off';
  const suite = typeof r.suite === 'string' && r.suite.trim() ? r.suite.trim() : undefined;
  return {
    mode,
    ...(r.expectations !== undefined ? { expectations: r.expectations } : {}),
    ...(suite ? { suite } : {}),
  };
}

/** Does this gate require running a checkpoint before the write? PURE. */
export function qualityGateEnabled(gate: EtlQualityGate): boolean {
  return gate.mode !== 'off';
}

/**
 * The decision. PURE, total — every branch returns an outcome and nothing throws.
 *
 * `verdict` is null when no checkpoint ran (mode 'off', or the caller skipped it).
 */
export function qualityGateDecision(
  gate: EtlQualityGate,
  verdict: QualityVerdictLike | null,
): QualityGateOutcome {
  if (gate.mode === 'off') {
    return { block: false, checked: false, reason: 'quality gate off — no checkpoint run' };
  }
  if (!verdict) {
    // Asked to check but given nothing: only 'block' may assume the worst.
    return gate.mode === 'block'
      ? { block: true, checked: false, reason: 'quality gate BLOCKED the sync: no checkpoint verdict was produced' }
      : { block: false, checked: false, reason: 'quality gate warn — no checkpoint verdict was produced' };
  }

  const counts = `${verdict.passed ?? 0}/${verdict.total ?? 0} expectations passed`;

  if (verdict.engineReachable === false) {
    return gate.mode === 'block'
      ? {
          block: true,
          checked: false,
          reason: 'quality gate BLOCKED the sync: the data-quality engine was unreachable, so quality could not be verified (fail-closed)',
        }
      : {
          block: false,
          checked: false,
          reason: 'quality gate warn — the data-quality engine was unreachable; the sync proceeded unverified',
        };
  }

  if (verdict.success) {
    return { block: false, checked: true, reason: `quality gate passed — ${counts}` };
  }
  return gate.mode === 'block'
    ? { block: true, checked: true, reason: `quality gate BLOCKED the sync: ${counts}, ${verdict.failed ?? 0} failed` }
    : { block: false, checked: true, reason: `quality gate warn — ${counts}, ${verdict.failed ?? 0} failed (sync proceeded)` };
}
