import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type AppSpec,
  type LegacyTemplate,
  validateAppSpec,
  workflowToAppSpec,
  isSimpleAgent,
  filterSingleStepApps,
  appNeedsDataSource,
  unboundConnectorSteps,
} from '../src/lib/app-model.ts';

// PURE unit tests for the unified App model (Builder Epic #108, Phase 1A) — no DB, no network.
// They pin the validation rules (valid/invalid graphs, unique ids, dangling edges, single entry,
// reachability) and the studioTemplate → AppSpec back-compat shim (single-agent → 1-step spec,
// round-trip stability, "an agent is the simplest app").

// A minimal single-agent app — the simplest valid app.
function simpleAgentApp(over: Partial<AppSpec> = {}): AppSpec {
  return {
    id: 'app_1',
    orgId: 'default',
    ownerId: 'u@x',
    title: 'Support bot',
    summary: '',
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps: [{ id: 's1', label: 'Answer', kind: 'agent', agentId: 'agent_x' }],
    edges: [],
    ...over,
  };
}

// ─── validateAppSpec — valid cases ─────────────────────────────────────────────
test('a single agent step is the simplest valid app', () => {
  const spec = simpleAgentApp();
  const r = validateAppSpec(spec);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(isSimpleAgent(spec), true);
});

test('a valid linear multi-step graph passes', () => {
  const spec = simpleAgentApp({
    steps: [
      { id: 'a', label: 'Fetch', kind: 'connector-query', domain: 'accounts' },
      { id: 'b', label: 'Answer', kind: 'agent', agentId: 'agent_x' },
      { id: 'c', label: 'Send', kind: 'output', sink: 'console' },
    ],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ],
  });
  const r = validateAppSpec(spec);
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('a branching graph with one entry reaching all steps passes', () => {
  const spec = simpleAgentApp({
    steps: [
      { id: 'a', label: 'Start', kind: 'agent', agentId: 'x' },
      { id: 'b', label: 'Path B', kind: 'guardrail' },
      { id: 'c', label: 'Path C', kind: 'human' },
    ],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
    ],
  });
  assert.equal(validateAppSpec(spec).ok, true);
});

// ─── validateAppSpec — invalid cases ───────────────────────────────────────────
test('an empty app (no steps) is invalid', () => {
  const r = validateAppSpec(simpleAgentApp({ steps: [] }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /at least one step/);
});

test('duplicate step ids are rejected', () => {
  const r = validateAppSpec(
    simpleAgentApp({
      steps: [
        { id: 'dup', label: 'A', kind: 'agent', agentId: 'x' },
        { id: 'dup', label: 'B', kind: 'output', sink: 'console' },
      ],
      edges: [{ from: 'dup', to: 'dup' }],
    }),
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /duplicate step id: dup/);
});

test('a dangling edge (to a non-existent step) is rejected', () => {
  const r = validateAppSpec(
    simpleAgentApp({
      steps: [{ id: 'a', label: 'A', kind: 'agent', agentId: 'x' }],
      edges: [{ from: 'a', to: 'ghost' }],
    }),
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /unknown step \(to\): ghost/);
});

test('multiple entry steps are rejected', () => {
  const r = validateAppSpec(
    simpleAgentApp({
      steps: [
        { id: 'a', label: 'A', kind: 'agent', agentId: 'x' },
        { id: 'b', label: 'B', kind: 'agent', agentId: 'y' },
      ],
      edges: [], // both are entries → ambiguous start
    }),
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /multiple entry steps/);
});

test('an unreachable (orphan) step is rejected', () => {
  const r = validateAppSpec(
    simpleAgentApp({
      steps: [
        { id: 'a', label: 'A', kind: 'agent', agentId: 'x' },
        { id: 'b', label: 'B', kind: 'output', sink: 'console' },
        { id: 'orphan', label: 'C', kind: 'guardrail' },
      ],
      edges: [{ from: 'a', to: 'b' }], // 'orphan' has an incoming edge? no → 2 entries. give it one:
    }),
  );
  // 'orphan' has no incoming edge → treated as a second entry (multiple entries error). Confirm invalid.
  assert.equal(r.ok, false);
});

test('a self-cycle among later steps that is unreachable from the single entry fails', () => {
  const r = validateAppSpec(
    simpleAgentApp({
      steps: [
        { id: 'a', label: 'A', kind: 'agent', agentId: 'x' }, // single entry (no incoming)
        { id: 'b', label: 'B', kind: 'output', sink: 'console' },
        { id: 'c', label: 'C', kind: 'guardrail' },
      ],
      // 'a' is the only entry but reaches nothing; b↔c form an island each with an incoming edge,
      // so they are not entries yet are unreachable from 'a'.
      edges: [
        { from: 'b', to: 'c' },
        { from: 'c', to: 'b' },
      ],
    }),
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /unreachable/);
});

test('an agent step with neither agentId nor inlineAgent is invalid', () => {
  const r = validateAppSpec(
    simpleAgentApp({ steps: [{ id: 's1', label: 'x', kind: 'agent' }] }),
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /needs agentId or inlineAgent/);
});

test('a connector-query step without a domain binding is invalid', () => {
  const r = validateAppSpec(
    simpleAgentApp({
      steps: [{ id: 's1', label: 'x', kind: 'connector-query', domain: '' }],
    }),
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /needs a domain binding/);
});

test('a bad trigger kind is rejected', () => {
  const r = validateAppSpec(
    simpleAgentApp({ trigger: { kind: 'telepathy' as never } }),
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /trigger.kind/);
});

// ─── workflowToAppSpec — the back-compat shim ──────────────────────────────────
test('a single agent:<id> template maps to a 1-step agent app', () => {
  const tpl: LegacyTemplate = {
    id: 'tpl_1',
    orgId: 'acme',
    ownerId: 'u@x',
    title: 'Refund helper',
    summary: 'helps with refunds',
    prompt: 'You help with refunds.',
    visibility: 'org',
    slug: 'refund-helper',
    published: true,
    workflow: {
      title: 'Refund helper',
      summary: 'helps with refunds',
      nodeIds: ['agent:agent_42', 'data:col_1'],
      edges: [],
    },
  };
  const spec = workflowToAppSpec(tpl);
  assert.equal(spec.steps.length, 1, 'data: node must not become a step');
  assert.equal(spec.steps[0].kind, 'agent');
  assert.equal((spec.steps[0] as { agentId?: string }).agentId, 'agent_42');
  assert.equal(spec.orgId, 'acme');
  assert.equal(spec.visibility, 'org');
  assert.equal(spec.slug, 'refund-helper');
  assert.equal(spec.published, true);
  assert.equal(isSimpleAgent(spec), true, 'an agent is the simplest app');
  assert.equal(validateAppSpec(spec).ok, true, 'the shim output must validate');
});

test('a template with no agent node but a prompt maps to an inline-agent step', () => {
  const spec = workflowToAppSpec({
    title: 'Prompt-only',
    prompt: 'Be helpful.',
    workflow: { nodeIds: ['data:col_1'], edges: [] },
  });
  assert.equal(spec.steps.length, 1);
  assert.equal(spec.steps[0].kind, 'agent');
  assert.equal(
    (spec.steps[0] as { inlineAgent?: { systemPrompt: string } }).inlineAgent?.systemPrompt,
    'Be helpful.',
  );
  assert.equal(validateAppSpec(spec).ok, true);
});

test('a multi-agent template with no edges is wired into a valid linear chain', () => {
  const spec = workflowToAppSpec({
    title: 'Two-stage',
    workflow: { nodeIds: ['agent:a', 'agent:b'], edges: [] },
  });
  assert.equal(spec.steps.length, 2);
  assert.deepEqual(spec.edges, [{ from: 'agent:a', to: 'agent:b' }]);
  assert.equal(validateAppSpec(spec).ok, true);
});

test('shim round-trips: a 1-step agent app fed back as a template is stable', () => {
  const original = simpleAgentApp({
    title: 'Support bot',
    steps: [{ id: 'agent:agent_x', label: 'Support bot', kind: 'agent', agentId: 'agent_x' }],
  });
  // Feed the 1-step spec back through the shim as if it were a template.
  const tpl: LegacyTemplate = {
    id: original.id,
    orgId: original.orgId,
    ownerId: original.ownerId,
    title: original.title,
    summary: original.summary,
    visibility: original.visibility,
    slug: original.slug ?? null,
    published: original.published,
    workflow: {
      title: original.title,
      nodeIds: ['agent:agent_x'],
      edges: [],
    },
  };
  const round = workflowToAppSpec(tpl);
  assert.equal(round.steps.length, 1);
  assert.equal((round.steps[0] as { agentId?: string }).agentId, 'agent_x');
  assert.equal(round.steps[0].id, original.steps[0].id, 'node id preserved');
  assert.equal(isSimpleAgent(round), true);
});

// ─── filterSingleStepApps — the /build/agents distinct list (UX-audit T4 item 4) ───────────────────
test('filterSingleStepApps keeps only single-agent apps (dedupes /build/agents from Studio)', () => {
  const oneStep = simpleAgentApp({ id: 'app_agent' });
  const twoStep = simpleAgentApp({
    id: 'app_wf',
    steps: [
      { id: 's1', label: 'A', kind: 'agent', agentId: 'a1' },
      { id: 's2', label: 'B', kind: 'output', sink: 'console' },
    ],
    edges: [{ from: 's1', to: 's2' }],
  });
  const out = filterSingleStepApps([oneStep, twoStep]);
  assert.deepEqual(out.map((a) => a.id), ['app_agent']);
});

test('filterSingleStepApps is empty when there are no single-step apps', () => {
  const twoStep = simpleAgentApp({
    id: 'app_wf',
    steps: [
      { id: 's1', label: 'A', kind: 'agent', agentId: 'a1' },
      { id: 's2', label: 'B', kind: 'output', sink: 'console' },
    ],
    edges: [{ from: 's1', to: 's2' }],
  });
  assert.deepEqual(filterSingleStepApps([twoStep]), []);
});

// ─── appNeedsDataSource / unboundConnectorSteps (save-with-gap #128) ──────────────────────────────
// The pure "does this saved app still need a data source" rule the Input/detail banner reads. Derived
// from the spec alone (no schema column) — a connector-query step with an empty domain binding.

test('unboundConnectorSteps: returns each connector-query step with no domain binding', () => {
  const app = simpleAgentApp({
    steps: [
      { id: 's1', label: 'Read claims', kind: 'connector-query', domain: '' },
      { id: 's2', label: 'Read quota', kind: 'connector-query', domain: '   ' },
      { id: 's3', label: 'Decide', kind: 'agent', inlineAgent: { systemPrompt: 'x', grounded: true } },
      { id: 's4', label: 'Out', kind: 'output', sink: 'console' },
    ],
    edges: [
      { from: 's1', to: 's2' },
      { from: 's2', to: 's3' },
      { from: 's3', to: 's4' },
    ],
  });
  const unbound = unboundConnectorSteps(app);
  assert.deepEqual(unbound.map((s) => s.id), ['s1', 's2']);
});

test('appNeedsDataSource: true when a connector-query step has no domain', () => {
  const app = simpleAgentApp({
    steps: [
      { id: 's1', label: 'Read', kind: 'connector-query', domain: '' },
      { id: 's2', label: 'Out', kind: 'output', sink: 'console' },
    ],
    edges: [{ from: 's1', to: 's2' }],
  });
  assert.equal(appNeedsDataSource(app), true);
});

test('appNeedsDataSource: false when every connector-query step is bound', () => {
  const app = simpleAgentApp({
    steps: [
      { id: 's1', label: 'Read', kind: 'connector-query', domain: 'dom_claims' },
      { id: 's2', label: 'Out', kind: 'output', sink: 'console' },
    ],
    edges: [{ from: 's1', to: 's2' }],
  });
  assert.equal(appNeedsDataSource(app), false);
  assert.deepEqual(unboundConnectorSteps(app), []);
});

test('appNeedsDataSource: false for an app with no connector-query steps at all', () => {
  // The common save-with-gap outcome: the compiler DROPPED the unbindable step, so the saved app is
  // just agent + output — it does not "need a data source", it simply reads none. No banner.
  const app = simpleAgentApp({
    steps: [
      { id: 's1', label: 'Decide', kind: 'agent', inlineAgent: { systemPrompt: 'x', grounded: true } },
      { id: 's2', label: 'Out', kind: 'output', sink: 'console' },
    ],
    edges: [{ from: 's1', to: 's2' }],
  });
  assert.equal(appNeedsDataSource(app), false);
});
