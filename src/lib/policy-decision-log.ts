// First-party policy DECISION LOG — the read-back seam for the Policy/Control surface.
//
// Enforcement runs through the policy port (src/lib/adapters/policy.ts). Whether the first-party
// ABAC engine or OPA answers, EVERY decision flows through one `evaluate()` call. This module is the
// place those decisions are mirrored so the console can show a real decision history WITHOUT needing
// OPA's external decision-log sink (OFFGRID_OPA_DECISION_LOG_URL) configured.
//
// SOLID: the shaping/ring-buffer logic here is PURE + unit-testable (a bounded in-memory ring, no
// I/O, no imports). The recording seam is a single `recordDecision` call the port makes; the reader
// (policy-view.readDecisions) drains this buffer as a fallback when no external sink is set. It
// reuses the SAME PolicyDecisionRow display model the OPA-sink path produces (DRY) — nothing is
// fabricated; a row exists iff a real evaluate() happened.
//
// Scope note: this is an in-process ring (per Node process). It is the honest, dependency-free
// read-back for a single-node console. A durable cross-restart store would need a DB table (owned by
// the schema/store agent) — deliberately NOT added here; see docs.

import type { PolicyDecisionRow } from '@/lib/policy-view';

// What the enforcement seam records for each decision. Everything the port already has on hand.
export interface DecisionRecordInput {
  allow: boolean;
  engine: string; // 'abac' | 'opa'
  reason: string;
  role: string; // the subject role that was evaluated
  resource: string; // the resource the decision was about
  attributes?: Record<string, string>; // subject attributes (the decision input)
  ts?: string; // ISO; defaults to now
  id?: string; // stable id; defaults to a monotonic synthesized id
}

// Bounded ring so a long-running process never grows unbounded. Newest kept.
const MAX_DECISIONS = 500;

// ── Pure ring buffer ────────────────────────────────────────────────────────
// Push `rec` onto `buf`, returning a NEW array capped at `max` (newest-first). Pure — the module
// state below is the only mutable holder; the shaping/capping rule is testable in isolation.
export function pushCapped<T>(buf: readonly T[], rec: T, max = MAX_DECISIONS): T[] {
  const next = [rec, ...buf];
  return next.length > max ? next.slice(0, max) : next;
}

// ── Pure shaper: a recorded decision → the shared display row ─────────────────
// Reuses PolicyDecisionRow so the read-back is identical whether it came from OPA's sink or here.
export function toDecisionRow(rec: DecisionRecordInput, seq: number): PolicyDecisionRow {
  const attrs = rec.attributes ?? {};
  const inputParts = Object.keys(attrs)
    .sort()
    .map((k) => `${k}=${attrs[k]}`);
  const input = [
    `role=${rec.role || '*'}`,
    `resource=${rec.resource || '*'}`,
    ...inputParts,
  ].join(', ');
  return {
    id: rec.id ?? `abac-${seq}`,
    decision: rec.allow ? 'allow' : 'deny',
    allow: rec.allow,
    path: rec.resource || 'offgrid/authz',
    input: `${input}${rec.reason ? ` — ${rec.reason}` : ''}`,
    timestamp: rec.ts ?? new Date().toISOString(),
    engine: rec.engine || 'abac',
  };
}

// ── Module state + recording/reading seam (thin, non-pure holder) ─────────────
let ring: PolicyDecisionRow[] = [];
let seq = 0;

// Record one enforcement decision. Called by the policy port for every evaluate(). Never throws —
// read-back is best-effort and must never fail the access decision it is mirroring.
export function recordDecision(rec: DecisionRecordInput): void {
  try {
    seq += 1;
    ring = pushCapped(ring, toDecisionRow(rec, seq));
  } catch {
    /* recording is best-effort — never fail enforcement */
  }
}

// Read recent decisions, newest-first, capped at `limit`.
export function recentDecisions(limit = 200): PolicyDecisionRow[] {
  return ring.slice(0, Math.max(0, limit));
}

// Test/util: clear the ring.
export function _resetDecisionLog(): void {
  ring = [];
  seq = 0;
}
