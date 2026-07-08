// PURE state model for the ASYNC publish-gate (M1-a). Zero-import (type-only), zero-I/O —
// unit-testable in isolation. A publish job moves through exactly three states:
//
//   gating    → the pipeline's evals are running in the background; no verdict yet.
//   published → the gate passed (or was overridden) and the pipeline was published live.
//   blocked   → the gate FAILED (no override); the pipeline stays draft; the decision says why.
//
// This module owns ONLY the legal transitions + the shape the poll route serves. The I/O seam
// (pipeline-release.ts) reads/writes rows and calls resolveFromGate to compute the terminal
// state from the gate decision — it never invents a transition itself.

import type { ReleaseGateDecision } from '@/lib/release-gate';

export type PublishJobStatus = 'gating' | 'published' | 'blocked';

/** The decision payload persisted on a resolved job (jsonb). Null while still gating. */
export interface PublishJobDecision {
  decision: ReleaseGateDecision;
  /** True when the gate failed but publish proceeded via an audited override. */
  overridden: boolean;
  /** The version published to, when it went live (published/overridden). */
  version?: number;
  /** Honest reason a resolve failed unexpectedly (eval runner threw hard) — leaves job blocked. */
  error?: string;
}

/** The view the poll route serves — the operator's window into a gating publish. */
export interface PublishJobView {
  jobId: string;
  pipelineId: string;
  status: PublishJobStatus;
  /** Present once the job resolved (published | blocked); null while gating. */
  decision: PublishJobDecision | null;
  createdAt: string | null;
}

/** Terminal states — a job here never changes again. */
export function isTerminal(status: PublishJobStatus): boolean {
  return status === 'published' || status === 'blocked';
}

/**
 * The ONLY legal transitions. A gating job may resolve to published or blocked; a terminal job is
 * frozen. Returns the next status, or null when the transition is illegal (caller must not apply
 * it). This is what guards a double-resolve or a resurrection of a finished job.
 */
export function nextStatus(
  current: PublishJobStatus,
  to: 'published' | 'blocked',
): PublishJobStatus | null {
  if (current !== 'gating') return null; // terminal — frozen
  return to;
}

/**
 * Compute the terminal status a completed gate run implies. Pure: mirrors the gate's verdict —
 *   • pass                    → published
 *   • fail + override         → published (audited elsewhere)
 *   • fail + no override      → blocked
 * The overridden flag is carried through so the persisted decision is honest about WHY it went live.
 */
export function resolveFromGate(
  decision: ReleaseGateDecision,
  override: boolean,
): { status: 'published' | 'blocked'; overridden: boolean } {
  if (decision.pass) return { status: 'published', overridden: false };
  if (override) return { status: 'published', overridden: true };
  return { status: 'blocked', overridden: false };
}
