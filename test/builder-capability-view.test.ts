import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBuilderCapabilityView,
  type BuilderControlState,
} from '@/lib/builder-capability-view';
import type {
  EnterpriseBuilderIntent,
  EnterpriseCatalogSlice,
  EnterpriseContextResolution,
  EnterpriseIntentDecision,
  ResolvedEnterpriseResource,
} from '@/lib/enterprise-context-resolver';

function resource(overrides: Partial<ResolvedEnterpriseResource> = {}): ResolvedEnterpriseResource {
  return {
    ref: 'tool:crm',
    sliceId: 'tools',
    kind: 'capability',
    label: 'CRM lookup',
    description: 'Read customer records.',
    disposition: 'ready',
    canSelect: true,
    canUseNow: true,
    requiresApproval: false,
    reasonCode: 'catalog.ready',
    reason: 'This capability is connected and ready.',
    ...overrides,
  };
}

function slice(overrides: Partial<EnterpriseCatalogSlice> = {}): EnterpriseCatalogSlice {
  return {
    id: 'tools',
    label: 'Tools',
    status: 'ready',
    source: 'catalog',
    reasonCode: 'tools.ready',
    reason: 'Tools are ready.',
    ...overrides,
  };
}

function decision(
  intent: EnterpriseBuilderIntent,
  status: EnterpriseIntentDecision['status'],
): EnterpriseIntentDecision {
  return {
    intent,
    status,
    source: 'module-access',
    reasonCode: `${intent}.${status}`,
    reason: `${intent} is ${status}.`,
  };
}

function resolution(
  overrides: Partial<EnterpriseContextResolution> = {},
): EnterpriseContextResolution {
  return {
    policyVersion: 'policy-v17',
    evaluatedAt: '2026-07-23T00:15:00.000Z',
    actor: {
      actorId: 'builder@bank.test',
      principalKind: 'user',
      role: 'portfolio-analyst',
      baseRole: 'viewer',
      departments: ['Retail'],
      teams: ['cross-sell'],
    },
    tenant: { effectiveOrgId: 'org-bank', requestedOrgId: 'org-bank' },
    resources: [],
    omittedCount: 0,
    intentDecisions: [],
    allowedIntents: [],
    slices: [],
    summary: {
      visible: 0,
      omitted: 0,
      ready: 0,
      approvalRequired: 0,
      unavailable: 0,
      denied: 0,
    },
    ...overrides,
  };
}

test('groups resources by slice and maps every disposition to a plain selection state', () => {
  const view = buildBuilderCapabilityView(
    resolution({
      resources: [
        resource({ managementHref: '/solutions/tools/registered?from=builder' }),
        resource({
          ref: 'tool:approval',
          disposition: 'approval-required',
          canUseNow: false,
          requiresApproval: true,
          reasonCode: 'action.maker-checker',
          reason: 'A second person must approve this action.',
        }),
        resource({
          ref: 'tool:denied',
          disposition: 'denied',
          canSelect: false,
          canUseNow: false,
          reasonCode: 'pipeline.data-denied',
          reason: 'Your current access does not allow this option.',
          remedyHref: '/governance/reviews',
        }),
        resource({
          ref: 'tool:setup',
          disposition: 'unavailable',
          canSelect: false,
          canUseNow: false,
          reasonCode: 'connector.not-configured',
          reason: 'Connect the CRM before using this option.',
        }),
        resource({
          ref: 'tool:offline',
          disposition: 'unavailable',
          canSelect: false,
          canUseNow: false,
          reasonCode: 'deployment.offline',
          reason: 'The connected service is temporarily offline.',
        }),
      ],
      slices: [slice()],
    }),
  );

  assert.equal(view.slices.length, 1);
  const byRef = new Map(view.slices[0].items.map((item) => [item.ref, item]));
  assert.deepEqual(
    [...byRef.values()].map((item) => [item.ref, item.selectionState, item.availabilityKind]),
    [
      ['tool:crm', 'selectable', 'ready'],
      ['tool:approval', 'selectable-with-approval', 'approval'],
      ['tool:denied', 'read-only', 'policy-denied'],
      ['tool:setup', 'read-only', 'configuration-required'],
      ['tool:offline', 'read-only', 'dependency-unavailable'],
    ],
  );
  assert.equal(
    byRef.get('tool:denied')?.explanation,
    'Your current access does not allow this option.',
  );
  assert.equal(byRef.get('tool:crm')?.managementHref, '/solutions/tools/registered?from=builder');
  assert.equal(byRef.get('tool:denied')?.remedyHref, '/governance/reviews');
  assert.deepEqual(view.slices[0].counts, {
    selectable: 1,
    approvalRequired: 1,
    readOnly: 3,
  });
});

test('failed slices fail closed while partial slices preserve each resolved item decision', () => {
  const view = buildBuilderCapabilityView(
    resolution({
      resources: [
        resource({ ref: 'tool:failed-ready', sliceId: 'failed' }),
        resource({
          ref: 'tool:failed-approval',
          sliceId: 'failed',
          disposition: 'approval-required',
          canUseNow: false,
          requiresApproval: true,
        }),
        resource({ ref: 'tool:partial-ready', sliceId: 'partial' }),
      ],
      slices: [
        slice({
          id: 'failed',
          label: 'Failed tools',
          status: 'failed',
          reasonCode: 'tools.load-failed',
          reason: 'Tools could not be loaded.',
        }),
        slice({
          id: 'partial',
          label: 'Partial tools',
          status: 'partial',
          reasonCode: 'tools.partial',
          reason: 'Some tools could not be loaded.',
        }),
      ],
    }),
  );

  const failed = view.slices.find((entry) => entry.id === 'failed')!;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.explanation, 'Tools could not be loaded.');
  assert.ok(failed.items.every((item) => item.selectionState === 'read-only'));
  assert.ok(failed.items.every((item) => item.availabilityKind === 'dependency-unavailable'));
  assert.ok(failed.items.every((item) => item.reasonCode === 'tools.load-failed'));
  assert.ok(failed.items.every((item) => item.approvalGuidance === undefined));

  const partial = view.slices.find((entry) => entry.id === 'partial')!;
  assert.equal(partial.status, 'partial');
  assert.equal(partial.items[0].selectionState, 'selectable');
  assert.equal(view.summary.incompleteSlices, 2);
});

test('classifies known missing setup codes separately from dependency outages', () => {
  const setupCodes = [
    'connector-missing',
    'crm-connector-required',
    'tool-disabled',
    'primitive-disabled',
    'configuration.connector-required',
  ];
  const view = buildBuilderCapabilityView(
    resolution({
      resources: [
        ...setupCodes.map((reasonCode) =>
          resource({
            ref: `tool:${reasonCode}`,
            disposition: 'unavailable',
            canSelect: false,
            canUseNow: false,
            reasonCode,
          }),
        ),
        resource({
          ref: 'tool:offline',
          disposition: 'unavailable',
          canSelect: false,
          canUseNow: false,
          reasonCode: 'deployment.offline',
        }),
      ],
      slices: [slice()],
    }),
  );

  const byRef = new Map(view.slices[0].items.map((item) => [item.ref, item]));
  for (const reasonCode of setupCodes) {
    assert.equal(byRef.get(`tool:${reasonCode}`)?.availabilityKind, 'configuration-required');
    assert.equal(byRef.get(`tool:${reasonCode}`)?.statusLabel, 'Setup needed');
  }
  assert.equal(byRef.get('tool:offline')?.availabilityKind, 'dependency-unavailable');
});

test('approval guidance uses only approval-required disposition and supplied action facts', () => {
  const view = buildBuilderCapabilityView(
    resolution({
      resources: [
        resource({
          ref: 'action:existing-review',
          kind: 'action',
          disposition: 'approval-required',
          canUseNow: false,
          requiresApproval: true,
          action: {
            connectorCompatibility: 'compatible',
            approvalRequired: true,
            eligiblePriorHumanSteps: [{ ref: 'step:manager', label: 'Manager review' }],
          },
        }),
        resource({
          ref: 'action:add-review',
          kind: 'action',
          disposition: 'approval-required',
          canUseNow: false,
          requiresApproval: true,
          action: {
            connectorCompatibility: 'compatible',
            approvalRequired: true,
            eligiblePriorHumanSteps: [],
          },
        }),
        resource({
          ref: 'action:generic-review',
          kind: 'action',
          disposition: 'approval-required',
          canUseNow: false,
          requiresApproval: true,
        }),
        resource({
          ref: 'action:denied',
          kind: 'action',
          disposition: 'denied',
          canSelect: false,
          canUseNow: false,
          action: {
            connectorCompatibility: 'compatible',
            approvalRequired: true,
            eligiblePriorHumanSteps: [{ ref: 'step:secret', label: 'Secret review' }],
          },
        }),
      ],
      slices: [slice()],
    }),
  );
  const byRef = new Map(view.slices[0].items.map((item) => [item.ref, item]));
  assert.equal(byRef.get('action:existing-review')?.approvalGuidance?.kind, 'use-existing-step');
  assert.deepEqual(byRef.get('action:existing-review')?.approvalGuidance?.eligibleSteps, [
    { ref: 'step:manager', label: 'Manager review' },
  ]);
  assert.equal(byRef.get('action:add-review')?.approvalGuidance?.kind, 'add-approval-step');
  assert.equal(byRef.get('action:generic-review')?.approvalGuidance?.kind, 'approval-required');
  assert.equal(byRef.get('action:denied')?.approvalGuidance, undefined);
  assert.equal(JSON.stringify(view).includes('step:secret'), false);
});

test('viewer, operator, and admin controls project resolver intent facts without role inference', () => {
  const intents: EnterpriseBuilderIntent[] = [
    'build.create',
    'build.edit',
    'tool.select',
    'data.configure',
    'action.configure',
    'publish',
  ];
  const cases: {
    baseRole: string;
    statuses: EnterpriseIntentDecision['status'][];
    expected: BuilderControlState[];
  }[] = [
    {
      baseRole: 'viewer',
      statuses: intents.map(() => 'denied'),
      expected: intents.map(() => 'read-only'),
    },
    {
      baseRole: 'operator',
      statuses: [
        'allowed',
        'allowed',
        'allowed',
        'denied',
        'approval-required',
        'approval-required',
      ],
      expected: [
        'enabled',
        'enabled',
        'enabled',
        'read-only',
        'approval-required',
        'approval-required',
      ],
    },
    {
      baseRole: 'admin',
      statuses: intents.map(() => 'allowed'),
      expected: intents.map(() => 'enabled'),
    },
  ];

  for (const projection of cases) {
    const base = resolution();
    base.actor.baseRole = projection.baseRole;
    base.intentDecisions = intents.map((intent, index) =>
      decision(intent, projection.statuses[index]),
    );
    const view = buildBuilderCapabilityView(base);
    assert.deepEqual(
      view.controls.map((control) => control.state),
      projection.expected,
      projection.baseRole,
    );
  }

  const mislabeledAdmin = resolution();
  mislabeledAdmin.actor.baseRole = 'admin';
  mislabeledAdmin.intentDecisions = [decision('build.create', 'denied')];
  const view = buildBuilderCapabilityView(mislabeledAdmin);
  assert.equal(view.controls[0].state, 'read-only');
  assert.ok(view.controls.slice(1).every((control) => control.state === 'unavailable'));
  assert.ok(
    view.controls.slice(1).every((control) => control.reasonCode === 'intent.not-evaluated'),
  );
});

test('retains safe intent explanations and omits unsafe management, remedy, and slice links', () => {
  const base = resolution({
    resources: [
      resource({
        managementHref: 'https://example.test/admin',
        remedyHref: '//evil.test/steal',
        reason: '  This option   needs a local administrator.  ',
      }),
    ],
    slices: [slice({ remedyHref: '/solutions/tools' })],
    intentDecisions: [
      {
        ...decision('build.create', 'denied'),
        reason: 'Only workspace builders can create apps.',
        remedyHref: 'javascript:alert(1)',
      },
      {
        ...decision('publish', 'approval-required'),
        remedyHref: '/governance/reviews?from=builder',
      },
    ],
  });
  const view = buildBuilderCapabilityView(base);
  const item = view.slices[0].items[0];
  assert.equal(item.explanation, 'This option needs a local administrator.');
  assert.equal(item.managementHref, undefined);
  assert.equal(item.remedyHref, undefined);
  assert.equal(view.slices[0].remedyHref, '/solutions/tools');
  assert.equal(view.controls[0].explanation, 'Only workspace builders can create apps.');
  assert.equal(view.controls[0].remedyHref, undefined);
  assert.equal(view.controls[5].remedyHref, '/governance/reviews?from=builder');
});

test('keeps omitted identities absent, preserves empty failed slices, and groups undeclared slices', () => {
  const hiddenRef = 'tool:cross-tenant-secret';
  const base = resolution({
    omittedCount: 2,
    resources: [resource({ ref: 'data:customer', sliceId: 'undeclared', kind: 'data' })],
    slices: [
      slice({
        id: 'failed-empty',
        label: 'Unavailable section',
        status: 'failed',
        reasonCode: 'catalog.load-failed',
        reason: '',
      }),
    ],
  });
  (base as EnterpriseContextResolution & { hiddenResources?: string[] }).hiddenResources = [
    hiddenRef,
  ];
  const view = buildBuilderCapabilityView(base);
  assert.equal(view.summary.omitted, 2);
  assert.equal(JSON.stringify(view).includes(hiddenRef), false);
  assert.deepEqual(
    view.slices.map((entry) => [entry.id, entry.label, entry.status, entry.items.length]),
    [
      ['failed-empty', 'Unavailable section', 'failed', 0],
      ['undeclared', 'More options', 'partial', 1],
    ],
  );
  assert.equal(view.slices[0].explanation, 'This section could not be loaded.');
  assert.equal(view.summary.incompleteSlices, 2);
});

test('does not mutate the resolution or alias eligible approval steps', () => {
  const source = resolution({
    resources: [
      resource({
        disposition: 'approval-required',
        canUseNow: false,
        requiresApproval: true,
        action: {
          connectorCompatibility: 'compatible',
          approvalRequired: true,
          eligiblePriorHumanSteps: [{ ref: 'step:legal', label: 'Legal review' }],
        },
      }),
    ],
    slices: [slice()],
    intentDecisions: [decision('publish', 'approval-required')],
  });
  const before = structuredClone(source);
  const view = buildBuilderCapabilityView(source);
  assert.deepEqual(source, before);

  view.slices[0].items[0].approvalGuidance!.eligibleSteps[0].label = 'Changed';
  view.slices[0].items[0].label = 'Changed';
  view.controls[5].explanation = 'Changed';
  assert.deepEqual(source, before);
});
