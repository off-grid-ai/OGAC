// ─── ADVERSARIAL break-test: HITL resume re-executes a step on spec-drift (G-ADV-BUILD-3) ─────────
//
// RED against wave2 HEAD, `.skip`-gated (see docs/adversarial/builder.md). Encodes the CORRECT
// behaviour: resuming a paused run must execute each remaining step AT MOST ONCE, even when the app
// spec was edited (a step added) while the run sat paused at a human step.
//
// THE BREAK (proven, terminal-artifact = the number of times the side-effecting sink fires):
//   • Apps are MUTABLE (PATCH /api/v1/admin/apps/[id] full-replaces steps/edges). The review route
//     (apps/runs/[id]/review) rebuilds the paused AppRunState from the OLD persisted run row, then
//     drives driveRunnableSteps over the CURRENT (possibly edited) app spec (getApp at resume time).
//   • driveRunnableSteps (app-run.ts:820) schedules over spec.steps but tracks completion in
//     state.steps. applyStepResult (app-run-plan.ts:202) matches by step id — so a step that exists
//     in the edited spec but NOT in the old run row's state is NEVER recorded 'done'. nextRunnableSteps
//     therefore returns it on EVERY iteration of the bounded loop, so a side-effecting output sink
//     (email/report/whatsapp) FIRES ONCE PER ITERATION — up to maxIterations (= steps.length + 1).
//   • Terminal artifact: N duplicate emails/reports for a single approve. Proven: 6 sends for a
//     4-step edited spec (deps.sendEmail called 6×, run steps show s4:done ×5).
//
// Root cause: no reconciliation of state.steps against spec.steps on resume; the scheduler trusts the
// two to be in sync, and a mutable app breaks that assumption.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '@/lib/app-model';
import { runApp, type AppRunDeps, type StepResult } from '@/lib/app-run';
import { rebuildAppRunState, type AppRunState } from '@/lib/app-run-plan';
import { resumeAppRun } from '@/lib/app-run-resume';

const SKIP = 'ADVERSARIAL: RED — G-ADV-BUILD-3 (resume re-runs a step on spec-drift) open; see docs/adversarial/builder.md';

// Count side-effecting sink calls; capture the last persisted AppRunState (the row the route reloads).
function instrumentedDeps(counters: { sends: number; lastState: AppRunState | null }): AppRunDeps {
  return {
    async runAgent(agentId) {
      return { id: `run_${agentId}`, answer: 'decided', status: 'done', citations: [] };
    },
    async listDomains() { return []; },
    async getConnector() { return null; },
    async queryDomain() { return { result: null, detail: '' }; },
    async runGuardrail() { return { blocked: false, detail: 'ok' }; },
    async scanPii() { return { hits: false, entities: [], engine: 'regex' }; },
    async persist(state) { counters.lastState = state; },
    async materializeAgent() { return 'ag_mat'; },
    async renderReport(view, format) {
      return {
        filename: `r-${view.id}.${format}`, contentType: 'application/pdf', bytes: new Uint8Array(),
        manifest: { algorithm: 'ed25519', sha256: 'a'.repeat(64), signature: 'sig' },
      };
    },
    async sendEmail() {
      counters.sends += 1;
      return { ok: true, configured: true, reason: 'sent' };
    },
  };
}

function hitlSpec(): AppSpec {
  return {
    id: 'app_drift', orgId: 'default', ownerId: 'u1', title: 'HITL', summary: '',
    visibility: 'private', published: false, trigger: { kind: 'on-demand' },
    steps: [
      { id: 's1', label: 'decide', kind: 'agent', agentId: 'ag1' },
      { id: 's2', label: 'review', kind: 'human' },
      { id: 's3', label: 'send', kind: 'output', sink: 'email', config: { to: 'x@y.com' } },
    ],
    edges: [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }],
  };
}

test('ADVERSARIAL G-ADV-BUILD-3: resume over an EDITED spec must run each added step at most once (it currently re-fires the sink)', { skip: SKIP }, async () => {
  const counters = { sends: 0, lastState: null as AppRunState | null };
  const deps = instrumentedDeps(counters);

  // 1. Run the ORIGINAL 3-step spec inline → it pauses at the human step, persisting a row with
  //    s1:done, s2:awaiting_human, s3:queued (the real production persisted shape).
  const orig = hitlSpec();
  await runApp(orig, {}, { orgId: 'default', runId: 'rdrift' }, deps);
  const persisted = counters.lastState!;
  const rowSteps = persisted.steps.map((s) => ({
    id: s.id, kind: s.kind, label: s.label, status: s.status, outcome: s.output,
  }));
  const paused = rebuildAppRunState('rdrift', 'app_drift', persisted.status, rowSteps);

  // 2. Operator EDITS the app while it is paused: appends s4 (a second email sink). Resume re-loads
  //    the CURRENT (edited) spec but the OLD run row (which has no s4).
  const edited: AppSpec = {
    ...orig,
    steps: [...orig.steps, { id: 's4', label: 'send2', kind: 'output', sink: 'email', config: { to: 'z@y.com' } }],
    edges: [...orig.edges, { from: 's3', to: 's4' }],
  };

  // 3. Approve. The added step s4 must fire its sink EXACTLY ONCE — not once per scheduler iteration.
  counters.sends = 0;
  const out = await resumeAppRun(edited, paused, {}, { decision: 'approve' }, { orgId: 'default', runId: 'rdrift' }, deps);

  // Terminal artifact: the email sink must have fired exactly once (s3 already sent in the paused row;
  // only the newly-added s4 should send now). Current code fires s4 up to maxIterations times.
  assert.equal(counters.sends, 1, `the added output step must send exactly once, sent ${counters.sends} times`);
  // And the run's step list must not contain the same step id resolved 'done' more than once.
  const s4Done = out.steps.filter((r: StepResult) => r.stepId === 's4' && r.status === 'done').length;
  assert.equal(s4Done, 1, `step s4 must resolve 'done' exactly once, resolved ${s4Done} times`);
});
