import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveEnterpriseContext,
  type EnterpriseContextResolverInput,
  type EnterpriseResourceCandidate,
} from '@/lib/enterprise-context-resolver';

function candidate(
  overrides: Partial<EnterpriseResourceCandidate> = {},
): EnterpriseResourceCandidate {
  return {
    ref: 'tool:crm',
    sliceId: 'tools',
    kind: 'capability',
    label: 'CRM lookup',
    description: 'Read customer records.',
    orgId: 'org-bank',
    visibility: {
      status: 'visible',
      source: 'module-access',
      reasonCode: 'module.visible',
      reason: 'This capability is visible to your role.',
    },
    availability: {
      status: 'available',
      source: 'catalog',
      reasonCode: 'catalog.available',
      reason: 'This capability is connected and ready.',
    },
    authorization: {
      status: 'allowed',
      source: 'app-access',
      reasonCode: 'access.allowed',
      reason: 'Your app access policy allows this capability.',
    },
    ...overrides,
  };
}

function input(resources: EnterpriseResourceCandidate[] = []): EnterpriseContextResolverInput {
  return {
    policyVersion: 'policy-v17',
    evaluatedAt: '2026-07-23T00:15:00.000Z',
    actor: {
      actorId: 'analyst@bank.test',
      principalKind: 'user',
      role: 'portfolio-analyst',
      baseRole: 'viewer',
      departments: ['Sales', 'Retail'],
      teams: ['west', 'cross-sell'],
    },
    tenant: { effectiveOrgId: 'org-bank', requestedOrgId: 'org-bank' },
    resources,
    intentDecisions: [],
    slices: [],
  };
}

test('applies security precedence denied > unavailable > approval-required > ready', () => {
  const denied = candidate({
    ref: 'tool:denied',
    availability: {
      status: 'unavailable',
      source: 'deployment',
      reasonCode: 'deployment.offline',
      reason: 'The connection is offline.',
    },
    authorization: {
      status: 'approval-required',
      source: 'app-access',
      reasonCode: 'access.approval',
      reason: 'Approval is required.',
    },
    constraints: [
      {
        status: 'denied',
        source: 'pipeline',
        reasonCode: 'pipeline.data.denied',
        reason: 'The pipeline does not allow this data.',
      },
    ],
  });
  const unavailable = candidate({
    ref: 'tool:offline',
    availability: {
      status: 'unavailable',
      source: 'deployment',
      reasonCode: 'deployment.offline',
      reason: 'The connection is offline.',
    },
    authorization: {
      status: 'approval-required',
      source: 'action-policy',
      reasonCode: 'action.approval',
      reason: 'A reviewer must approve this action.',
    },
  });
  const approval = candidate({
    ref: 'tool:approval',
    authorization: {
      status: 'approval-required',
      source: 'action-policy',
      reasonCode: 'action.approval',
      reason: 'A reviewer must approve this action.',
    },
  });

  const result = resolveEnterpriseContext(input([denied, unavailable, approval, candidate()]));
  const byRef = new Map(result.resources.map((resource) => [resource.ref, resource]));
  assert.equal(byRef.get('tool:denied')?.disposition, 'denied');
  assert.equal(byRef.get('tool:denied')?.reasonCode, 'pipeline.data.denied');
  assert.equal(byRef.get('tool:offline')?.disposition, 'unavailable');
  assert.equal(byRef.get('tool:approval')?.disposition, 'approval-required');
  assert.equal(byRef.get('tool:crm')?.disposition, 'ready');
});

test('omits hidden and cross-tenant resources without leaking their refs', () => {
  const hiddenRef = 'tool:secret-hidden';
  const otherTenantRef = 'data:other-bank';
  const result = resolveEnterpriseContext(
    input([
      candidate({
        ref: hiddenRef,
        visibility: {
          status: 'hidden',
          source: 'module-access',
          reasonCode: 'module.hidden',
          reason: 'This capability is not visible to your role.',
        },
      }),
      candidate({ ref: otherTenantRef, orgId: 'org-insurer' }),
      candidate({ ref: 'tool:visible' }),
    ]),
  );
  assert.equal(result.omittedCount, 2);
  assert.deepEqual(
    result.resources.map((resource) => resource.ref),
    ['tool:visible'],
  );
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(hiddenRef), false);
  assert.equal(serialized.includes(otherTenantRef), false);
});

test('approval-required items are selectable but cannot run before approval', () => {
  const result = resolveEnterpriseContext(
    input([
      candidate({
        kind: 'action',
        sliceId: 'actions',
        managementHref: '/solutions/tools/registered',
        scopeSummary: 'May update one allowlisted CRM opportunity.',
        authorization: {
          status: 'approval-required',
          source: 'action-policy',
          reasonCode: 'action.maker-checker',
          reason: 'A second person must approve this CRM change.',
          remedyHref: '/governance/reviews',
        },
        action: {
          connectorCompatibility: 'compatible',
          approvalRequired: true,
          eligiblePriorHumanSteps: [{ ref: 'step:review', label: 'Manager review' }],
          impactSummary: 'Creates one CRM follow-up task.',
          egressSummary: 'Uses the approved internal CRM connection.',
        },
      }),
    ]),
  );
  const action = result.resources[0];
  assert.equal(action.canSelect, true);
  assert.equal(action.canUseNow, false);
  assert.equal(action.requiresApproval, true);
  assert.equal(action.remedyHref, '/governance/reviews');
  assert.equal(action.sliceId, 'actions');
  assert.equal(action.managementHref, '/solutions/tools/registered');
  assert.equal(action.scopeSummary, 'May update one allowlisted CRM opportunity.');
  assert.equal(action.action?.approvalRequired, true);
  assert.deepEqual(action.action?.eligiblePriorHumanSteps, [
    { ref: 'step:review', label: 'Manager review' },
  ]);
});

test('copies policy provenance into the serializable resolution', () => {
  const result = resolveEnterpriseContext(input([candidate()]));
  assert.equal(result.policyVersion, 'policy-v17');
  assert.equal(result.evaluatedAt, '2026-07-23T00:15:00.000Z');
  assert.equal(result.tenant.effectiveOrgId, 'org-bank');
  assert.equal(result.actor.actorId, 'analyst@bank.test');
});

test('derives allowed builder intents and preserves partial/failed catalog slices', () => {
  const base = input();
  base.intentDecisions = [
    {
      intent: 'publish',
      status: 'approval-required',
      source: 'app-access',
      reasonCode: 'publish.review',
      reason: 'Publishing needs review.',
    },
    {
      intent: 'build.create',
      status: 'allowed',
      source: 'module-access',
      reasonCode: 'build.allowed',
      reason: 'You can create apps.',
    },
    {
      intent: 'data.configure',
      status: 'denied',
      source: 'module-access',
      reasonCode: 'data.admin-only',
      reason: 'Only data administrators can configure sources.',
    },
  ];
  base.slices = [
    {
      id: 'tools',
      label: 'Tools',
      status: 'failed',
      source: 'org-context',
      reasonCode: 'tools.load-failed',
      reason: 'Tools could not be loaded.',
    },
    {
      id: 'domains',
      label: 'Data domains',
      status: 'partial',
      source: 'org-context',
      reasonCode: 'domains.partial',
      reason: 'Some data domains could not be loaded.',
    },
  ];

  const result = resolveEnterpriseContext(base);
  assert.deepEqual(result.allowedIntents, ['build.create']);
  assert.deepEqual(
    result.intentDecisions.map((decision) => decision.intent),
    ['build.create', 'data.configure', 'publish'],
  );
  assert.deepEqual(
    result.slices.map((slice) => [slice.id, slice.status]),
    [
      ['domains', 'partial'],
      ['tools', 'failed'],
    ],
  );
});

test('duplicate intent facts collapse fail-closed with a deterministic decisive reason', () => {
  const base = input();
  base.intentDecisions = [
    {
      intent: 'publish',
      status: 'allowed',
      source: 'app-sharing',
      reasonCode: 'publish.shared',
      reason: 'A share allows publishing.',
    },
    {
      intent: 'publish',
      status: 'denied',
      source: 'pipeline',
      reasonCode: 'publish.pipeline-denied',
      reason: 'The governed pipeline blocks publishing.',
    },
    {
      intent: 'publish',
      status: 'denied',
      source: 'module-access',
      reasonCode: 'publish.module-denied',
      reason: 'Your module access does not allow publishing.',
    },
    {
      intent: 'tool.select',
      status: 'approval-required',
      source: 'action-policy',
      reasonCode: 'tool.approval',
      reason: 'A reviewer must approve tool use.',
    },
    {
      intent: 'tool.select',
      status: 'allowed',
      source: 'app-access',
      reasonCode: 'tool.allowed',
      reason: 'App access allows tool use.',
    },
  ];

  const result = resolveEnterpriseContext(base);
  assert.deepEqual(result.allowedIntents, []);
  assert.deepEqual(
    result.intentDecisions.map((decision) => [
      decision.intent,
      decision.status,
      decision.reasonCode,
    ]),
    [
      ['publish', 'denied', 'publish.module-denied'],
      ['tool.select', 'approval-required', 'tool.approval'],
    ],
  );
});

test('orders resources and decisive constraint reasons deterministically', () => {
  const constraints = [
    {
      status: 'denied' as const,
      source: 'pipeline' as const,
      reasonCode: 'z-deny',
      reason: 'Pipeline denied Z.',
    },
    {
      status: 'denied' as const,
      source: 'module-access' as const,
      reasonCode: 'a-deny',
      reason: 'Module denied A.',
    },
  ];
  const result = resolveEnterpriseContext(
    input([
      candidate({ ref: 'action:z', kind: 'action', label: 'Zulu' }),
      candidate({ ref: 'data:b', kind: 'data', label: 'Beta', constraints }),
      candidate({ ref: 'data:a', kind: 'data', label: 'Alpha' }),
      candidate({ ref: 'cap:a', kind: 'capability', label: 'Alpha' }),
    ]),
  );
  assert.deepEqual(
    result.resources.map((resource) => resource.ref),
    ['data:a', 'data:b', 'cap:a', 'action:z'],
  );
  assert.equal(result.resources[1].reasonCode, 'a-deny');
});

test('returns a complete empty projection', () => {
  const result = resolveEnterpriseContext(input());
  assert.deepEqual(result.resources, []);
  assert.deepEqual(result.intentDecisions, []);
  assert.deepEqual(result.allowedIntents, []);
  assert.deepEqual(result.slices, []);
  assert.deepEqual(result.summary, {
    visible: 0,
    omitted: 0,
    ready: 0,
    approvalRequired: 0,
    unavailable: 0,
    denied: 0,
  });
});

test('does not mutate or alias caller-owned arrays and nested action facts', () => {
  const source = input([
    candidate({
      action: {
        connectorCompatibility: 'unknown',
        approvalRequired: false,
        eligiblePriorHumanSteps: [{ ref: 'step:one', label: 'First review' }],
      },
    }),
  ]);
  source.intentDecisions = [
    {
      intent: 'tool.select',
      status: 'allowed',
      source: 'module-access',
      reasonCode: 'tool.allowed',
      reason: 'Tools may be selected.',
    },
  ];
  source.slices = [
    {
      id: 'tools',
      label: 'Tools',
      status: 'ready',
      source: 'catalog',
      reasonCode: 'tools.ready',
      reason: 'Tools are ready.',
    },
  ];
  const before = structuredClone(source);
  const result = resolveEnterpriseContext(source);
  assert.deepEqual(source, before);

  result.actor.departments.push('Mutated');
  result.resources[0].action?.eligiblePriorHumanSteps[0] &&
    ((result.resources[0].action!.eligiblePriorHumanSteps[0] as { label: string }).label =
      'Changed');
  result.intentDecisions[0].reason = 'Changed';
  result.slices[0].reason = 'Changed';
  assert.deepEqual(source, before);
});
