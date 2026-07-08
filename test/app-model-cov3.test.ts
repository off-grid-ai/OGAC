import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type AppSpec,
  type LegacyTemplate,
  validateAppSpec,
  workflowToAppSpec,
} from '../src/lib/app-model.ts';

// Branch-coverage top-up for app-model.ts — targets the validation error arms + the
// workflowToAppSpec legacy shim branches the base suite doesn't hit.

function baseSpec(over: Partial<AppSpec> = {}): AppSpec {
  return {
    id: 'app_1',
    orgId: 'default',
    ownerId: 'u@x',
    title: 'App',
    summary: '',
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps: [{ id: 's1', label: 'Answer', kind: 'agent', agentId: 'agent_x' }],
    edges: [],
    ...over,
  };
}

// ── validateAppSpec error arms ───────────────────────────────────────────────
test('a step with an empty/blank id is rejected', () => {
  const r = validateAppSpec(baseSpec({ steps: [{ id: '  ', label: 'x', kind: 'agent', agentId: 'a' }] }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('non-empty id')));
});

test('an unknown step kind is rejected', () => {
  const r = validateAppSpec(
    baseSpec({ steps: [{ id: 's1', label: 'x', kind: 'frobnicate' as never, agentId: 'a' } as never] }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("unknown kind")));
});

test('duplicate step ids are rejected', () => {
  const r = validateAppSpec(
    baseSpec({
      steps: [
        { id: 'dup', label: 'a', kind: 'agent', agentId: 'a' },
        { id: 'dup', label: 'b', kind: 'agent', agentId: 'b' },
      ],
      edges: [{ from: 'dup', to: 'dup' }],
    }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('duplicate step id')));
});

test('an inlineAgent step with no systemPrompt is rejected', () => {
  const r = validateAppSpec(
    baseSpec({ steps: [{ id: 's1', label: 'x', kind: 'agent', inlineAgent: { systemPrompt: '   ' } }] }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('needs a systemPrompt')));
});

test('a valid inlineAgent step (with systemPrompt) passes', () => {
  const r = validateAppSpec(
    baseSpec({ steps: [{ id: 's1', label: 'x', kind: 'agent', inlineAgent: { systemPrompt: 'be helpful' } }] }),
  );
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('a multi-step graph with no entry (every step has an incoming edge) is rejected', () => {
  const r = validateAppSpec(
    baseSpec({
      steps: [
        { id: 'a', label: 'a', kind: 'agent', agentId: 'x' },
        { id: 'b', label: 'b', kind: 'agent', agentId: 'y' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('no entry step')));
});

test('edges referencing unknown steps are rejected', () => {
  const r = validateAppSpec(
    baseSpec({
      steps: [{ id: 'a', label: 'a', kind: 'agent', agentId: 'x' }],
      edges: [{ from: 'ghost', to: 'a' }],
    }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('unknown step (from)')));
});

// ── workflowToAppSpec legacy shim ────────────────────────────────────────────
test('workflow with agent nodes maps 1:1 and wires a linear chain when no usable edges', () => {
  const tpl: LegacyTemplate = {
    title: 'Chain',
    workflow: { nodeIds: ['agent:a', 'agent:b', 'note:x'], edges: [] },
  };
  const spec = workflowToAppSpec(tpl);
  assert.equal(spec.steps.length, 2);
  assert.equal(spec.steps[0].id, 'agent:a');
  // No usable edges → linear chain wired.
  assert.deepEqual(spec.edges, [{ from: 'agent:a', to: 'agent:b' }]);
});

test('workflow with a prompt but no agent node → one inline-agent step', () => {
  const spec = workflowToAppSpec({ title: 'P', prompt: 'do the thing', workflow: {} });
  assert.equal(spec.steps.length, 1);
  assert.equal(spec.steps[0].kind, 'agent');
  assert.equal((spec.steps[0] as { inlineAgent?: { systemPrompt: string } }).inlineAgent?.systemPrompt, 'do the thing');
});

test('degenerate legacy template (no nodes, no prompt) still yields a valid single inline-agent step', () => {
  const spec = workflowToAppSpec({ title: 'Bare', summary: 'sum', workflow: {} });
  assert.equal(spec.steps.length, 1);
  assert.equal((spec.steps[0] as { inlineAgent?: { systemPrompt: string } }).inlineAgent?.systemPrompt, 'sum');
  assert.equal(validateAppSpec(spec).ok, true);
});

test('workflowToAppSpec normalizes visibility and preserves usable edges', () => {
  const org = workflowToAppSpec({
    title: 'Vis',
    visibility: 'org',
    workflow: { nodeIds: ['agent:a', 'agent:b'], edges: [{ from: 'agent:a', to: 'agent:b' }] },
  });
  assert.equal(org.visibility, 'org');
  assert.deepEqual(org.edges, [{ from: 'agent:a', to: 'agent:b' }]);

  const bogus = workflowToAppSpec({ title: 'V', visibility: 'nonsense', workflow: { nodeIds: ['agent:a'] } });
  assert.equal(bogus.visibility, 'private');
});
