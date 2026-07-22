import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '../src/lib/app-model.ts';
import {
  cloneAppSpec,
  cloneStep,
  deriveCopyTitle,
  type CloneOptions,
} from '../src/lib/app-clone.ts';

// A representative multi-step source app: one materialized inline agent (agentId + inlineAgent), one
// library-agent reference (agentId only), a connector-query, a human step, and an output; wired
// linearly. Published, on a pipeline, with a slug — everything a real deployed app carries.
function sourceApp(overrides: Partial<AppSpec> = {}): AppSpec {
  return {
    id: 'app_source',
    orgId: 'team-a',
    ownerId: 'lead@team-a',
    title: 'Renewals Assistant',
    summary: 'Handles renewals',
    visibility: 'org',
    slug: 'renewals-assistant-ab12',
    published: true,
    pipelineId: 'pl_source',
    trigger: { kind: 'webhook', config: { secretRef: 'x' } },
    inputForm: [{ key: 'policyNo', label: 'Policy #', type: 'text', required: true }],
    steps: [
      {
        id: 's1',
        label: 'Draft',
        kind: 'agent',
        agentId: 'agent_owned', // materialized runtime id owned by the source app
        inlineAgent: { systemPrompt: 'Draft a renewal', grounded: true },
      },
      { id: 's2', label: 'Lookup', kind: 'connector-query', domain: 'policies' },
      { id: 's3', label: 'Shared', kind: 'agent', agentId: 'lib_agent_1' }, // library ref (no inline)
      { id: 's4', label: 'Approve', kind: 'human' },
      { id: 's5', label: 'Send', kind: 'output', sink: 'email', config: { to: 'x' } },
    ],
    edges: [
      { from: 's1', to: 's2' },
      { from: 's2', to: 's3' },
      { from: 's3', to: 's4' },
      { from: 's4', to: 's5' },
    ],
    ...overrides,
  };
}

const baseOpts = (over: Partial<CloneOptions> = {}): CloneOptions => ({
  orgId: 'team-b',
  ownerId: 'user@team-b',
  mintId: () => 'app_new',
  origin: 'clone',
  clonedAt: '2026-07-22T00:00:00.000Z',
  ...over,
});

test('deriveCopyTitle: first copy → "(copy)"', () => {
  assert.equal(deriveCopyTitle('Renewals Assistant'), 'Renewals Assistant (copy)');
});

test('deriveCopyTitle: existing "(copy)" → "(copy 2)"', () => {
  assert.equal(deriveCopyTitle('Renewals Assistant (copy)'), 'Renewals Assistant (copy 2)');
});

test('deriveCopyTitle: "(copy 3)" → "(copy 4)"', () => {
  assert.equal(deriveCopyTitle('X (copy 3)'), 'X (copy 4)');
});

test('deriveCopyTitle: blank/whitespace → "Untitled app (copy)"', () => {
  assert.equal(deriveCopyTitle(''), 'Untitled app (copy)');
  assert.equal(deriveCopyTitle('   '), 'Untitled app (copy)');
});

test('cloneStep: materialized inline agent drops runtime agentId, keeps inline def', () => {
  const cloned = cloneStep({
    id: 's1',
    label: 'Draft',
    kind: 'agent',
    agentId: 'agent_owned',
    inlineAgent: { systemPrompt: 'p', grounded: true },
  });
  assert.equal(cloned.kind, 'agent');
  if (cloned.kind !== 'agent') throw new Error('unreachable');
  assert.equal(cloned.agentId, undefined);
  assert.deepEqual(cloned.inlineAgent, { systemPrompt: 'p', grounded: true });
});

test('cloneStep: library-agent reference (no inline) keeps its agentId', () => {
  const cloned = cloneStep({ id: 's', label: 'L', kind: 'agent', agentId: 'lib_agent_1' });
  if (cloned.kind !== 'agent') throw new Error('unreachable');
  assert.equal(cloned.agentId, 'lib_agent_1');
});

test('cloneStep: non-agent step is a structural deep clone (no aliasing)', () => {
  const src = { id: 's', label: 'L', kind: 'output' as const, sink: 'email' as const, config: { to: 'x' } };
  const cloned = cloneStep(src);
  assert.deepEqual(cloned, src);
  assert.notEqual(cloned, src);
  if (cloned.kind === 'output') assert.notEqual(cloned.config, src.config);
});

test('cloneAppSpec: mints id/owner/org, resets slug+published+pipeline, derives copy title', () => {
  const { spec } = cloneAppSpec(sourceApp(), baseOpts());
  assert.equal(spec.id, 'app_new');
  assert.equal(spec.orgId, 'team-b');
  assert.equal(spec.ownerId, 'user@team-b');
  assert.equal(spec.title, 'Renewals Assistant (copy)');
  assert.equal(spec.slug, undefined);
  assert.equal(spec.published, false);
  assert.equal(spec.pipelineId, null);
  assert.equal(spec.visibility, 'private');
});

test('cloneAppSpec: carries steps/edges/trigger/inputForm structurally (deep, not aliased)', () => {
  const source = sourceApp();
  const { spec } = cloneAppSpec(source, baseOpts());
  assert.equal(spec.steps.length, 5);
  assert.deepEqual(spec.edges, source.edges);
  assert.notEqual(spec.edges, source.edges);
  assert.deepEqual(spec.inputForm, source.inputForm);
  assert.notEqual(spec.inputForm, source.inputForm);
  assert.equal(spec.trigger.kind, 'webhook');
  assert.notEqual(spec.trigger, source.trigger);
  // The materialized agent's runtime id is reset in the clone; the library ref is kept.
  const s1 = spec.steps[0];
  const s3 = spec.steps[2];
  if (s1.kind !== 'agent' || s3.kind !== 'agent') throw new Error('unreachable');
  assert.equal(s1.agentId, undefined);
  assert.equal(s3.agentId, 'lib_agent_1');
  // Source is untouched (no mutation).
  const srcS1 = source.steps[0];
  if (srcS1.kind !== 'agent') throw new Error('unreachable');
  assert.equal(srcS1.agentId, 'agent_owned');
});

test('cloneAppSpec: origin "clone" records sourceAppId, not sourceTemplateId', () => {
  const { lineage } = cloneAppSpec(sourceApp(), baseOpts({ origin: 'clone' }));
  assert.equal(lineage.origin, 'clone');
  assert.equal(lineage.sourceAppId, 'app_source');
  assert.equal(lineage.sourceTemplateId, undefined);
  assert.equal(lineage.sourceTitle, 'Renewals Assistant');
  assert.equal(lineage.clonedAt, '2026-07-22T00:00:00.000Z');
  assert.equal(lineage.clonedBy, 'user@team-b');
});

test('cloneAppSpec: origin "template" records sourceTemplateId, not sourceAppId', () => {
  const { lineage } = cloneAppSpec(
    sourceApp(),
    baseOpts({ origin: 'template', sourceTemplateId: 'tpl_1' }),
  );
  assert.equal(lineage.origin, 'template');
  assert.equal(lineage.sourceTemplateId, 'tpl_1');
  assert.equal(lineage.sourceAppId, undefined);
});

test('cloneAppSpec: origin "template" WITHOUT a template id records neither id', () => {
  const { lineage } = cloneAppSpec(sourceApp(), baseOpts({ origin: 'template' }));
  assert.equal(lineage.sourceTemplateId, undefined);
  assert.equal(lineage.sourceAppId, undefined);
});

test('cloneAppSpec: explicit title override wins over derived copy title', () => {
  const { spec } = cloneAppSpec(sourceApp(), baseOpts({ title: '  My Own Name  ' }));
  assert.equal(spec.title, 'My Own Name');
});

test('cloneAppSpec: blank title override falls back to derived copy title', () => {
  const { spec } = cloneAppSpec(sourceApp(), baseOpts({ title: '   ' }));
  assert.equal(spec.title, 'Renewals Assistant (copy)');
});

test('cloneAppSpec: handles a minimal source (no inputForm, no trigger config)', () => {
  const minimal = sourceApp({
    inputForm: undefined,
    trigger: { kind: 'on-demand' },
    summary: undefined as unknown as string,
  });
  const { spec } = cloneAppSpec(minimal, baseOpts());
  assert.equal(spec.inputForm, undefined);
  assert.equal(spec.trigger.kind, 'on-demand');
  assert.equal(spec.summary, '');
});
