import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleBankCrossSellOpportunities } from '@/lib/bank-cross-sell-opportunity';

test('assembles an eligible RM opportunity from live customer and rate-card facts', () => {
  const views = assembleBankCrossSellOpportunities({
    customerDomain: 'customer data',
    eligibilityDomain: 'pricing rate card',
    customerResource: 'accounts',
    eligibilityResource: 'pricing_rate_card',
    readAt: '2026-07-23T00:00:00.000Z',
    customerRows: [
      {
        id: 1,
        name: 'Alpha Ltd',
        industry: 'Insurance',
        tier: 'enterprise',
        arr: 2_000_000,
        owner: 'RM A',
      },
      {
        id: 2,
        name: 'Beta Ltd',
        industry: 'Insurance',
        tier: 'enterprise',
        arr: 1_000_000,
        owner: 'RM B',
      },
      {
        id: 3,
        name: 'Gamma Ltd',
        industry: 'Banking',
        tier: 'mid-market',
        arr: 900_000,
        owner: 'RM C',
      },
    ],
    eligibilityRows: [
      { scheme_type: 'Scheme B', age_band: '31-40', base_rate_per_mille: 1.4, min_group_size: 20 },
      { scheme_type: 'Scheme A', age_band: '31-40', base_rate_per_mille: 1.2, min_group_size: 10 },
    ],
  });

  assert.equal(views.length, 3);
  assert.equal(views[0].source.kind, 'live');
  assert.equal(views[0].recommendation?.product, 'Scheme A');
  assert.equal(views[0].recommendation?.eligible, true);
  assert.equal(views[2].recommendation?.eligible, false);
  assert.deepEqual(views[2].recommendation?.constraints, [
    'The governed cohort policy currently prioritises Insurance.',
  ]);
  assert.deepEqual(
    views[0].recommendation?.citations.map((citation) => citation.record),
    ['accounts/1', 'pricing_rate_card/2'],
  );
});

test('never manufactures an opportunity when the customer source lacks an identity', () => {
  const views = assembleBankCrossSellOpportunities({
    customerDomain: 'customer data',
    eligibilityDomain: 'pricing rate card',
    customerResource: 'accounts',
    eligibilityResource: 'pricing_rate_card',
    readAt: '2026-07-23T00:00:00.000Z',
    customerRows: [{ name: 'Missing id' }, { id: '2' }],
    eligibilityRows: [{ scheme_type: 'Scheme A', min_group_size: 10 }],
  });
  assert.deepEqual(views, []);
});
