import assert from 'node:assert/strict';
import test from 'node:test';
import type { CrossSellOpportunityView } from '@/lib/bank-cross-sell-contract';
import {
  canAcceptCrossSellRecommendation,
  crossSellEvidenceState,
  validateCrossSellOpportunity,
} from '@/lib/bank-cross-sell-contract';

function opportunity(patch: Partial<CrossSellOpportunityView> = {}): CrossSellOpportunityView {
  return {
    opportunityId: 'opp_101',
    customerId: 'acct_101',
    customerName: 'Example Industries',
    relationshipManager: 'rm@example.test',
    segment: 'Enterprise',
    region: 'Mumbai',
    currentProducts: ['Current account'],
    opportunityValueInr: 2_500_000,
    source: {
      kind: 'live',
      customerDomain: 'customer data',
      eligibilityDomain: 'pricing rate card',
      readAt: '2026-07-23T00:00:00.000Z',
    },
    recommendation: {
      product: 'Group Term Life',
      rationale: 'The approved rate card supports this customer segment.',
      confidence: 0.84,
      eligible: true,
      constraints: [],
      citations: [
        { source: 'CRM', record: 'accounts/acct_101', label: 'Customer relationship' },
        { source: 'Core Banking', record: 'pricing_rate_card/OYRT-31-40', label: 'Rate card' },
      ],
    },
    runId: 'apprun_101',
    rmDecision: { status: 'pending', reason: null, reviewer: null, decidedAt: null },
    actionReceipt: null,
    outcomes: [],
    ...patch,
  };
}

test('cross-sell evidence follows context, recommendation, RM decision, write-back, outcome', () => {
  const pending = opportunity();
  assert.deepEqual(crossSellEvidenceState(pending), {
    phase: 'needs-rm-decision',
    complete: false,
    missing: ['relationship manager decision'],
  });
  assert.equal(canAcceptCrossSellRecommendation(pending), true);

  const rejected = opportunity({
    rmDecision: {
      status: 'rejected',
      reason: 'Customer contact restriction is active.',
      reviewer: 'rm@example.test',
      decidedAt: '2026-07-23T00:01:00.000Z',
    },
  });
  assert.deepEqual(crossSellEvidenceState(rejected), {
    phase: 'measured',
    complete: true,
    missing: [],
  });
});

test('acceptance fails closed without eligibility, citations, or a governed run', () => {
  assert.equal(
    canAcceptCrossSellRecommendation(
      opportunity({ recommendation: { ...opportunity().recommendation!, citations: [] } }),
    ),
    false,
  );
  assert.equal(
    canAcceptCrossSellRecommendation(
      opportunity({ recommendation: { ...opportunity().recommendation!, eligible: false } }),
    ),
    false,
  );
  assert.equal(canAcceptCrossSellRecommendation(opportunity({ runId: null })), false);
});

test('validation separates RM approval, CRM execution, and customer outcome', () => {
  const invalid = opportunity({
    rmDecision: { status: 'pending', reason: null, reviewer: null, decidedAt: null },
    actionReceipt: {
      actionId: 'crm.update-opportunity',
      label: 'Update CRM opportunity',
      system: 'CRM',
      orgId: 'org_bharat',
      runId: 'apprun_101',
      stepId: 'writeback',
      connectorId: 'crm',
      target: 'opp_101',
      idempotencyKey: 'action:cross-sell-101',
      status: 'executed',
      executedAt: '2026-07-23T00:02:00.000Z',
      approval: { stepId: 'rm-review', evidence: 'approved' },
      providerReceipt: { signature: 'test' },
    },
    outcomes: [
      {
        status: 'converted',
        observedAt: '2026-07-23T00:03:00.000Z',
        value: 2_500_000,
        currency: null,
        evidenceHref: '',
      },
    ],
  });
  assert.deepEqual(validateCrossSellOpportunity(invalid), [
    'CRM write-back requires an accepted RM decision',
    'outcome evidence link is required',
    'outcome value and currency must be supplied together',
  ]);
});

test('an accepted recommendation advances from write-back to measured outcome', () => {
  const accepted = opportunity({
    rmDecision: {
      status: 'accepted',
      reason: 'Offer fits the recorded need and contact policy.',
      reviewer: 'rm@example.test',
      decidedAt: '2026-07-23T00:01:00.000Z',
    },
  });
  assert.equal(crossSellEvidenceState(accepted).phase, 'needs-writeback');

  const withReceipt = opportunity({
    ...accepted,
    actionReceipt: {
      actionId: 'crm.update-opportunity',
      label: 'Update CRM opportunity',
      system: 'CRM',
      orgId: 'org_bharat',
      runId: 'apprun_101',
      stepId: 'writeback',
      connectorId: 'crm',
      target: 'opp_101',
      idempotencyKey: 'action:cross-sell-101',
      status: 'executed',
      executedAt: '2026-07-23T00:02:00.000Z',
      approval: { stepId: 'rm-review', evidence: 'approved' },
      providerReceipt: { signature: 'test' },
    },
  });
  assert.equal(crossSellEvidenceState(withReceipt).phase, 'needs-outcome');

  const measured = opportunity({
    ...withReceipt,
    outcomes: [
      {
        status: 'converted',
        observedAt: '2026-07-23T00:03:00.000Z',
        value: 2_500_000,
        currency: 'INR',
        evidenceHref: '/solutions/apps/app_101/runs/apprun_101',
      },
    ],
  });
  assert.deepEqual(crossSellEvidenceState(measured), {
    phase: 'measured',
    complete: true,
    missing: [],
  });
  assert.deepEqual(validateCrossSellOpportunity(measured), []);
});
