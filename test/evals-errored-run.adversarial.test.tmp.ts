import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeEvals } from '../src/lib/evals-view.ts';

// ADVERSARIAL — G-ADV-OBS-4
// An eval run that ERRORED is indistinguishable from one that ran clean — there is no error/status
// concept in the evals display model at all.
//
// Terminal artifact the operator sees: the Evals page shows totals (pass-rate %) and recent runs. A
// run where the eval engine crashed / was unreachable is recorded and normalized purely from
// total/passed/score. RawEvalRun and EvalRunView carry NO status/error field, so:
//   - an errored run with total:0 silently contributes 0 cases (invisible in pass-rate),
//   - an errored run the harness stamped passed==total shows as a spotless green pass.
// The operator cannot tell "eval infra failed" from "everything passed".
//
// This RED test proves the model cannot represent an errored run. Un-skip to watch it FAIL.
test('ADVERSARIAL G-ADV-OBS-4: an errored eval run is surfaced as errored, not a silent pass', () => {
  // A run the engine could not complete — the harness recorded an error but no real cases.
  const view = normalizeEvals({
    runs: [
      {
        id: 'run_err',
        engine: 'ragas',
        score: 0,
        total: 0,
        passed: 0,
        startedAt: '2026-07-01T10:00:00Z',
        // there is nowhere in RawEvalRun to say "this run errored" — that is the defect.
        error: 'eval engine unreachable',
      } as unknown as Parameters<typeof normalizeEvals>[0] extends { runs?: (infer R)[] | null }
        ? R
        : never,
    ],
    goldenCases: [],
  });

  const run = view.recentRuns[0];
  // The normalized run MUST expose that it errored so the page can flag it instead of showing a
  // clean row. The view has no such field → this access is undefined → the run reads as a normal
  // (0/0, 0%) run rather than an error.
  const status = (run as unknown as { status?: string; error?: string }).status
    ?? (run as unknown as { error?: string }).error;
  assert.ok(
    status,
    'errored eval run has no error/status on the view — surfaced as a silent 0/0 run, not an error',
  );
});
