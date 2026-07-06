// ─── App-runs view logic (Builder Epic Phase 4A) — PURE presentation rules (client-safe) ──────────
//
// Backs the RUNNING (screen 3) + REVIEW (screen 4) surfaces. This file is ZERO-IO on purpose: it maps
// a run/step status → a label + tone, decides which step (if any) is awaiting a human decision,
// whether a run can be reviewed, and whether the UI should keep polling. Plain functions over the
// persisted `appRuns` row shape — no DB import — so the CLIENT components (AppRunStatus/AppReview)
// can import it without pulling `pg` into the browser bundle. The DB read helpers that back the pages
// live in the sibling `app-runs-view-reader.ts` (server-only). Together they own the READ/PRESENT
// path for the operator screens, disjoint from app-run-store.ts (2A) which owns the WRITE path.
//
// The row TYPE mirrors schema.ts appRuns; it is re-declared locally so this stays import-free.

// ─── The row's per-step shape (mirrors schema.ts appRuns.steps jsonb) ─────────────────────────────
export interface AppRunStepRow {
  id: string;
  kind: string;
  label: string;
  status: string; // queued|running|awaiting_human|done|error|skipped
  outcome?: string;
  refs?: string[];
  detail?: string;
  childRunId?: string;
  startedAt?: string;
  finishedAt?: string;
}

// ─── The view type screens 3/4 consume — a plain, serializable projection of the row ──────────────
export interface AppRunView {
  id: string;
  appId: string;
  status: string; // queued|running|awaiting_human|done|error|cancelled
  input: Record<string, unknown>;
  steps: AppRunStepRow[];
  outcome: string;
  provenance: { signature: string; algorithm: string; publicKey: string | null; signedAt: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
}

// ─── Tone vocabulary — the design tokens' status colours, chosen by pure rule ─────────────────────
export type StatusTone = 'neutral' | 'active' | 'warn' | 'success' | 'error';

// ─── statusLabel / statusTone — a run OR step status → operator-facing label + tone ───────────────
// Both run- and step-level statuses share the same vocabulary, so one mapping serves both. Unknown
// statuses fall back to the raw value / neutral tone (honest, never crashes on a new status).
const LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  awaiting_human: 'Awaiting review',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

const TONES: Record<string, StatusTone> = {
  queued: 'neutral',
  running: 'active',
  awaiting_human: 'warn',
  done: 'success',
  error: 'error',
  cancelled: 'neutral',
  skipped: 'neutral',
};

export function statusLabel(status: string): string {
  return LABELS[status] ?? status;
}

export function statusTone(status: string): StatusTone {
  return TONES[status] ?? 'neutral';
}

// ─── isTerminal — a run that will never change again (stop polling) ───────────────────────────────
export function isTerminal(status: string): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled';
}

// ─── shouldPoll — the RUNNING screen keeps polling while the run is live (or paused) ──────────────
// Poll while queued/running/awaiting_human; stop once terminal. (An awaiting_human run is still
// "open" — a human decision may resume it — so we keep polling to catch the resume/terminal flip.)
export function shouldPoll(status: string): boolean {
  return !isTerminal(status);
}

// ─── awaitingStep — the step (if any) that has paused the run for a human decision ────────────────
// The first step in status 'awaiting_human'. There is at most one at a time (the executor pauses on
// it and does not advance successors until it resolves), so "first" is deterministic.
export function awaitingStep(steps: AppRunStepRow[]): AppRunStepRow | null {
  return steps.find((s) => s.status === 'awaiting_human') ?? null;
}

// ─── canReview — a run is reviewable iff it is paused at a human step ─────────────────────────────
// The REVIEW screen's guard + the review route's precondition. A run that already terminated (done/
// error/cancelled) or has not reached the human step is NOT reviewable.
export function canReview(run: Pick<AppRunView, 'status' | 'steps'>): boolean {
  return run.status === 'awaiting_human' && awaitingStep(run.steps) !== null;
}

// ─── progress — a {done,total} tuple for the RUNNING screen's progress line ───────────────────────
// done counts steps that reached a terminal-per-step state (done or skipped); total is every step.
export function progress(steps: AppRunStepRow[]): { done: number; total: number } {
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  return { done, total: steps.length };
}

// ─── priorContextForReview — the steps that ran BEFORE the awaiting step (context for the reviewer) ─
// Everything up to (not including) the first awaiting_human step, so the REVIEW screen can show the
// reviewer what led here (prior outputs + sources). Returns [] when nothing is awaiting.
export function priorContextForReview(steps: AppRunStepRow[]): AppRunStepRow[] {
  const idx = steps.findIndex((s) => s.status === 'awaiting_human');
  if (idx < 0) return [];
  return steps.slice(0, idx);
}

// ─── describeDuration — a human "1.2s" / "340ms" / "—" from two ISO timestamps ────────────────────
export function describeDuration(startedAt?: string, finishedAt?: string): string {
  if (!startedAt || !finishedAt) return '—';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

// ─── AppRunRowLike — the minimal row shape toAppRunView needs (kept local, import-free) ───────────
// The DB reader (app-runs-view-reader.ts) passes the drizzle `AppRun` row, which is structurally
// this. Declaring it here keeps this module free of the `@/db` import so it stays client-safe.
export interface AppRunRowLike {
  id: string;
  appId: string;
  status: string;
  input?: unknown;
  steps?: unknown;
  outcome?: string | null;
  provenance?: AppRunView['provenance'];
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
}

// ─── Row → view mapper (pure) ─────────────────────────────────────────────────────────────────────
export function toAppRunView(row: AppRunRowLike): AppRunView {
  return {
    id: row.id,
    appId: row.appId,
    status: row.status,
    input: (row.input ?? {}) as Record<string, unknown>,
    steps: (row.steps ?? []) as AppRunStepRow[],
    outcome: row.outcome ?? '',
    provenance: row.provenance ?? null,
    startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
    finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
  };
}
