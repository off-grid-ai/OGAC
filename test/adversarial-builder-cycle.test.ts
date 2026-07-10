// ─── ADVERSARIAL break-test: the builder's CYCLE gap (G-ADV-BUILD-1 / -2) ─────────────────────────
//
// These tests are RED against wave2 HEAD — they encode the CORRECT behaviour the builder should have
// but does NOT. They are `.skip`-gated (reason cites the GAPS id) so the shared suite stays green for
// other agents, while documenting the confirmed break with a runnable repro. Remove the skip when the
// gap is fixed (validateAppSpec rejects reachable cycles; the executor never returns a terminal
// 'running'). See docs/adversarial/builder.md.
//
// THE BREAK (proven, terminal-artifact asserted):
//   • validateAppSpec (app-model.ts:129) checks REACHABILITY from the single entry but NOT ACYCLICITY.
//     The ONLY cycle guard in the codebase is app-builder.addEdge (app-builder.ts:90 wouldCreateStepCycle),
//     which is the CANVAS EDITOR path — NOT the validator that apps-store.createApp/updateApp and the
//     executor trust. So a cyclic AppSpec that keeps a single entry + all-reachable (e.g. via a direct
//     POST/PATCH to /api/v1/admin/apps[/id], the NL compose path, or workflowToAppSpec) SAVES clean (201).
//   • runApp then WEDGES: a step in the cycle can never have all predecessors 'done' (each blocks the
//     other / itself), so nextRunnableSteps never returns it. driveRunnableSteps' bounded loop exits with
//     runnable.length === 0, and finalize() reports the derived aggregate 'running' — a TERMINAL outcome
//     that is neither done nor error. The persisted app_runs row is status:'running' with the cycle steps
//     stuck 'queued' FOREVER. The operator sees a run that never completes and never fails honestly.
//   • app-compile.ts has NO cycle/DAG check either — so "Compile" does not catch it before save.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateAppSpec, type AppSpec } from '@/lib/app-model';
import { runApp, type AppRunDeps } from '@/lib/app-run';

const SKIP = 'ADVERSARIAL: RED — G-ADV-BUILD-1 (validator accepts cycles) open; see docs/adversarial/builder.md';

function base(steps: AppSpec['steps'], edges: AppSpec['edges']): AppSpec {
  return {
    id: 'app_adv', orgId: 'default', ownerId: 'u1', title: 'Adversarial', summary: '',
    visibility: 'private', published: false, trigger: { kind: 'on-demand' }, steps, edges,
  };
}

// Fake ONLY the external boundaries (runAgent, connector/guardrail/pii/email/report) — the scheduler,
// reducer, and run loop are the REAL logic under test. Every agent step "succeeds" so the ONLY thing
// that can stop the run reaching 'done' is the scheduling wedge itself.
function fakeDeps(): AppRunDeps {
  return {
    async runAgent(agentId) {
      return { id: `run_${agentId}`, answer: `ans ${agentId}`, status: 'done', citations: [] };
    },
    async listDomains() { return []; },
    async getConnector() { return null; },
    async queryDomain() { return { result: null, detail: '' }; },
    async runGuardrail() { return { blocked: false, detail: 'ok' }; },
    async scanPii() { return { hits: false, entities: [], engine: 'regex' }; },
    async persist() {},
    async materializeAgent() { return 'ag_mat'; },
    async renderReport(view, format) {
      return {
        filename: `r-${view.id}.${format}`, contentType: 'application/pdf', bytes: new Uint8Array(),
        manifest: { algorithm: 'ed25519', sha256: 'a'.repeat(64), signature: 'sig' },
      };
    },
    async sendEmail() { return { ok: true, configured: true, reason: 'ok' }; },
  };
}

// A reachable 2-cycle: entry e → a, a → b, b → a. Single entry (e has no incoming), every step
// reachable from e — so it PASSES validateAppSpec's reachability rule while being cyclic.
const REACHABLE_CYCLE = base(
  [
    { id: 'e', label: 'Entry', kind: 'agent', agentId: 'ag_e' },
    { id: 'a', label: 'A', kind: 'agent', agentId: 'ag_a' },
    { id: 'b', label: 'B', kind: 'agent', agentId: 'ag_b' },
  ],
  [
    { from: 'e', to: 'a' },
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' }, // back-edge → cycle a↔b
  ],
);

// A reachable self-loop: entry e → a, a → a. The minimal cycle.
const SELF_LOOP = base(
  [
    { id: 'e', label: 'Entry', kind: 'agent', agentId: 'ag_e' },
    { id: 'a', label: 'A', kind: 'agent', agentId: 'ag_a' },
  ],
  [
    { from: 'e', to: 'a' },
    { from: 'a', to: 'a' }, // self-loop
  ],
);

test('ADVERSARIAL G-ADV-BUILD-1: validateAppSpec must REJECT a reachable cycle (it currently accepts it)', { skip: SKIP }, () => {
  const r = validateAppSpec(REACHABLE_CYCLE);
  // CORRECT behaviour: a cyclic graph is not a runnable workflow — the validator (the single authority
  // the store + executor trust) must reject it, not just the canvas editor's addEdge.
  assert.equal(r.ok, false, 'a reachable cycle should fail validation');
  assert.match(r.errors.join(' '), /cycle|acyclic|loop/i);
});

test('ADVERSARIAL G-ADV-BUILD-1: validateAppSpec must REJECT a reachable self-loop', { skip: SKIP }, () => {
  const r = validateAppSpec(SELF_LOOP);
  assert.equal(r.ok, false, 'a reachable self-loop should fail validation');
  assert.match(r.errors.join(' '), /cycle|acyclic|loop|self/i);
});

test('ADVERSARIAL G-ADV-BUILD-2: a cyclic app must NOT wedge into a terminal "running" — it never completes or errors', { skip: SKIP }, async () => {
  // Terminal artifact: the AppRunOutcome the run route returns and persists. A cyclic spec that slips
  // past validation must terminate in an HONEST terminal state (done or error), never the derived
  // 'running' that means "the loop gave up but nothing told the operator".
  const out = await runApp(REACHABLE_CYCLE, {}, { orgId: 'default', runId: 'radv1' }, fakeDeps());
  assert.notEqual(
    out.status,
    'running',
    'a finished run must not report the non-terminal "running" — it wedged (only the entry ran, a/b stuck queued)',
  );
  // The cycle steps a + b never ran — that is the wedge. Assert the run at least surfaces error, not
  // a silent partial "running".
  assert.ok(out.status === 'error' || out.status === 'done', `expected a terminal status, got '${out.status}'`);
});

test('ADVERSARIAL G-ADV-BUILD-2: a cyclic self-loop app must NOT wedge into terminal "running"', { skip: SKIP }, async () => {
  const out = await runApp(SELF_LOOP, {}, { orgId: 'default', runId: 'radv2' }, fakeDeps());
  assert.notEqual(out.status, 'running', 'a finished self-loop run must not report non-terminal "running"');
});
