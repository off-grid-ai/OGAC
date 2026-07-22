import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import {
  CrossSellOpportunityQueue,
  type CrossSellQueueRow,
} from '@/components/app-use/CrossSellOpportunityQueue';
import { CrossSellCustomerJourney } from '@/components/app-use/CrossSellCustomerJourney';

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
