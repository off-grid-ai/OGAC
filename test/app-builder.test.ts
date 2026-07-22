import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type AppSpec, validateAppSpec } from '../src/lib/app-model.ts';
import {
  addStep,
  blankStep,
  describeStepBinding,
  mintStepId,
  moveStep,
  rebindAgent,
  rebindDomain,
  rechainEdges,
  relabelStep,
  removeStep,
  setAgentPrompt,
  setOutputConfigField,
  setOutputSink,
  setTitle,
  setTrigger,
  setVisibility,
  toggleGrounding,
} from '../src/lib/app-builder.ts';

// PURE unit tests for the Phase 3A builder edit reducers — no DB, no network. They pin that every
// structural edit (add/remove/reorder) keeps the spec a VALID linear one-entry graph (rechained
// edges), that binding edits only touch the intended step/kind, and that the skeleton-line presenter
// is honest about unbound steps.

// A 3-step reimbursement-shaped app (connector → agent → output), the canonical compiled skeleton.
function threeStepApp(over: Partial<AppSpec> = {}): AppSpec {
  return {
    id: 'app_1',
    orgId: 'default',
    ownerId: 'u@x',
    title: 'Reimbursement approval',
    summary: 'read invoices, decide, output',
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps: [
      { id: 's1', label: 'Read invoices', kind: 'connector-query', domain: 'dom_invoices', op: 'read' },
      { id: 's2', label: 'Decision', kind: 'agent', inlineAgent: { systemPrompt: 'decide', grounded: true } },
      { id: 's3', label: 'Output', kind: 'output', sink: 'console' },
    ],
    edges: [
      { from: 's1', to: 's2' },
      { from: 's2', to: 's3' },
    ],
    ...over,
  };
}

test('rechainEdges builds a linear chain and handles 0/1-step specs', () => {
  assert.deepEqual(rechainEdges([]), []);
  assert.deepEqual(rechainEdges([{ id: 'a', label: 'x', kind: 'output', sink: 'console' }]), []);
  const chain = rechainEdges([
    { id: 'a', label: '', kind: 'human' },
    { id: 'b', label: '', kind: 'human' },
    { id: 'c', label: '', kind: 'human' },
  ]);
  assert.deepEqual(chain, [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ]);
});

test('mintStepId never collides with existing ids', () => {
  const steps = [
    { id: 's1', label: '', kind: 'human' as const },
    { id: 's2', label: '', kind: 'human' as const },
  ];
  const id = mintStepId(steps);
  assert.ok(!steps.some((s) => s.id === id));
});

test('blankStep produces the minimal executable shape per kind', () => {
  assert.equal(blankStep('agent', 'x').kind, 'agent');
  const cq = blankStep('connector-query', 'x');
  assert.equal(cq.kind, 'connector-query');
  assert.equal((cq as { domain: string }).domain, ''); // unbound, surfaced not fabricated
  assert.equal((blankStep('output', 'x') as { sink: string }).sink, 'console');
});

test('addStep appends and keeps a valid one-entry graph', () => {
  const next = addStep(threeStepApp(), 'human');
  assert.equal(next.steps.length, 4);
  assert.ok(validateAppSpec(next).ok, 'appended spec must stay valid');
  // The new step is last and chained after the previous tail.
  const tail = next.steps[next.steps.length - 1];
  assert.equal(next.edges[next.edges.length - 1].to, tail.id);
});

test('addStep inserts before an index and rechains', () => {
  const next = addStep(threeStepApp(), 'guardrail', 1);
  assert.equal(next.steps[1].kind, 'guardrail');
  assert.ok(validateAppSpec(next).ok);
  // Fully linear: N-1 edges for N steps.
  assert.equal(next.edges.length, next.steps.length - 1);
});

test('removeStep drops a step, rechains, and refuses to empty the app', () => {
  const next = removeStep(threeStepApp(), 's2');
  assert.equal(next.steps.length, 2);
  assert.ok(!next.steps.some((s) => s.id === 's2'));
  assert.ok(validateAppSpec(next).ok);
  // Removing down to the last step is a no-op.
  const one = threeStepApp({ steps: [threeStepApp().steps[0]], edges: [] });
  assert.equal(removeStep(one, 's1'), one);
});

test('moveStep reorders and rechains; out-of-range is a no-op', () => {
  const app = threeStepApp();
  const moved = moveStep(app, 's3', -1); // s3 up one → s1,s3,s2
  assert.deepEqual(moved.steps.map((s) => s.id), ['s1', 's3', 's2']);
  assert.ok(validateAppSpec(moved).ok);
  assert.deepEqual(moved.edges, [
    { from: 's1', to: 's3' },
    { from: 's3', to: 's2' },
  ]);
  assert.equal(moveStep(app, 's1', -1), app); // already first → no-op
  assert.equal(moveStep(app, 's3', 1), app); // already last → no-op
});

test('relabelStep changes only the target label', () => {
  const next = relabelStep(threeStepApp(), 's2', 'Eligibility decision');
  assert.equal(next.steps[1].label, 'Eligibility decision');
  assert.equal(next.steps[0].label, 'Read invoices');
});

test('rebindDomain only affects connector-query steps', () => {
  const next = rebindDomain(threeStepApp(), 's1', 'dom_receipts');
  assert.equal((next.steps[0] as { domain: string }).domain, 'dom_receipts');
  // No-op on an agent step.
  const same = rebindDomain(threeStepApp(), 's2', 'dom_receipts');
  assert.deepEqual(same.steps[1], threeStepApp().steps[1]);
});

test('rebindAgent switches inline↔referenced', () => {
  const ref = rebindAgent(threeStepApp(), 's2', 'agent_x');
  const s = ref.steps[1] as { agentId?: string; inlineAgent?: unknown };
  assert.equal(s.agentId, 'agent_x');
  assert.equal(s.inlineAgent, undefined);
  // Back to inline (empty agentId) keeps a valid agent step.
  const back = rebindAgent(ref, 's2', '');
  const b = back.steps[1] as { agentId?: string; inlineAgent?: { systemPrompt: string } };
  assert.equal(b.agentId, undefined);
  assert.ok(b.inlineAgent);
});

test('setAgentPrompt + toggleGrounding edit the inline agent', () => {
  const p = setAgentPrompt(threeStepApp(), 's2', 'Decide eligibility from quota vs spend.');
  const s = p.steps[1] as { inlineAgent?: { systemPrompt: string; grounded?: boolean } };
  assert.equal(s.inlineAgent?.systemPrompt, 'Decide eligibility from quota vs spend.');
  const g = toggleGrounding(p, 's2', false);
  assert.equal((g.steps[1] as { inlineAgent?: { grounded?: boolean } }).inlineAgent?.grounded, false);
});

test('setOutputSink + setTrigger + metadata edits', () => {
  const o = setOutputSink(threeStepApp(), 's3', 'report');
  assert.equal((o.steps[2] as { sink: string }).sink, 'report');
  const t = setTrigger(threeStepApp(), 'webhook');
  assert.equal(t.trigger.kind, 'webhook');
  assert.equal(setTitle(threeStepApp(), 'New title').title, 'New title');
  assert.equal(setVisibility(threeStepApp(), 'org').visibility, 'org');
});

test('setOutputConfigField sets a sink config field and clears it on blank', () => {
  const withUrl = setOutputConfigField(threeStepApp(), 's3', 'url', 'https://hooks.corp/in');
  assert.equal((withUrl.steps[2] as { config?: Record<string, unknown> }).config?.url, 'https://hooks.corp/in');
  // A blank value CLEARS the key (honest degrade — no empty-string destination left behind).
  const cleared = setOutputConfigField(withUrl, 's3', 'url', '  ');
  assert.equal((cleared.steps[2] as { config?: Record<string, unknown> }).config?.url, undefined);
  // Non-output steps are untouched.
  const noop = setOutputConfigField(threeStepApp(), 's1', 'url', 'x');
  assert.equal((noop.steps[0] as { config?: Record<string, unknown> }).config, undefined);
});

test('describeStepBinding is honest about unbound steps', () => {
  const unbound = describeStepBinding({ id: 's', label: '', kind: 'connector-query', domain: '' });
  assert.match(unbound, /unbound/);
  const bound = describeStepBinding(
    { id: 's', label: '', kind: 'connector-query', domain: 'dom_invoices', op: 'read' },
    { domains: [{ id: 'dom_invoices', label: 'Invoices' }] },
  );
  assert.match(bound, /Invoices/);
  const needsPrompt = describeStepBinding({ id: 's', label: '', kind: 'agent', inlineAgent: { systemPrompt: '' } });
  assert.match(needsPrompt, /needs instructions/);
});
