// ─────────────────────────────────────────────────────────────────────────────────────────────
// The SHARED fail-CLOSED guardrail seam (G-ADV-GOV-3).
//
// The promise: a guardrail/PII screen that THROWS or TIMES OUT is a BLOCK — never null / [] / raw.
// Historically each run path called `runChecks(...)` directly. The PiiPort itself fails closed
// (a configured-but-unreachable engine returns { blocked:true } rather than throwing), but a THROW
// anywhere else on the pre/post path — a bug in a check adapter, a recognizer-config load that
// escapes, a hung engine that outlives the request — propagated out of `runChecks`. A caller that
// swallowed that throw (`.catch(() => null)` / `.catch(() => [])`) collapsed a would-be BLOCK into
// an ALLOW and let RAW (unscreened) text reach the model. A guardrail a thrown error can silently
// disable is not a guardrail.
//
// This module is the ONE seam both the agent-run and app-run execute paths route through:
//   • screenOutcome(checks | error)  — PURE: fold check results (or a screen error) into a terminal
//     ScreenVerdict. An error ⇒ { outcome:'blocked' }. Exhaustively unit-testable, zero I/O.
//   • screenGuardrail(phase, ctx)    — I/O: run the checks with a hard TIMEOUT; ANY throw/timeout is
//     converted to a fail-closed 'blocked' verdict via screenOutcome. NEVER rejects.
//
// SOLID: the decision (error ⇒ block) is the pure `screenOutcome`; the thin I/O wrapper only adds
// the timeout + catch. DRY: one seam, both callers (agentrun.ts pre/post, app-run.ts runGuardrail).
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { type CheckContext, type CheckResult, outcomeFromChecks, runChecks } from '@/lib/checks';

// A guardrail screen must not outlive this budget — a hung engine can't stall (or silently open) a
// run. The PiiPort's own fetch timeout is 6s; we allow a little headroom for the whole check chain,
// then fail closed. Overridable per call for tests.
export const GUARDRAIL_SCREEN_TIMEOUT_MS = 8000;

export interface ScreenVerdict {
  /** The terminal screen outcome. An error/timeout is ALWAYS 'blocked' (fail-closed). */
  outcome: 'ok' | 'redacted' | 'blocked';
  /** The check results that produced the verdict (a synthetic 'blocked' check on a screen error). */
  checks: CheckResult[];
  /** true ⇒ the screen itself threw/timed out and was failed closed (not a content-level block). */
  failedClosed: boolean;
  /** Human-readable reason (the screen error, or the fired verdicts). */
  detail: string;
}

// The synthetic check recorded when the SCREEN ITSELF failed (threw/timed out). It reads as a real
// 'blocked' verdict so `outcomeFromChecks` and the audit record both show an honest BLOCK — never an
// empty/clean screen that never ran.
export function guardScreenErrorCheck(phase: 'pre' | 'post', reason: string): CheckResult {
  return {
    name: 'guardrail-screen',
    verdict: 'blocked',
    detail: `guardrail screen failed (${phase}) — run blocked (fail-closed): ${reason}`,
  };
}

/**
 * PURE — fold a completed set of check results, OR a screen error, into the terminal ScreenVerdict.
 *   • error present  ⇒ { outcome:'blocked', failedClosed:true } with a synthetic blocked check.
 *   • otherwise      ⇒ outcomeFromChecks(checks) (the existing worst-verdict rule), failedClosed:false.
 * This is the whole fail-closed decision, isolated from I/O so the "throw ⇒ block" invariant is
 * directly unit-testable.
 */
export function screenOutcome(
  phase: 'pre' | 'post',
  checks: CheckResult[],
  error?: unknown,
): ScreenVerdict {
  if (error !== undefined) {
    const reason = error instanceof Error ? error.message : String(error);
    const synthetic = guardScreenErrorCheck(phase, reason);
    return { outcome: 'blocked', checks: [synthetic], failedClosed: true, detail: synthetic.detail! };
  }
  const outcome = outcomeFromChecks(checks);
  return {
    outcome,
    checks,
    failedClosed: false,
    detail: checks.map((c) => `${c.name}:${c.verdict}`).join(' '),
  };
}

// Reject after `ms` so a hung guardrail engine that outlives its own fetch timeout can never leave
// the screen pending (which would stall the run OR, if swallowed, open it). The timeout is a THROW,
// so it flows through screenGuardrail's catch → a fail-closed 'blocked' verdict.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Run the guardrail checks for a phase, FAIL CLOSED. The ONE entry point both run paths use.
 * ANY throw (a check adapter, a config-load escape) or a timeout is converted to a 'blocked' verdict
 * via the pure screenOutcome — so a broken/hung screen BLOCKS the run instead of letting raw text
 * through. NEVER rejects: the caller always gets a decisive ScreenVerdict.
 */
export async function screenGuardrail(
  phase: 'pre' | 'post',
  ctx: Omit<CheckContext, 'phase'>,
  timeoutMs: number = GUARDRAIL_SCREEN_TIMEOUT_MS,
): Promise<ScreenVerdict> {
  try {
    const checks = await withTimeout(runChecks(phase, { ...ctx, phase }), timeoutMs, `guardrail ${phase} screen`);
    return screenOutcome(phase, checks);
  } catch (err) {
    return screenOutcome(phase, [], err);
  }
}
