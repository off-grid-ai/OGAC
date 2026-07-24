import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '../src/lib/app-model.ts';
import {
  applyStepResult,
  evaluateGuard,
  initState,
  planAdvance,
} from '../src/lib/app-run-plan.ts';

// A diamond: a decision agent (d) fans out to two guarded branches (cashless / surveyor) that both
// merge into an output step (out). This is the canonical "if the claim is cashless do A, else B"
// workflow the plain-language builder must produce — and the runner must take exactly ONE branch.
function diamond(): AppSpec {
  return {
    id: 'app_fnol',
    orgId: 'org_bharat',
    ownerId: 'u',
    title: 'Motor claim triage',
    summary: '',
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps: [
      { id: 'd', label: 'Decide cashless vs surveyor', kind: 'agent', agentId: 'triage' },
      { id: 'cashless', label: 'Auto-approve cashless', kind: 'agent', agentId: 'approve' },
      { id: 'surveyor', label: 'Assign a surveyor', kind: 'agent', agentId: 'assign' },
      { id: 'out', label: 'Notify', kind: 'output', sink: 'console' },
    ],
    edges: [
      { from: 'd', to: 'cashless', when: 'd contains "cashless"' },
      { from: 'd', to: 'surveyor', when: 'd contains "surveyor"' },
      { from: 'cashless', to: 'out' },
      { from: 'surveyor', to: 'out' },
    ],
  };
}

test('evaluateGuard: absent/empty guard is an unconditional edge (backward-compatible)', () => {
  assert.equal(evaluateGuard(undefined, {}), true);
  assert.equal(evaluateGuard('', { d: 'anything' }), true);
  assert.equal(evaluateGuard('   ', {}), true);
});

test('evaluateGuard: contains / == / != evaluate case-insensitively against the step output', () => {
  const out = { d: 'Decision: CASHLESS settlement approved' };
  assert.equal(evaluateGuard('d contains "cashless"', out), true);
  assert.equal(evaluateGuard('d contains "surveyor"', out), false);
  assert.equal(evaluateGuard('d == "cashless settlement"', out), false); // == is whole-value
  assert.equal(evaluateGuard('d != "surveyor"', out), true);
});

test('evaluateGuard: an unparseable guard fails OPEN (true) — never a silent dropped path', () => {
  assert.equal(evaluateGuard('this is not a guard expression', { d: 'x' }), true);
  assert.equal(evaluateGuard('d ~= 5', {}), true);
});

test('planAdvance: entry step is the only thing runnable at the start', () => {
  const spec = diamond();
  const st = initState(spec, 'r1');
  const { runnable, skip } = planAdvance(spec, st);
  assert.deepEqual(runnable.map((s) => s.id), ['d']);
  assert.deepEqual(skip.map((s) => s.id), []);
});

test('planAdvance: after a CASHLESS decision, the cashless branch runs and the surveyor branch SKIPS', () => {
  const spec = diamond();
  let st = initState(spec, 'r2');
  st = applyStepResult(st, 'd', { status: 'done', output: 'Decision: cashless — auto-approve' });
  const { runnable, skip } = planAdvance(spec, st);
  assert.deepEqual(runnable.map((s) => s.id), ['cashless'], 'the matched branch runs');
  assert.deepEqual(skip.map((s) => s.id), ['surveyor'], 'the other branch is skipped');
});

test('planAdvance: the merge step runs once the taken branch is done and the skipped one settled', () => {
  const spec = diamond();
  let st = initState(spec, 'r3');
  st = applyStepResult(st, 'd', { status: 'done', output: 'cashless' });
  st = applyStepResult(st, 'surveyor', { status: 'skipped' });
  st = applyStepResult(st, 'cashless', { status: 'done', output: 'approved' });
  const { runnable, skip } = planAdvance(spec, st);
  assert.deepEqual(runnable.map((s) => s.id), ['out'], 'merge runs — a skipped predecessor still unblocks it');
  assert.deepEqual(skip.map((s) => s.id), []);
});

test('planAdvance: a merge step whose BOTH branches skipped is itself skipped (dead path propagates)', () => {
  const spec: AppSpec = {
    ...diamond(),
    edges: [
      { from: 'd', to: 'cashless', when: 'd contains "cashless"' },
      { from: 'd', to: 'surveyor', when: 'd contains "surveyor"' },
      // out is reachable ONLY through the two guarded branches
      { from: 'cashless', to: 'out' },
      { from: 'surveyor', to: 'out' },
    ],
  };
  let st = initState(spec, 'r4');
  // A decision matching NEITHER branch: both branches skip, then the merge has no live path.
  st = applyStepResult(st, 'd', { status: 'done', output: 'escalate to fraud team' });
  let adv = planAdvance(spec, st);
  assert.deepEqual(adv.skip.map((s) => s.id).sort(), ['cashless', 'surveyor']);
  for (const s of adv.skip) st = applyStepResult(st, s.id, { status: 'skipped' });
  adv = planAdvance(spec, st);
  assert.deepEqual(adv.skip.map((s) => s.id), ['out'], 'the merge skips — no live path reached it');
  assert.deepEqual(adv.runnable.map((s) => s.id), []);
});

test('planAdvance: an unguarded graph behaves exactly as before (no step ever skips)', () => {
  const spec: AppSpec = {
    ...diamond(),
    edges: [
      { from: 'd', to: 'cashless' },
      { from: 'd', to: 'surveyor' },
      { from: 'cashless', to: 'out' },
      { from: 'surveyor', to: 'out' },
    ],
  };
  let st = initState(spec, 'r5');
  st = applyStepResult(st, 'd', { status: 'done', output: 'anything' });
  const { runnable, skip } = planAdvance(spec, st);
  assert.deepEqual(runnable.map((s) => s.id).sort(), ['cashless', 'surveyor'], 'both run when unguarded');
  assert.deepEqual(skip, []);
});
