// Read-back surface for durable-execution / agent-run history.
//
// SOLID seam: `summarizeRuns` below is a PURE function (zero imports, zero I/O, zero db) that turns
// a list of run records into a normalized timeline/summary — unit-testable in isolation. The thin
// adapter that pulls recent runs from the existing agentrun store and feeds this function lives in
// `agent-runs-store.ts` (kept separate so this module never drags the db into a unit test). Route
// handlers/pages call the adapter.

// The minimal run/step record shape this rule needs — structurally satisfied by AgentRun/RunStep
// from lib/agentrun, but declared locally so the pure logic imports nothing.
export interface RunStepRecord {
  kind: string;
  ms: number;
}

export interface RunRecord {
  id: string;
  agentId: string;
  query: string;
  status: string;
  startedAt: string;
  steps?: RunStepRecord[] | null;
}

export interface StepRollup {
  kind: string;
  count: number;
  totalMs: number;
}

export interface RunSummaryRow {
  id: string;
  agentId: string;
  status: string;
  startedAt: string;
  stepCount: number;
  /** Sum of every step's duration — the run's total in-pipeline time. */
  durationMs: number;
  query: string;
}

export interface RunsSummary {
  totalRuns: number;
  /** Count of runs per status (done / denied / blocked / pending_review / …). */
  statusCounts: Record<string, number>;
  /** Count + total duration per step kind, across all runs — the aggregate pipeline rollup. */
  stepRollup: StepRollup[];
  /** Sum of durationMs across all runs. */
  totalDurationMs: number;
  /** Mean run duration (0 when there are no runs). */
  avgDurationMs: number;
}

export interface RunsView {
  summary: RunsSummary;
  /** Runs newest-first (by startedAt, descending), each with a per-run step total. */
  runs: RunSummaryRow[];
}

function runDurationMs(steps: RunStepRecord[]): number {
  return steps.reduce((sum, s) => sum + (Number.isFinite(s.ms) ? s.ms : 0), 0);
}

// PURE: given raw run records, compute the normalized timeline + summary. No db, no clock, no env.
export function summarizeRuns(records: RunRecord[]): RunsView {
  const runs: RunSummaryRow[] = records
    .map((r) => {
      const steps = r.steps ?? [];
      return {
        id: r.id,
        agentId: r.agentId,
        status: r.status,
        startedAt: r.startedAt,
        stepCount: steps.length,
        durationMs: runDurationMs(steps),
        query: r.query,
      };
    })
    // Newest-first. String compare is correct for ISO-8601 timestamps.
    .sort((a, b) => {
      if (a.startedAt < b.startedAt) return 1;
      if (a.startedAt > b.startedAt) return -1;
      return 0;
    });

  const statusCounts: Record<string, number> = {};
  const rollupByKind = new Map<string, StepRollup>();
  let totalDurationMs = 0;

  for (const r of records) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    for (const s of r.steps ?? []) {
      const ms = Number.isFinite(s.ms) ? s.ms : 0;
      totalDurationMs += ms;
      const cur = rollupByKind.get(s.kind) ?? { kind: s.kind, count: 0, totalMs: 0 };
      cur.count += 1;
      cur.totalMs += ms;
      rollupByKind.set(s.kind, cur);
    }
  }

  const stepRollup = [...rollupByKind.values()].sort((a, b) => b.totalMs - a.totalMs);
  const totalRuns = records.length;

  return {
    summary: {
      totalRuns,
      statusCounts,
      stepRollup,
      totalDurationMs,
      avgDurationMs: totalRuns > 0 ? Math.round(totalDurationMs / totalRuns) : 0,
    },
    runs,
  };
}
