import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import {
  CrossSellOpportunityQueue,
  type CrossSellQueueRow,
} from '@/components/app-use/CrossSellOpportunityQueue';
import {
  CrossSellCustomerJourney,
  CrossSellSourceUnavailable,
} from '@/components/app-use/CrossSellCustomerJourney';
import { CrossSellOutcomeEntry } from '@/components/app-use/CrossSellOutcomeEntry';
import type { ActionReceipt } from '@/lib/action-contract';

const receipt: ActionReceipt = {
  actionId: 'crm.create-task',
  label: 'Create CRM follow-up task',
  system: 'CRM',
  orgId: 'org_bank',
  runId: 'run_7',
  stepId: 'cross-sell-writeback',
  connectorId: 'crm',
  target: '7',
  idempotencyKey: 'action:receipt-7',
  status: 'executed',
  executedAt: '2026-07-23T00:15:00.000Z',
  approval: {
    stepId: 'rm-review',
    evidence: 'Approved by the relationship manager',
    reviewer: 'rm@example.test',
  },
  providerReceipt: { signature: 'signed' },
};

function row(): CrossSellQueueRow {
  return {
    opportunity: {
      opportunityId: 'candidate:7',
      customerId: '7',
      customerName: 'Alpha Industries',
      relationshipManager: 'rm@example.test',
      segment: 'Enterprise',
      region: 'Mumbai',
      currentProducts: ['Current account'],
      opportunityValueInr: 0,
      source: {
        kind: 'live',
        customerDomain: 'customer data',
        eligibilityDomain: 'pricing rate card',
        readAt: '2026-07-23T00:00:00.000Z',
      },
      recommendation: {
        product: 'Group Term Life',
        rationale: 'The live rate card and customer facts satisfy the approved rule.',
        confidence: 0.84,
        eligible: true,
        constraints: [],
        citations: [
          { source: 'customer data', record: 'accounts/7', label: 'Customer relationship' },
          { source: 'pricing rate card', record: 'rates/1', label: 'Eligibility rule' },
        ],
      },
      runId: 'run_7',
      rmDecision: { status: 'pending', reason: null, reviewer: null, decidedAt: null },
      actionReceipt: null,
      outcomes: [],
    },
    evidence: {
      phase: 'needs-rm-decision',
      complete: false,
      missing: ['relationship manager decision'],
    },
  };
}

test('RM queue exposes live evidence, review state and a deep-linked customer decision', () => {
  const html = renderToStaticMarkup(
    createElement(CrossSellOpportunityQueue, {
      rows: [row()],
      customerHrefBase: '/app/cross-sell/customers/',
    }),
  );
  assert.match(html, /Live sources only/);
  assert.match(html, /Alpha Industries/);
  assert.match(html, /Group Term Life/);
  assert.match(html, /Ready for review/);
  assert.match(html, /href="\/app\/cross-sell\/customers\/7"/);
  assert.match(html, /Not measured/);
  assert.doesNotMatch(html, /sample|synthetic|fallback/i);
});

test('RM queue fails honestly when no live opportunities are available', () => {
  const html = renderToStaticMarkup(
    createElement(CrossSellOpportunityQueue, {
      rows: [],
      customerHrefBase: '/app/cross-sell/customers/',
    }),
  );
  assert.match(html, /No live customer opportunities are available/);
  assert.match(html, /customer and eligibility source bindings/);
  assert.doesNotMatch(html, /Customer 1001|Aarav Sharma/);
});

test('customer journey explains recommendation, citations, governance and the human decision', () => {
  const data = row();
  const html = renderToStaticMarkup(
    createElement(CrossSellCustomerJourney, {
      slug: 'cross-sell',
      opportunity: data.opportunity,
      evidence: data.evidence,
    }),
  );
  assert.match(html, /Recommended customer conversation/);
  assert.match(html, /Nothing is written to CRM until a relationship manager approves/);
  assert.match(html, /Customer relationship/);
  assert.match(html, /Eligibility rule/);
  assert.match(html, /Your decision/);
  assert.match(html, /Approve and create CRM task/);
  assert.match(html, /Governed journey/);
  assert.doesNotMatch(html, /sample|synthetic|fallback/i);
});

test('source outage is explicit and never replaced by demo recommendations', () => {
  const html = renderToStaticMarkup(createElement(CrossSellSourceUnavailable));
  assert.match(html, /Live opportunity data is unavailable/);
  assert.match(html, /customer and eligibility source bindings/);
  assert.doesNotMatch(html, /Alpha Industries|Group Term Life|sample|synthetic|fallback/i);
});

test('completed CRM execution opens the receipt-correlated customer result journey', () => {
  const data = row();
  data.opportunity.rmDecision = {
    status: 'accepted',
    reason: 'The recommendation matches the customer need.',
    reviewer: 'rm@example.test',
    decidedAt: '2026-07-23T00:10:00.000Z',
  };
  data.opportunity.actionReceipt = receipt;
  data.evidence = {
    phase: 'needs-outcome',
    complete: false,
    missing: ['receipt-correlated customer outcome'],
  };

  const html = renderToStaticMarkup(
    createElement(CrossSellCustomerJourney, {
      slug: 'cross-sell',
      opportunity: data.opportunity,
      evidence: data.evidence,
    }),
  );
  assert.match(html, /Execution receipt/);
  assert.match(html, /Record what happened/);
  assert.match(html, /The CRM task is complete/);
  assert.match(html, /Business result not known/);
  assert.match(html, /No customer result has been observed yet/);
  assert.match(html, /Waiting for the customer result/);
  assert.doesNotMatch(html, /Business result recorded/);
});

test('customer result form uses the canonical receipt locator without browser-supplied identity', () => {
  const html = renderToStaticMarkup(
    createElement(CrossSellOutcomeEntry, {
      slug: 'bank cross-sell',
      customerId: 'customer/7',
      receipt,
      mode: 'initial',
    }),
  );
  for (const copy of [
    'Customer accepted',
    'Customer declined',
    'Customer converted',
    'This is the customer result, not the relationship manager decision',
    'What confirms this result?',
    'Revenue before (optional)',
    'Revenue after (optional)',
  ]) {
    assert.match(html, new RegExp(copy.replace(/[?()]/g, '\\$&')));
  }
  assert.match(html, /\/app\/bank%20cross-sell\/customers\/customer%2F7/);
  assert.doesNotMatch(html, /Account cured|Claim settled/);
  assert.doesNotMatch(html, /name="(?:orgId|runId|stepId|receipt|eventId)"/);
});

test('an observed response stays separate from CRM completion and suggests conversion next', () => {
  const data = row();
  data.opportunity.rmDecision = {
    status: 'accepted',
    reason: 'The recommendation matches the customer need.',
    reviewer: 'rm@example.test',
    decidedAt: '2026-07-23T00:10:00.000Z',
  };
  data.opportunity.actionReceipt = receipt;
  data.opportunity.outcomes = [
    {
      status: 'accepted',
      observedAt: '2026-07-23T00:30:00.000Z',
      value: 125_000,
      currency: 'INR',
      evidenceHref: '/app/cross-sell/customers/7',
    },
  ];
  data.evidence = { phase: 'measured', complete: true, missing: [] };

  const html = renderToStaticMarkup(
    createElement(CrossSellCustomerJourney, {
      slug: 'cross-sell',
      opportunity: data.opportunity,
      evidence: data.evidence,
    }),
  );
  assert.match(html, /Record the confirmed conversion/);
  assert.match(html, /value="converted" selected=""/);
  assert.match(html, /Observed customer results/);
  assert.match(html, /accepted/);
  assert.match(html, /INR 125,000/);
  assert.match(html, /CRM completion confirms the system change/);
});

test('a terminal customer result remains visible without offering a duplicate observation', () => {
  const data = row();
  data.opportunity.rmDecision = {
    status: 'accepted',
    reason: 'The recommendation matches the customer need.',
    reviewer: 'rm@example.test',
    decidedAt: '2026-07-23T00:10:00.000Z',
  };
  data.opportunity.actionReceipt = receipt;
  data.opportunity.outcomes = [
    {
      status: 'converted',
      observedAt: '2026-07-23T00:30:00.000Z',
      value: 125_000,
      currency: 'INR',
      evidenceHref: '/app/cross-sell/customers/7',
    },
  ];
  data.evidence = { phase: 'measured', complete: true, missing: [] };

  const html = renderToStaticMarkup(
    createElement(CrossSellCustomerJourney, {
      slug: 'cross-sell',
      opportunity: data.opportunity,
      evidence: data.evidence,
    }),
  );
  assert.match(html, /Observed customer results/);
  assert.match(html, /converted/);
  assert.doesNotMatch(html, /Record what happened|Record the confirmed conversion/);
});
