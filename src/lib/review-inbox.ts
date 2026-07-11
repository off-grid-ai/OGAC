// ─── HITL review-inbox logic — PURE presentation + scoping rules (zero-IO, client-safe) ───────────
//
// Backs the cross-app REVIEWER INBOX (the queue of runs awaiting a human decision) and the plain-
// language REVIEW DETAIL a non-technical BFSI reviewer (claims officer / manager / Head of Pricing)
// reads before approving or rejecting. This file is ZERO-IO on purpose so the CLIENT components can
// import it without pulling `pg`/session into the browser bundle; the DB reads that back the pages
// live in the sibling `review-inbox-reader.ts` (server-only).
//
// Two responsibilities, both pure:
//   1. SCOPING — given the runs awaiting a human decision + each run's app access policy + the
//      caller, keep only the runs THIS reviewer may actually decide on. Reuses the ONE authority
//      rule (evaluateApprovalAuthority) the review route enforces — the inbox never shows a run the
//      reviewer would be 403'd on when they clicked Approve. (A reviewer who can `reject` but not
//      `approve` still sees the item — reject needs no authority — but the detail surfaces that they
//      are UNDER authority to approve, so it's honest, not a dead-end.)
//   2. PRESENTATION — turn a raw run + its spec into a plain-language decision the reviewer
//      understands in seconds: the question being asked, the amount/subject at a glance, who
//      requested it and when, the draft output, the WHY (citations + faithfulness + guardrail/PII
//      notes), the input, and the policy context (what rule routed this to review).
//
// The run/step/app shapes are re-declared structurally (no `@/db`, no `@/lib/apps-store` import) so
// this stays import-free and client-safe. The reader maps the real rows onto these shapes.

import {
  type AppAccessCaller,
  type AppAccessPolicy,
  evaluateApprovalAuthority,
} from '@/lib/app-access-policy';
import {
  type AppRunView,
  type AppRunStepRow,
  awaitingStep,
  priorContextForReview,
} from '@/lib/app-runs-view';

// ─── the minimal app shape the inbox/detail needs (structural — no store import) ──────────────────
export interface ReviewAppLike {
  id: string;
  title: string;
  summary?: string;
  ownerId: string;
  /** The access policy bound to this app (the EFFECTIVE policy the reader resolved). */
  policy: AppAccessPolicy;
}

// ─── the child agent-run shape the detail pulls its citations + eval + guardrail notes from ────────
// Structural subset of AgentRun (agentrun.ts) — the reader loads it by the awaiting step's childRunId
// (or the last upstream agent step's) so the reviewer sees the SOURCES the draft used and how
// faithful/checked it is. Absent (no agent step / not found) ⇒ the detail degrades to "no trace".
export interface ReviewAgentTrace {
  id: string;
  citations: { ref: string; title: string; snippet: string; score: number; supported: boolean }[];
  checks: { name: string; verdict: string; score?: number; detail?: string }[];
}

// ─── an inbox row — the scannable at-a-glance summary of one pending decision ─────────────────────
export interface ReviewInboxItem {
  runId: string;
  appId: string;
  appTitle: string;
  /** The plain-language decision line, e.g. "Approve ₹5,00,000 reimbursement". */
  question: string;
  /** The money/subject at a glance (already formatted), or null when there is none. */
  amountLabel: string | null;
  /** Who requested the run (the input's requester), best-effort. */
  requestedBy: string | null;
  /** ISO timestamp the run started (when it entered the queue), or null. */
  startedAt: string | null;
  /** The label of the human step it is paused on. */
  stepLabel: string;
  /** True when THIS reviewer holds the authority to APPROVE (not merely to view/reject). */
  canApprove: boolean;
}

// ─── the full detail a reviewer reads before deciding ─────────────────────────────────────────────
export interface ReviewDetail {
  runId: string;
  appId: string;
  appTitle: string;
  appSummary: string;
  question: string;
  amountLabel: string | null;
  requestedBy: string | null;
  startedAt: string | null;
  stepLabel: string;
  /** The draft the app is recommending — rendered readably (already a string). */
  draftOutput: string;
  /** The app's own recommendation line, distilled from the pending/last agent step. */
  recommendation: string;
  /** WHY: the sources the answer used. */
  citations: { title: string; snippet: string; supported: boolean; scorePct: number | null }[];
  /** WHY: the faithfulness/grounding score as a 0–100 %, or null when not scored. */
  faithfulnessPct: number | null;
  /** WHY: guardrail / PII notes (a plain sentence each), from the trace checks. */
  guardrailNotes: string[];
  /** The run input as readable key/value pairs (not raw JSON). */
  inputPairs: { key: string; value: string }[];
  /** The policy context — what rule routed this to a human, in plain language. */
  policyContext: string;
  /** True when THIS reviewer may APPROVE; false ⇒ they may only reject (surface gracefully). */
  canApprove: boolean;
  /** When canApprove is false, WHY (the authority reason) — shown as a gentle notice, not a crash. */
  approveBlockedReason: string | null;
}

// ─── amount / threshold formatting (INR — the demo tenant is Indian BFSI) ─────────────────────────
// The Indian grouping (₹5,00,000) is the reviewer's native format; a plain Intl 'en-IN' currency
// formatter produces exactly that. Non-numeric / absent ⇒ null (no amount to show).
export function formatInr(value: unknown): string | null {
  let n = Number.NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value);
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

// The keys we treat as "the amount" for the at-a-glance line + the decision question, in priority
// order. This mirrors the approval-authority thresholdAttribute vocabulary (amount/quote/value).
const AMOUNT_KEYS = new Set(['amount', 'quote', 'value', 'sum', 'total', 'premium']);

// The keys we treat as "who requested this", in priority order.
const REQUESTER_KEYS = [
  'requestedBy',
  'requested_by',
  'requester',
  'employeeId',
  'employee_id',
  'empId',
  'emp_id',
  'customer',
  'applicant',
];

// The keys we treat as "the subject" (what the decision is about) when there is no amount.
const SUBJECT_KEYS = [
  'subject',
  'title',
  'purpose',
  'reason',
  'description',
  'claimType',
  'claim_type',
];

function readStr(input: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = input[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

function readAmount(input: Record<string, unknown>): { key: string; value: unknown } | null {
  for (const k of AMOUNT_KEYS) {
    if (input[k] !== undefined && input[k] !== null && String(input[k]).trim() !== '') {
      return { key: k, value: input[k] };
    }
  }
  return null;
}

// ─── decisionQuestion — the plain-language "Approve X for Y?" line (PURE) ─────────────────────────
// Built from the run input + the app title. Falls back gracefully as fields are missing so it always
// reads as a sentence, never "Approve undefined".
export function decisionQuestion(app: ReviewAppLike, input: Record<string, unknown>): string {
  const amount = readAmount(input);
  const amountLabel = amount ? formatInr(amount.value) : null;
  const requester = readStr(input, REQUESTER_KEYS);
  const subject = readStr(input, SUBJECT_KEYS);
  const noun = subject ?? app.title;
  const forWhom = requester ? ` for ${requester}` : '';
  if (amountLabel) return `Approve ${amountLabel} — ${noun}${forWhom}?`;
  return `Approve ${noun}${forWhom}?`;
}

// ─── amountLabelFor — the money at a glance (or null) ─────────────────────────────────────────────
export function amountLabelFor(input: Record<string, unknown>): string | null {
  const amount = readAmount(input);
  return amount ? formatInr(amount.value) : null;
}

// ─── requestedByFor — who requested the run, best-effort ──────────────────────────────────────────
export function requestedByFor(input: Record<string, unknown>): string | null {
  return readStr(input, REQUESTER_KEYS);
}

// ─── canReviewerApprove — does THIS caller hold the authority to APPROVE this run? (PURE) ──────────
// Reuses the EXACT authority rule the review route enforces on approve (evaluateApprovalAuthority
// over the run input), so the inbox/detail never promise an approve the route would 403. Owners and
// admins still pass through the authority gate (authority binds them too, by design — mirrors the
// pure route logic). Returns {allow, reason} so the UI can surface WHY when blocked.
export function canReviewerApprove(
  app: ReviewAppLike,
  input: Record<string, unknown>,
  caller: AppAccessCaller,
): { allow: boolean; reason: string } {
  // Cross-org caller: never.
  if (caller.orgId !== app.policy.orgId) {
    return { allow: false, reason: `caller org ${caller.orgId} does not match this app's org` };
  }
  return evaluateApprovalAuthority(app.policy.approval, caller, input);
}

// ─── isReviewerFor — may this caller act on this app's HITL runs at all? (PURE) ───────────────────
// True for the owner, an admin, or a caller on the approve action's role/department allow-list, or a
// listed approver (role/user). This is deliberately BROADER than "can approve THIS amount" — a
// reviewer under the amount threshold still belongs in the queue (they may reject / escalate). It is
// the WHO gate; the amount-authority is the separate canApprove gate surfaced per item.
export function isReviewerFor(app: ReviewAppLike, caller: AppAccessCaller): boolean {
  if (caller.orgId !== app.policy.orgId) return false;
  if (caller.role === 'admin') return true;
  if (caller.userId && caller.userId === app.policy.ownerId) return true;
  const approval = app.policy.approval;
  if (approval) {
    if ((approval.approverRoles ?? []).includes(caller.role ?? '')) return true;
    if ((approval.approverUsers ?? []).includes(caller.userId)) return true;
  }
  const rule = app.policy.actions.approve;
  if (rule) {
    if ((rule.roles ?? []).includes('*')) return true;
    if (caller.role && (rule.roles ?? []).includes(caller.role)) return true;
    if (caller.department && (rule.departments ?? []).includes(caller.department)) return true;
  }
  return false;
}

// ─── summarizeInboxItem — one run + its app → a scannable inbox row (PURE) ────────────────────────
export function summarizeInboxItem(
  run: AppRunView,
  app: ReviewAppLike,
  caller: AppAccessCaller,
): ReviewInboxItem {
  const pending = awaitingStep(run.steps);
  const approve = canReviewerApprove(app, run.input ?? {}, caller);
  return {
    runId: run.id,
    appId: run.appId,
    appTitle: app.title,
    question: decisionQuestion(app, run.input ?? {}),
    amountLabel: amountLabelFor(run.input ?? {}),
    requestedBy: requestedByFor(run.input ?? {}),
    startedAt: run.startedAt,
    stepLabel: pending?.label ?? 'Awaiting decision',
    canApprove: approve.allow,
  };
}

// ─── scopeInbox — the reviewer's queue: runs they may DECIDE on, newest first (PURE) ──────────────
// A run belongs in a reviewer's inbox iff (a) it is genuinely awaiting a human decision AND (b) the
// reviewer may act on it at all (isReviewerFor — approve OR reject). Reject needs no authority, so a
// reviewer under the amount threshold still sees the item; the detail then makes the approve-vs-reject
// authority clear. Cross-org / non-reviewer runs are filtered out entirely.
export function scopeInbox(
  runs: AppRunView[],
  appsById: Map<string, ReviewAppLike>,
  caller: AppAccessCaller,
): ReviewInboxItem[] {
  const items: ReviewInboxItem[] = [];
  for (const run of runs) {
    if (run.status !== 'awaiting_human') continue;
    if (!awaitingStep(run.steps)) continue;
    const app = appsById.get(run.appId);
    if (!app) continue;
    if (!isReviewerFor(app, caller)) continue;
    items.push(summarizeInboxItem(run, app, caller));
  }
  // Newest first (most recent to enter the queue at the top).
  items.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  return items;
}

// ─── faithfulness + guardrail extraction from the child agent trace (PURE) ────────────────────────
// The grounding check (CHECK_IDS 'grounding') carries the faithfulness score (0–1); we surface it as
// a 0–100 %. PII/guardrail checks become a plain sentence each so a non-tech reviewer reads "No
// sensitive data was exposed" rather than a verdict token.
export function faithfulnessPct(trace: ReviewAgentTrace | null): number | null {
  if (!trace) return null;
  const grounding = trace.checks.find((c) => c.name === 'grounding');
  if (grounding && typeof grounding.score === 'number' && Number.isFinite(grounding.score)) {
    return Math.round(grounding.score * 100);
  }
  return null;
}

export function guardrailNotesFrom(trace: ReviewAgentTrace | null): string[] {
  if (!trace) return [];
  const notes: string[] = [];
  for (const c of trace.checks) {
    if (c.name === 'grounding') continue; // surfaced separately as faithfulness
    if (c.name === 'pii') {
      const detailSuffix = c.detail ? ` (${c.detail})` : '';
      notes.push(
        c.verdict === 'redacted'
          ? `Sensitive data was detected and masked before the model saw it${detailSuffix}.`
          : 'No sensitive personal data was exposed.',
      );
    } else if (c.name === 'guardrail-rules' || c.name === 'injection') {
      notes.push(
        c.verdict === 'pass'
          ? 'All content guardrails passed.'
          : `A content guardrail flagged this: ${c.detail ?? c.verdict}.`,
      );
    } else {
      notes.push(`${c.name}: ${c.verdict}${c.detail ? ` — ${c.detail}` : ''}`);
    }
  }
  return notes;
}

// ─── recommendationFrom — the app's own recommendation / draft, distilled (PURE) ──────────────────
// The draft output IS the recommendation the app is making; we surface the awaiting step's outcome
// (what it produced), falling back to the last upstream step's output, then the run outcome.
export function recommendationFrom(run: AppRunView): string {
  const pending = awaitingStep(run.steps);
  if (pending?.outcome?.trim()) return pending.outcome.trim();
  const prior = priorContextForReview(run.steps);
  for (let i = prior.length - 1; i >= 0; i--) {
    if (prior[i].outcome?.trim()) return prior[i].outcome!.trim();
  }
  return run.outcome?.trim() || 'The app produced no draft output at this step.';
}

// ─── policyContextFrom — what rule routed this to a human, in plain language (PURE) ───────────────
// Built from the app's approval authority (the threshold that trips a human) + the run's amount. So a
// reviewer sees "This ₹5,00,000 is above the ₹1,00,000 auto-approve limit" instead of an opaque
// "awaiting_human". Falls back to a generic sentence when no threshold is set.
export function policyContextFrom(app: ReviewAppLike, input: Record<string, unknown>): string {
  const approval = app.policy.approval;
  const stepReason =
    'This step is configured to require a person to sign off before the run continues.';
  if (approval?.thresholdAttribute && approval.maxThreshold !== undefined) {
    const raw = input[approval.thresholdAttribute];
    const amountLabel = formatInr(raw);
    const limitLabel = formatInr(approval.maxThreshold);
    if (amountLabel && limitLabel) {
      return `This ${approval.thresholdAttribute} of ${amountLabel} is above the ${limitLabel} auto-approval limit, so it needs a manager's decision.`;
    }
    if (limitLabel) {
      return `Amounts above ${limitLabel} need a manager's approval before the run continues.`;
    }
  }
  return stepReason;
}

// ─── inputPairs — the run input as readable key/value rows (PURE) ─────────────────────────────────
// Turns the input object into labelled rows (amount fields formatted as INR) so the reviewer reads
// the request, not raw JSON. Nested objects/arrays are JSON-stringified compactly as a last resort.
export function inputPairs(input: Record<string, unknown>): { key: string; value: string }[] {
  const pairs: { key: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(input ?? {})) {
    if (raw === undefined || raw === null) continue;
    let value: string;
    if (AMOUNT_KEYS.has(key)) {
      value = formatInr(raw) ?? String(raw);
    } else if (typeof raw === 'object') {
      value = JSON.stringify(raw);
    } else {
      value = String(raw);
    }
    pairs.push({ key: humanizeKey(key), value });
  }
  return pairs;
}

// snake_case / camelCase → "Title Case" for the reviewer-facing key labels.
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── buildReviewDetail — assemble the full plain-language detail for one run (PURE) ───────────────
export function buildReviewDetail(
  run: AppRunView,
  app: ReviewAppLike,
  trace: ReviewAgentTrace | null,
  caller: AppAccessCaller,
): ReviewDetail {
  const input = run.input ?? {};
  const pending = awaitingStep(run.steps);
  const approve = canReviewerApprove(app, input, caller);
  const draft = recommendationFrom(run);
  return {
    runId: run.id,
    appId: run.appId,
    appTitle: app.title,
    appSummary: app.summary ?? '',
    question: decisionQuestion(app, input),
    amountLabel: amountLabelFor(input),
    requestedBy: requestedByFor(input),
    startedAt: run.startedAt,
    stepLabel: pending?.label ?? 'Awaiting decision',
    draftOutput: draft,
    recommendation: draft,
    citations: (trace?.citations ?? []).map((c) => ({
      title: c.title || c.ref,
      snippet: c.snippet,
      supported: c.supported,
      scorePct:
        typeof c.score === 'number' && Number.isFinite(c.score) ? Math.round(c.score * 100) : null,
    })),
    faithfulnessPct: faithfulnessPct(trace),
    guardrailNotes: guardrailNotesFrom(trace),
    inputPairs: inputPairs(input),
    policyContext: policyContextFrom(app, input),
    canApprove: approve.allow,
    approveBlockedReason: approve.allow ? null : approve.reason,
  };
}

// ─── childRunIdForReview — which agent-run trace backs this decision (PURE) ───────────────────────
// The reviewer's "why" comes from the agent step that produced the draft. Prefer the awaiting step's
// own childRunId (a human step rarely has one), else the LAST upstream agent step's childRunId — that
// is the step whose output the human is signing off on. Returns null when no agent step ran.
export function childRunIdForReview(steps: AppRunStepRow[]): string | null {
  const pending = awaitingStep(steps);
  if (pending?.childRunId) return pending.childRunId;
  const prior = priorContextForReview(steps);
  for (let i = prior.length - 1; i >= 0; i--) {
    if (prior[i].childRunId) return prior[i].childRunId!;
  }
  return null;
}
