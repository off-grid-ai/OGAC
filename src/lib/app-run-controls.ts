// ─── SHADOW MODE + BLAST-RADIUS controls — PURE logic, ZERO imports of db/IO ─────────────────────
//
// The BFSI adoption lever: let a cautious bank/insurer trust an autonomous app/agent by running it
// SAFELY before it acts for real. Two independent, composable controls, both decided here as pure
// functions (unit-testable, zero-IO) and enforced by the thin I/O layers (app-run.ts run executor +
// the run-start route):
//
//   1. SHADOW MODE — the run executes fully (read / reason / guardrail / eval steps run normally) but
//      any SIDE-EFFECTING step (an output sink that leaves the box: email/report/whatsapp/external
//      write) is INTERCEPTED: it records a `wouldPerform` result (what it WOULD have sent, to whom,
//      with a payload preview) and does NOT execute. `mode: 'shadow' | 'live'` (default live); a
//      per-app setting can FORCE shadow (`shadowDefault`) so an operator can dry-run before arming.
//
//   2. BLAST-RADIUS — per-app dials evaluated at RUN START: `enabled` kill-switch, `maxRunsPerDay`
//      cap, and a `spendCapUsd` (per-day or per-run) cap. Over-cap / disabled ⇒ the run is DENIED
//      with a clear reason (the I/O layer audits it). "letting it act" becomes a dial, not a leap.
//
// This composes WITH the existing pipeline contract + egress leash (an ADDITIONAL gate, not a
// replacement): a shadow intercept sits IN FRONT of the sink's own egress/PII governance — it never
// reaches the wire, so it can't leak; and the blast-radius caps sit IN FRONT of the whole run.

// ─── the run mode ─────────────────────────────────────────────────────────────────────────────────
export type RunMode = 'shadow' | 'live';

// ─── which step kinds are SIDE-EFFECTING (may leave the box / mutate the world) ────────────────────
// A run is a chain of steps. Only the ones that ACT on the outside world are intercepted in shadow:
//   • output sinks that DELIVER (email / whatsapp / external write) — they cross the wire.
//   • the report sink RENDERS a signed artifact but does NOT deliver it anywhere by itself — it's an
//     in-run artifact the operator downloads. We DO still intercept it in shadow so a dry-run makes
//     zero durable artifacts + zero crypto-signing side effects; the review screen shows "would emit".
//   • the console sink is pure record-keeping (no external effect) — NEVER intercepted.
// read/reason/guardrail/eval steps (agent, connector-query READ, guardrail, human) are NON-effecting
// — they run identically in shadow so the operator sees the REAL decision the app would make.
//
// The rule is expressed over the (kind, sink) pair so it stays a pure decision the executor calls at
// the top of each step. `output` with sink `console` is the ONLY output that is not intercepted.
export interface StepShape {
  kind: string;
  /** For an output step: its sink. Undefined for non-output kinds. */
  sink?: string;
}

/** The output sinks that actually LEAVE THE BOX or make a durable/crypto side effect. PURE. */
const SIDE_EFFECTING_SINKS = new Set<string>([
  'report',
  'email',
  'whatsapp',
  'webhook',
  'slack',
]);

/**
 * Is this step side-effecting (would it ACT on the outside world)? PURE. Only `output` steps can be —
 * and only when their sink is one that delivers/renders (not the pure `console` record sink). A future
 * external-write step kind can be added to this rule in ONE place. Everything else is read/reason.
 */
export function isSideEffectingStep(step: StepShape): boolean {
  if (step.kind !== 'output') return false;
  const sink = (step.sink ?? 'console').trim();
  return SIDE_EFFECTING_SINKS.has(sink);
}

/**
 * Should this step be INTERCEPTED for the given run mode? PURE. Intercept iff the run is in shadow AND
 * the step is side-effecting. A live run never intercepts; a shadow run intercepts only the effecting
 * steps (so reads/reasoning still run and produce a real, reviewable outcome).
 */
export function shouldIntercept(mode: RunMode, step: StepShape): boolean {
  return mode === 'shadow' && isSideEffectingStep(step);
}

// ─── the "would perform" record — what a shadowed side-effecting step WOULD have done ──────────────
// Recorded on the intercepted step's result so the trace + review screen show, verbatim, the action
// the app WOULD have taken in live mode: the sink, the recipient, the subject, and a bounded preview
// of the payload. No secret/PII amplification — this is a preview of the SAME body the sink would
// have sent (the sink's own PII masking still applies before a real send in live mode).
export interface WouldPerform {
  sink: string;
  /** Recipient / destination (email `to`, whatsapp number, report download path) — best-effort. */
  recipient?: string;
  /** The subject/title where the sink has one (email subject, report filename). */
  subject?: string;
  /** A bounded preview of the payload body the sink would have delivered. */
  payloadPreview: string;
}

const PREVIEW_MAX = 500;

/** Bound a payload preview to a safe length (pure). */
export function previewPayload(body: string, max = PREVIEW_MAX): string {
  const s = (body ?? '').trim();
  return s.length <= max ? s : `${s.slice(0, max)}… (${s.length - max} more chars)`;
}

/**
 * Build the `wouldPerform` record for a shadowed output step. PURE — the executor passes the step's
 * sink + resolved config + the accumulated outcome; this shapes what the trace/review will show.
 * Recipient/subject are pulled per-sink from the step config (email `to`/`subject`, etc.).
 */
export function buildWouldPerform(
  sink: string,
  config: Record<string, unknown> | undefined,
  outcome: string,
): WouldPerform {
  const cfg = config ?? {};
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  return {
    sink,
    // Destination per sink: email/whatsapp `to`, webhook `url`, Slack `channel` (fall back to the
    // webhook's default channel), plus the legacy recipient/number aliases.
    recipient:
      str(cfg.to) ?? str(cfg.url) ?? str(cfg.channel) ?? str(cfg.recipient) ?? str(cfg.number),
    subject: str(cfg.subject) ?? str(cfg.filename),
    payloadPreview: previewPayload(outcome),
  };
}

/**
 * The human-readable step DETAIL for an intercepted step. PURE. Prefixed `SHADOW` so the trace +
 * review screen label it unmistakably as a dry-run non-action.
 */
export function shadowDetail(w: WouldPerform): string {
  const parts = [`SHADOW: would ${w.sink}`];
  if (w.recipient) parts.push(`→ ${w.recipient}`);
  if (w.subject) parts.push(`"${w.subject}"`);
  parts.push(`(not sent). Preview: ${w.payloadPreview}`);
  return parts.join(' ');
}

// ─── BLAST-RADIUS — the per-app caps + kill-switch ─────────────────────────────────────────────────
// The dials an operator sets on an app so "letting it act" is bounded. All optional — an unset cap is
// "no limit" (never blocks). `enabled:false` is the kill-switch (disable the app entirely).
export interface BlastRadiusControls {
  /** Kill-switch: false ⇒ the app is DISABLED, every run denied. Default true (enabled). */
  enabled: boolean;
  /** Max runs per calendar day for this app. null/undefined ⇒ no cap. */
  maxRunsPerDay?: number | null;
  /** Spend cap in USD. null/undefined ⇒ no cap. Scope decided by `spendCapScope`. */
  spendCapUsd?: number | null;
  /** Whether the spend cap is measured per-day (rolling calendar day) or per-run. Default 'day'. */
  spendCapScope?: 'day' | 'run';
  /** Force shadow mode on every run of this app (dry-run until armed). Default false. */
  shadowDefault?: boolean;
}

/** The DEFAULT (permissive) controls — an app with no controls row behaves exactly as before. */
export const DEFAULT_CONTROLS: BlastRadiusControls = {
  enabled: true,
  maxRunsPerDay: null,
  spendCapUsd: null,
  spendCapScope: 'day',
  shadowDefault: false,
};

// ─── the live counters the cap decision is evaluated against ───────────────────────────────────────
// Supplied by the I/O layer (counted from the app_runs table + audit ledger). Pure so the decision is
// exhaustively unit-testable without a DB.
export interface BlastRadiusUsage {
  /** Runs of this app already started today (UTC calendar day). */
  runsToday: number;
  /** USD already spent by this app today (day scope) — priced from the audit ledger. */
  spentTodayUsd: number;
  /** Estimated USD cost of the run under consideration (per-run scope). Default 0 (local = free). */
  incomingRunCostUsd?: number;
}

export interface BlastRadiusVerdict {
  /** true ⇒ the run may START; false ⇒ denied at run start. */
  allow: boolean;
  /** Machine reason code for the deny (or 'ok'). */
  code: 'ok' | 'disabled' | 'runs-cap' | 'spend-cap';
  /** Human reason for the governed error + audit detail. */
  reason: string;
}

/**
 * Decide whether a run may START under the app's blast-radius controls. PURE — the caller supplies the
 * controls + the live usage counters; this owns the ONE cap rule. Evaluation order (least-permissive
 * first): kill-switch → runs/day cap → spend cap. An unset cap never blocks; a $0 (local) run under a
 * spend cap is always allowed to start (the on-prem dividend), and only real cloud cost can hit it.
 *
 *   - enabled === false                    → DENY (disabled — kill-switch).
 *   - maxRunsPerDay set & runsToday >= cap → DENY (daily run cap reached).
 *   - spendCapUsd set (day)  & spentToday + incoming > cap → DENY (would exceed daily spend cap).
 *   - spendCapUsd set (run)  & incoming > cap             → DENY (this run alone exceeds the cap).
 *   - otherwise                            → ALLOW.
 */
export function evaluateBlastRadius(
  controls: BlastRadiusControls,
  usage: BlastRadiusUsage,
): BlastRadiusVerdict {
  if (controls.enabled === false) {
    return {
      allow: false,
      code: 'disabled',
      reason: 'app is disabled (kill-switch on) — no runs permitted until re-enabled',
    };
  }

  const runsCap = controls.maxRunsPerDay;
  if (typeof runsCap === 'number' && runsCap >= 0 && usage.runsToday >= runsCap) {
    return {
      allow: false,
      code: 'runs-cap',
      reason: `daily run cap reached (${usage.runsToday}/${runsCap} runs today)`,
    };
  }

  const spendCap = controls.spendCapUsd;
  if (typeof spendCap === 'number' && spendCap >= 0) {
    const incoming = Math.max(0, usage.incomingRunCostUsd ?? 0);
    const scope = controls.spendCapScope ?? 'day';
    if (scope === 'run') {
      if (incoming > spendCap) {
        return {
          allow: false,
          code: 'spend-cap',
          reason: `per-run spend cap exceeded (this run ~$${incoming.toFixed(4)} > cap $${spendCap})`,
        };
      }
    } else {
      const projected = usage.spentTodayUsd + incoming;
      if (projected > spendCap) {
        return {
          allow: false,
          code: 'spend-cap',
          reason: `daily spend cap would be exceeded (spent $${usage.spentTodayUsd.toFixed(
            4,
          )} + ~$${incoming.toFixed(4)} > cap $${spendCap})`,
        };
      }
    }
  }

  return { allow: true, code: 'ok', reason: 'within blast-radius controls' };
}

// ─── resolveRunMode — the effective mode for a run (pure) ──────────────────────────────────────────
// Most-restrictive-wins: the app's `shadowDefault` forces shadow; otherwise an explicit
// `requestedMode` of 'shadow' forces shadow; otherwise 'live'. An operator can dry-run a live-defaulted
// app by requesting shadow, and can NEVER accidentally go live on a shadow-defaulted app via the
// request (a shadow-default app always runs shadow, regardless of the request).
export function resolveRunMode(
  requestedMode: RunMode | undefined,
  controls: Pick<BlastRadiusControls, 'shadowDefault'>,
): RunMode {
  if (controls.shadowDefault) return 'shadow';
  if (requestedMode === 'shadow') return 'shadow';
  return 'live';
}

// ─── normalizeControls — coerce a partial/untrusted controls patch to a valid shape (pure) ─────────
// Used by the store on write + read so a row never carries a nonsense cap. Negative/NaN caps are
// clamped to null (no cap); a non-`false` `enabled` defaults to true (fail-open on the kill-switch is
// safe — disabling is an explicit act). Scope is constrained to the two valid values.
export function normalizeControls(patch: Partial<BlastRadiusControls>): BlastRadiusControls {
  const nonNegOrNull = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    enabled: patch.enabled !== false,
    maxRunsPerDay: patch.maxRunsPerDay == null ? null : nonNegOrNull(patch.maxRunsPerDay),
    spendCapUsd: patch.spendCapUsd == null ? null : nonNegOrNull(patch.spendCapUsd),
    spendCapScope: patch.spendCapScope === 'run' ? 'run' : 'day',
    shadowDefault: patch.shadowDefault === true,
  };
}
