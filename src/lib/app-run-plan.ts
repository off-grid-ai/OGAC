// ─── App-run planning (Builder Epic Phase 2A) — PURE, zero-IO, unit-testable ────────────────────
//
// The deterministic scheduling brain of the multi-step executor. Everything here is a plain
// function over plain data — no DB, no gateway, no imports beyond the pure AppSpec types. The I/O
// orchestrator (app-run.ts) and the durable workflow (app-run-durable.ts / Phase 2B) drive their
// step-by-step advance from these decisions, and screens 3 (RUNNING) + 4 (REVIEW) render the
// `AppRunState` this module's reducer produces.
//
// Responsibilities:
//   • topoOrder(spec)            — a stable topological order of the steps from the edges.
//   • entryStepId(spec)          — the single entry (start) step (no incoming edge).
//   • nextRunnableSteps(...)     — which steps are ready to run given who has completed.
//   • initState / applyStepResult — the pure reducer over an app-run's per-step status array
//                                   (queued → running → done/error, human → awaiting_human).
//
// Correctness note: this module assumes a spec that already passed validateAppSpec (single entry,
// all edges valid, reachable, unique ids). It is defensive against cycles (topoOrder appends any
// leftover nodes deterministically) but does not itself reject invalid graphs — that is the model's
// job. Keeping planning pure means the whole schedule is reproducible + testable without a run.

import type { AppSpec, AppStep, AppStepKind } from '@/lib/app-model';

// ─── StepRunStatus — the per-step lifecycle the reducer walks each step through ─────────────────
//   queued          — not yet started (initial state for every step)
//   running         — currently executing
//   awaiting_human  — a `human` step that paused the run for a decision (HITL)
//   done            — completed successfully
//   error           — failed
//   skipped         — reserved for conditional edges (not entered in this phase)
export type StepRunStatus = 'queued' | 'running' | 'awaiting_human' | 'done' | 'error' | 'skipped';

// The per-step slice of an app-run's live state. Mirrors the `appRuns.steps` jsonb shape so the
// orchestrator can persist this array verbatim and the UI can render it directly.
export interface StepState {
  id: string;
  kind: AppStepKind;
  label: string;
  status: StepRunStatus;
  /** Human/model output produced by the step (agent answer, connector row summary, …). */
  output?: string;
  /** Provenance/source refs surfaced by the step (retrieval hits, connector resource, …). */
  refs?: { name: string; position?: number }[];
  /** A short human-readable detail line (why it failed, what it read, …). */
  detail?: string;
  /** For an agent step: the child agentRuns.id, so the run is traceable/lineage-linked. */
  childRunId?: string;
  /** When intercepted in SHADOW mode: what the step WOULD have performed (sink/recipient/preview). */
  wouldPerform?: import('@/lib/app-run-controls').WouldPerform;
  startedAt?: string;
  finishedAt?: string;
}

// The full live state of an app-run — what screens 3/4 render. `status` is the aggregate run
// status derived from the steps; `steps` is the per-step array in topological order.
//   queued          — no step has started
//   running         — at least one step running/done, none blocking
//   awaiting_human  — a human step is paused for a decision
//   done            — every step done
//   error           — a step errored (the run halts)
//   cancelled       — set explicitly by the orchestrator (never derived here)
export type AppRunStatus = 'queued' | 'running' | 'awaiting_human' | 'done' | 'error' | 'cancelled';

export interface AppRunState {
  runId: string;
  appId: string;
  status: AppRunStatus;
  steps: StepState[];
}

// ─── topoOrder — a stable topological order of the steps ─────────────────────────────────────────
// Kahn's algorithm over the edges. Ties (multiple ready nodes) break by the step's index in
// `spec.steps` so the order is deterministic. Any nodes left over (a cycle — shouldn't happen for a
// validated spec) are appended in their declared order so the executor still visits every step.
export function topoOrder(spec: AppSpec): AppStep[] {
  const steps = spec.steps ?? [];
  const edges = spec.edges ?? [];
  const byId = new Map<string, AppStep>();
  const declIndex = new Map<string, number>();
  steps.forEach((s, i) => {
    byId.set(s.id, s);
    declIndex.set(s.id, i);
  });

  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const s of steps) {
    indegree.set(s.id, 0);
    adj.set(s.id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue; // ignore dangling edges defensively
    adj.get(e.from)!.push(e.to);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  const byDecl = (a: string, b: string): number => declIndex.get(a)! - declIndex.get(b)!;

  // Ready set = indegree 0, drained in declaration order for stability.
  const ready = steps.filter((s) => (indegree.get(s.id) ?? 0) === 0).map((s) => s.id);
  ready.sort(byDecl);

  const out: AppStep[] = [];
  const emitted = new Set<string>();
  while (ready.length) {
    const id = ready.shift()!;
    if (emitted.has(id)) continue;
    emitted.add(id);
    out.push(byId.get(id)!);
    for (const n of adj.get(id) ?? []) {
      const d = (indegree.get(n) ?? 0) - 1;
      indegree.set(n, d);
      if (d <= 0 && !emitted.has(n)) {
        ready.push(n);
        ready.sort(byDecl); // keep the ready list sorted by declaration index
      }
    }
  }

  // Append any unemitted steps (cycle remnants) deterministically so nothing is dropped.
  for (const s of steps) if (!emitted.has(s.id)) out.push(s);
  return out;
}

// ─── entryStepId — the single start step (no incoming edge) ───────────────────────────────────────
// For a validated spec there is exactly one. If the graph is degenerate we fall back to the first
// declared step so the executor always has somewhere to begin.
export function entryStepId(spec: AppSpec): string | null {
  const steps = spec.steps ?? [];
  if (steps.length === 0) return null;
  const hasIncoming = new Set((spec.edges ?? []).map((e) => e.to));
  const entries = steps.filter((s) => !hasIncoming.has(s.id));
  return entries[0]?.id ?? steps[0].id;
}

// ─── predecessorsOf — the step ids that must complete before a given step ─────────────────────────
export function predecessorsOf(spec: AppSpec, stepId: string): string[] {
  return (spec.edges ?? []).filter((e) => e.to === stepId).map((e) => e.from);
}

// ─── isStepReady — a step is runnable when all its predecessors have completed ────────────────────
// "Completed" = present in `completedIds`. A step already in `completedIds` is not runnable again.
export function isStepReady(spec: AppSpec, stepId: string, completedIds: Iterable<string>): boolean {
  const done = new Set(completedIds);
  if (done.has(stepId)) return false;
  return predecessorsOf(spec, stepId).every((p) => done.has(p));
}

// ─── nextRunnableSteps — every step whose predecessors are all complete ───────────────────────────
// Returned in topological order so the executor drives them predictably. When the graph is linear
// this is a single step; a fan-out returns the parallel-ready set.
export function nextRunnableSteps(spec: AppSpec, completedIds: Iterable<string>): AppStep[] {
  const done = new Set(completedIds);
  return topoOrder(spec).filter((s) => !done.has(s.id) && isStepReady(spec, s.id, done));
}

// ─── initState — the initial AppRunState: every step queued, run queued ───────────────────────────
export function initState(spec: AppSpec, runId: string): AppRunState {
  const steps: StepState[] = topoOrder(spec).map((s) => ({
    id: s.id,
    kind: s.kind,
    label: s.label,
    status: 'queued' as StepRunStatus,
  }));
  return { runId, appId: spec.id, status: 'queued', steps };
}

// ─── The reducer's step-result input (a subset of StepState the orchestrator produces) ──────────
export interface StepResultInput {
  status: 'running' | 'done' | 'error' | 'awaiting_human';
  output?: string;
  refs?: { name: string; position?: number }[];
  detail?: string;
  childRunId?: string;
  wouldPerform?: import('@/lib/app-run-controls').WouldPerform;
}

// ─── deriveRunStatus — the aggregate run status from the per-step array (pure) ────────────────────
// Precedence: any error → error; any awaiting_human → awaiting_human; all done → done; any
// running/done (but not all done) → running; else queued. A cancelled run is set explicitly by the
// orchestrator and is never re-derived here (this function never returns 'cancelled').
export function deriveRunStatus(steps: StepState[]): Exclude<AppRunStatus, 'cancelled'> {
  if (steps.length === 0) return 'done';
  if (steps.some((s) => s.status === 'error')) return 'error';
  if (steps.some((s) => s.status === 'awaiting_human')) return 'awaiting_human';
  if (steps.every((s) => s.status === 'done' || s.status === 'skipped')) return 'done';
  if (steps.some((s) => s.status === 'running' || s.status === 'done')) return 'running';
  return 'queued';
}

// ─── applyStepResult — advance one step's state, recompute the run status (pure reducer) ──────────
// Returns a NEW AppRunState (never mutates). This is the single point that mutates run state, so
// screens 3/4 always render a value produced here. A `human` step's result should arrive with
// status 'awaiting_human' from the orchestrator (executeStep returns that for a human kind); this
// reducer records it and rolls the run up to 'awaiting_human'. `startedAt`/`finishedAt` are stamped
// from `now` (passed in so the reducer stays pure/deterministic in tests).
export function applyStepResult(
  state: AppRunState,
  stepId: string,
  result: StepResultInput,
  now: string = new Date().toISOString(),
): AppRunState {
  const steps = state.steps.map((s): StepState => {
    if (s.id !== stepId) return s;
    const next: StepState = {
      ...s,
      status: result.status,
      ...(result.output !== undefined ? { output: result.output } : {}),
      ...(result.refs !== undefined ? { refs: result.refs } : {}),
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
      ...(result.childRunId !== undefined ? { childRunId: result.childRunId } : {}),
      ...(result.wouldPerform !== undefined ? { wouldPerform: result.wouldPerform } : {}),
    };
    if (result.status === 'running' && !s.startedAt) next.startedAt = now;
    if (result.status === 'done' || result.status === 'error') {
      if (!next.startedAt) next.startedAt = now;
      next.finishedAt = now;
    }
    return next;
  });
  return { ...state, steps, status: deriveRunStatus(steps) };
}

// ─── completedStepIds — the ids the scheduler treats as "done" for readiness ──────────────────────
// Only 'done' (and 'skipped') unblock successors. A step 'awaiting_human' has NOT completed — it
// pauses the run — so it does not unblock downstream steps until it is resolved to 'done'.
export function completedStepIds(state: AppRunState): string[] {
  return state.steps.filter((s) => s.status === 'done' || s.status === 'skipped').map((s) => s.id);
}
