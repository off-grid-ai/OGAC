import assert from 'node:assert/strict';
import test from 'node:test';
import type { CrossSellOpportunityView } from '@/lib/bank-cross-sell-contract';
import type { AppSpec } from '@/lib/app-model';
import {
  buildBankCrossSellRuntimeSpec,
  buildBankCrossSellRuntimeSpecFromSnapshot,
  freezeBankCrossSellRunSnapshot,
  parseBankCrossSellRunSnapshot,
  projectBankCrossSellEvidence,
} from '@/lib/bank-cross-sell-execution';

const APP: AppSpec = {
  id: 'app_cross_sell',
  orgId: 'org_bank',
  ownerId: 'owner',
  title: 'Cross sell',
  summary: '',
  visibility: 'org',
  published: true,
  slug: 'cross-sell',
  pipelineId: 'pipe',
  trigger: { kind: 'on-demand' },
  steps: [
    { id: 'read', label: 'Read context', kind: 'connector-query', domain: 'customer data' },
    { id: 'review', label: 'RM review', kind: 'human' },
    { id: 'output', label: 'Report', kind: 'output', sink: 'report' },
  ],
  edges: [
    { from: 'read', to: 'review' },
    { from: 'review', to: 'output' },
  ],
};

const OPPORTUNITY: CrossSellOpportunityView = {
  opportunityId: 'candidate:7',
  customerId: '7',
  customerName: 'Alpha Ltd',
  relationshipManager: 'rm@example.test',
  segment: 'enterprise',
  region: 'Mumbai',
  currentProducts: [],
  opportunityValueInr: 0,
  source: {
    kind: 'live',
    customerDomain: 'customer data',
    eligibilityDomain: 'pricing rate card',
    readAt: '2026-07-23T00:00:00.000Z',
  },
  recommendation: {
    product: 'Group Term',
    rationale: 'Proven',
    confidence: 0.8,
    eligible: true,
    constraints: [],
    citations: [{ source: 'customer data', record: 'accounts/7', label: 'Customer' }],
  },
  runId: null,
  rmDecision: { status: 'pending', reason: null, reviewer: null, decidedAt: null },
  actionReceipt: null,
  outcomes: [],
};

test('runtime spec creates a bounded CRM task against the real account id after RM approval', () => {
  const runtime = buildBankCrossSellRuntimeSpec(APP, OPPORTUNITY, 'crm-connector');
  const action = runtime.steps.find((step) => step.kind === 'action');
  assert.ok(action && action.kind === 'action');
  assert.equal(action.actionId, 'crm.create-task');
  assert.equal(action.approvalStepId, 'review');
  assert.equal(action.command.accountId, '7');
  assert.equal(action.command.opportunityId, undefined);
  assert.deepEqual(runtime.edges, [
    { from: 'read', to: 'review' },
    { from: 'review', to: 'cross-sell-writeback' },
    { from: 'cross-sell-writeback', to: 'output' },
  ]);
});

test('runtime spec refuses a recommendation that is not proven ready for action', () => {
  for (const recommendation of [
    null,
    { ...OPPORTUNITY.recommendation!, eligible: false },
    { ...OPPORTUNITY.recommendation!, constraints: ['Needs evidence'] },
    { ...OPPORTUNITY.recommendation!, citations: [] },
  ]) {
    assert.throws(
      () => buildBankCrossSellRuntimeSpec(APP, { ...OPPORTUNITY, recommendation }, 'crm'),
      /not eligible for governed action/,
    );
  }
});

test('runtime insertion preserves unrelated actions and graph edges', () => {
  const unrelated = {
    id: 'existing-action',
    label: 'Existing action',
    kind: 'action' as const,
    actionId: 'crm.create-task' as const,
    connectorId: 'crm',
    approvalStepId: 'review',
    command: {
      operation: 'create-task',
      subject: 'Existing',
      useCase: 'bank-cross-sell',
      kind: 'call',
      accountId: 'existing',
    },
  };
  const app = {
    ...APP,
    steps: [APP.steps[0], unrelated, APP.steps[1], APP.steps[2]],
    edges: [
      { from: 'read', to: 'existing-action' },
      { from: 'existing-action', to: 'review' },
      { from: 'review', to: 'output' },
    ],
  };
  const runtime = buildBankCrossSellRuntimeSpec(app, OPPORTUNITY, 'crm');
  assert.ok(runtime.steps.some((step) => step.id === 'existing-action'));
  assert.ok(runtime.edges.some((edge) => edge.from === 'read' && edge.to === 'existing-action'));
  assert.ok(runtime.edges.some((edge) => edge.from === 'existing-action' && edge.to === 'review'));
});

test('approval rebuild uses the frozen product when live source recommendations drift', () => {
  const frozen = freezeBankCrossSellRunSnapshot(OPPORTUNITY, 'crm');
  const changedLiveView = {
    ...OPPORTUNITY,
    recommendation: { ...OPPORTUNITY.recommendation!, product: 'Different future product' },
  };
  assert.notEqual(changedLiveView.recommendation.product, frozen.recommendation.product);
  const runtime = buildBankCrossSellRuntimeSpecFromSnapshot(APP, frozen);
  const action = runtime.steps.find((step) => step.kind === 'action');
  assert.ok(action && action.kind === 'action');
  assert.equal(action.command.subject, 'Discuss the approved Group Term');
  assert.equal(action.command.accountId, '7');
  assert.deepEqual(parseBankCrossSellRunSnapshot(frozen), frozen);
  assert.equal(
    parseBankCrossSellRunSnapshot({
      ...frozen,
      action: { ...frozen.action, accountId: 'another-customer' },
    }),
    null,
  );
  for (const malformed of [
    {},
    { ...frozen, recommendation: null },
    { ...frozen, recommendation: { ...frozen.recommendation, citations: [null] } },
    { ...frozen, source: { kind: 'live' } },
    Object.defineProperty({}, 'version', {
      get: () => {
        throw new Error('hostile getter');
      },
    }),
  ]) {
    assert.doesNotThrow(() => parseBankCrossSellRunSnapshot(malformed));
    assert.equal(parseBankCrossSellRunSnapshot(malformed), null);
  }
});

test('canonical run evidence advances through approval and action receipt', () => {
  const receipt = {
    actionId: 'crm.create-task' as const,
    label: 'Create CRM follow-up task',
    system: 'CRM',
    orgId: 'org_bank',
    runId: 'run_1',
    stepId: 'cross-sell-writeback',
    connectorId: 'crm-connector',
    target: '7',
    idempotencyKey: 'action:key',
    status: 'executed' as const,
    executedAt: '2026-07-23T00:02:00.000Z',
    approval: { stepId: 'review', evidence: 'approved', reviewer: 'rm@example.test' },
    providerReceipt: { signature: 'sig' },
  };
  const evidence = projectBankCrossSellEvidence(OPPORTUNITY, {
    id: 'run_1',
    appId: APP.id,
    status: 'done',
    input: { customerId: '7' },
    outcome: '',
    provenance: null,
    startedAt: '2026-07-23T00:00:00.000Z',
    finishedAt: '2026-07-23T00:03:00.000Z',
    steps: [
      {
        id: 'review',
        kind: 'human',
        label: 'RM review',
        status: 'done',
        detail: 'approved by reviewer — note: customer consent confirmed',
        reviewer: 'rm@example.test',
        finishedAt: '2026-07-23T00:01:00.000Z',
      },
      {
        id: 'cross-sell-writeback',
        kind: 'action',
        label: 'Write',
        status: 'done',
        actionReceipt: receipt,
      },
    ],
  });
  assert.equal(evidence.opportunity.rmDecision.status, 'accepted');
  assert.equal(evidence.opportunity.actionReceipt?.target, '7');
  assert.equal(evidence.evidence.phase, 'needs-outcome');
});
