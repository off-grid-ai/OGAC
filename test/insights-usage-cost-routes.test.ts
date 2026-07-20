import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INSIGHTS_COST_DESTINATIONS,
  INSIGHTS_USAGE_DESTINATIONS,
  insightsCostDestination,
  insightsUsageCostRouteWithSearchParams,
  insightsUsageDestination,
} from '../src/lib/insights-usage-cost-routes.ts';

test('Usage and Cost expose each durable management leaf once', () => {
  assert.deepEqual(
    INSIGHTS_USAGE_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['overview', '/insights/usage/overview'],
      ['traffic', '/insights/usage/traffic'],
      ['latency', '/insights/usage/latency'],
      ['adoption', '/insights/usage/adoption'],
      ['dashboards', '/insights/usage/dashboards'],
    ],
  );
  assert.deepEqual(
    INSIGHTS_COST_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['overview', '/insights/cost/overview'],
      ['users', '/insights/cost/users'],
      ['projects', '/insights/cost/projects'],
      ['models', '/insights/cost/models'],
    ],
  );
});

test('Usage and Cost destination lookup accepts known leaves and rejects unknown leaves', () => {
  assert.equal(insightsUsageDestination('traffic'), INSIGHTS_USAGE_DESTINATIONS[1]);
  assert.equal(insightsCostDestination('models'), INSIGHTS_COST_DESTINATIONS[3]);
  assert.equal(insightsUsageDestination('date'), undefined);
  assert.equal(insightsCostDestination('status'), undefined);
  assert.equal(insightsCostDestination(undefined), undefined);
});

test('durable leaf routes retain URL-owned date, pipeline, status, and repeated filters', () => {
  assert.equal(
    insightsUsageCostRouteWithSearchParams('/insights/usage/overview', {
      range: '7d',
      pipeline: 'claims & review',
      status: 'blocked',
      model: ['local', 'hosted'],
      empty: undefined,
    }),
    '/insights/usage/overview?range=7d&pipeline=claims+%26+review&status=blocked&model=local&model=hosted',
  );
  assert.equal(
    insightsUsageCostRouteWithSearchParams('/insights/cost/overview', {}),
    '/insights/cost/overview',
  );
});
