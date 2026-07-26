import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEditPlan, heuristicEditPlan } from '@/lib/app-edit';
import { validateAppSpec, type AppSpec } from '@/lib/app-model';

// The plain-language ITERATE loop: a non-technical author changes a governed workflow by describing
// the change. These assert the TERMINAL artifact — the resulting spec — and the honesty rules (an
// instruction we can't map comes back as a gap; nothing is silently dropped or fabricated).

function app(over: Partial<AppSpec> = {}): AppSpec {
  return {
    id: 'app1', orgId: 'org_bharat', ownerId: 'ops@bank.test', title: 'Claim note',
    summary: '', visibility: 'private', published: false, trigger: { kind: 'on-demand' },
    steps: [
      { id: 's1', label: 'Draft the note', kind: 'agent', agentId: 'ag1' },
      { id: 's2', label: 'Send it', kind: 'output', sink: 'console' },
    ],
    edges: [{ from: 's1', to: 's2' }],
    ...over,
  };
}
const run = (instruction: string, spec = app()) => applyEditPlan(spec, heuristicEditPlan(instruction, spec));

test('"also post it to Slack" switches the delivery channel and says so', () => {
  const r = run('also post it to Slack');
  const out = r.spec.steps.find((s) => s.kind === 'output') as { sink: string };
  assert.equal(out.sink, 'slack');
  assert.match(r.changes.join(' '), /now goes to slack instead of console/);
  assert.equal(validateAppSpec(r.spec).ok, true);
});

test('a delivery channel with no recipient reports an honest gap (never fabricated)', () => {
  const r = run('email the result');
  const out = r.spec.steps.find((s) => s.kind === 'output') as { sink: string };
  assert.equal(out.sink, 'email');
  assert.ok(r.gaps.length > 0, 'the missing recipient is reported');
});

test('"add an approval before it sends" inserts a human step BEFORE the output and rewires', () => {
  const r = run('add an approval before it sends');
  const kinds = r.spec.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['agent', 'human', 'output'], 'approval sits between the agent and the output');
  const human = r.spec.steps.find((s) => s.kind === 'human')!;
  // the agent now feeds the approval, and the approval feeds the output — no dangling edge
  assert.ok(r.spec.edges.some((e) => e.from === 's1' && e.to === human.id));
  assert.ok(r.spec.edges.some((e) => e.from === human.id && e.to === 's2'));
  assert.ok(!r.spec.edges.some((e) => e.from === 's1' && e.to === 's2'), 'the old direct edge is gone');
  assert.equal(validateAppSpec(r.spec).ok, true, validateAppSpec(r.spec).errors.join('; '));
});

test('"no longer require approval" removes it and reconnects the graph', () => {
  const withApproval = run('add an approval before it sends').spec;
  const r = applyEditPlan(withApproval, heuristicEditPlan('no longer require approval', withApproval));
  assert.deepEqual(r.spec.steps.map((s) => s.kind), ['agent', 'output']);
  assert.ok(r.spec.edges.some((e) => e.from === 's1' && e.to === 's2'), 'reconnected around the removed step');
  assert.equal(validateAppSpec(r.spec).ok, true);
  assert.match(r.changes.join(' '), /Removed the approval/);
});

test('REMOVE phrasing wins over the ADD keyword in the same sentence', () => {
  const withApproval = run('add an approval before it sends').spec;
  const r = applyEditPlan(withApproval, heuristicEditPlan('we no longer need to add an approval', withApproval));
  assert.deepEqual(r.spec.steps.map((s) => s.kind), ['agent', 'output']);
});

test('an op that cannot apply is reported as a gap, not silently dropped', () => {
  const r = run('remove the approval'); // this app has none
  assert.deepEqual(r.changes, []);
  assert.match(r.gaps.join(' '), /no approval step to remove/);
  // and a second approval is refused rather than duplicated
  const once = run('add an approval before it sends').spec;
  const twice = applyEditPlan(once, heuristicEditPlan('add an approval before it sends', once));
  assert.equal(twice.spec.steps.filter((s) => s.kind === 'human').length, 1);
  assert.match(twice.gaps.join(' '), /already pauses for a person/);
});

test('an uninterpretable instruction is surfaced honestly and changes nothing', () => {
  const spec = app();
  const r = applyEditPlan(spec, heuristicEditPlan('make it 20% more strategic', spec));
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.spec.steps, spec.steps, 'the spec is untouched');
  assert.match(r.gaps.join(' '), /Could not turn/);
});

test('"rename it to X" retitles without touching the graph', () => {
  const r = run('rename it to Claims triage note');
  assert.equal(r.spec.title, 'Claims triage note');
  assert.deepEqual(r.spec.steps.map((s) => s.id), ['s1', 's2']);
});

test('applyEditPlan never mutates the input spec', () => {
  const spec = app();
  const before = JSON.stringify(spec);
  run('also post it to Slack', spec);
  assert.equal(JSON.stringify(spec), before);
});
