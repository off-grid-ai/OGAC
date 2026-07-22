import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractAppCapabilitySelections,
  validateAppCapabilitySelections,
} from '../src/lib/app-capability-selection.ts';
import type {
  EnterpriseContextResolution,
  EnterpriseDisposition,
} from '../src/lib/enterprise-context-resolver.ts';

function context(
  dispositions: Record<string, EnterpriseDisposition>,
  failedSlices: string[] = [],
): EnterpriseContextResolution {
  const sliceFor = (ref: string): string => {
    if (ref.startsWith('data:')) return 'data';
    if (ref.startsWith('action:')) return 'actions';
    if (ref.startsWith('pipeline:')) return 'pipelines';
    return 'capabilities';
  };
  const sliceIds = ['data', 'actions', 'pipelines', 'capabilities'];
  return {
    policyVersion: 'test',
    evaluatedAt: '2026-07-23T00:00:00.000Z',
    actor: {
      actorId: 'admin@example.test',
      principalKind: 'user',
      role: 'admin',
      baseRole: 'admin',
      departments: [],
      teams: [],
    },
    tenant: { effectiveOrgId: 'org-a', requestedOrgId: null },
    resources: Object.entries(dispositions).map(([ref, disposition]) => ({
      ref,
      sliceId: sliceFor(ref),
      kind: ref.startsWith('data:') ? 'data' : ref.startsWith('action:') ? 'action' : 'capability',
      label: 'Safe label',
      disposition,
      canSelect: disposition === 'ready' || disposition === 'approval-required',
      canUseNow: disposition === 'ready',
      requiresApproval: disposition === 'approval-required',
      reasonCode: 'test',
      reason: 'Test reason.',
    })),
    omittedCount: 0,
    intentDecisions: [],
    allowedIntents: [],
    slices: sliceIds.map((id) => ({
      id,
      label: id,
      status: failedSlices.includes(id) ? 'failed' : 'ready',
      source: 'catalog',
      reasonCode: 'test',
      reason: 'Test reason.',
    })),
    summary: {
      visible: Object.keys(dispositions).length,
      omitted: 0,
      ready: 0,
      approvalRequired: 0,
      unavailable: 0,
      denied: 0,
    },
  };
}

const input = {
  pipelineId: 'pl-approved',
  steps: [
    { id: 'query', kind: 'connector-query', domain: 'customers' },
    {
      id: 'agent',
      kind: 'agent',
      inlineAgent: {
        tools: ['tool:crm', 'prim:web_search', 'tool:crm', '', 42],
      },
    },
    { id: 'action', kind: 'action', actionId: 'crm.create-task' },
  ],
};

test('extracts and deduplicates every selectable reference from an App input', () => {
  assert.deepEqual(extractAppCapabilitySelections(input), [
    { kind: 'pipeline', ref: 'pipeline:pl-approved' },
    { kind: 'data', ref: 'data:customers' },
    { kind: 'tool', ref: 'tool:crm' },
    { kind: 'tool', ref: 'prim:web_search' },
    { kind: 'action', ref: 'action:crm.create-task' },
  ]);
});

test('a partial patch validates only references it explicitly changes', () => {
  assert.deepEqual(extractAppCapabilitySelections({ pipelineId: null }), []);
  assert.deepEqual(
    extractAppCapabilitySelections({
      steps: [{ kind: 'agent', inlineAgent: { tools: ['app:approved-helper'] } }],
    }),
    [{ kind: 'tool', ref: 'app:approved-helper' }],
  );
});

test('accepts only ready or approval-required selections', () => {
  const result = validateAppCapabilitySelections(
    input,
    context({
      'pipeline:pl-approved': 'ready',
      'data:customers': 'ready',
      'tool:crm': 'approval-required',
      'prim:web_search': 'ready',
      'action:crm.create-task': 'approval-required',
    }),
  );
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('rejects absent, denied, unavailable and failed-slice selections with bounded safe errors', () => {
  const result = validateAppCapabilitySelections(
    input,
    context(
      {
        'pipeline:pl-approved': 'denied',
        'data:customers': 'ready',
        'tool:crm': 'unavailable',
        'action:crm.create-task': 'approval-required',
      },
      ['data', 'actions'],
    ),
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 4);
  assert.match(result.errors[0], /pipeline/);
  assert.match(result.errors[1], /data source/);
  assert.match(result.errors[2], /tool/);
  assert.match(result.errors[3], /enterprise action/);
  assert.doesNotMatch(JSON.stringify(result), /pl-approved|customers|crm\.create-task|prim:web_search/);
});

test('malformed step shapes are left to App validation without throwing or fabricating refs', () => {
  assert.deepEqual(
    extractAppCapabilitySelections({
      steps: [null, [], 'step', { kind: 'connector-query' }, { kind: 'agent', inlineAgent: [] }],
    }),
    [],
  );
});
