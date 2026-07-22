import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INSIGHTS_AI_DESTINATIONS,
  INSIGHTS_QUALITY_DESTINATIONS,
  insightsAiDestination,
  insightsQualityDestination,
  insightsRouteWithSearchParams,
  isInsightsQualityEntityDetailPath,
  legacyInsightsAiRoute,
} from '../src/lib/insights-routes.ts';

test('Insights AI destinations expose the durable level-three places', () => {
  assert.deepEqual(
    INSIGHTS_AI_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['overview', '/insights/ai/overview'],
      ['traces', '/insights/ai/traces'],
      ['prompt-registry', '/insights/ai/prompt-registry'],
      ['langfuse-prompts', '/insights/ai/langfuse-prompts'],
      ['langfuse-datasets', '/insights/ai/langfuse-datasets'],
      ['copilot', '/insights/ai/copilot'],
    ],
  );
  assert.equal(insightsAiDestination('traces')?.label, 'Traces');
  assert.equal(insightsAiDestination('unknown'), undefined);
});

test('Insights Quality destinations keep observation separate from execution ownership', () => {
  assert.deepEqual(
    INSIGHTS_QUALITY_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['scorecards', '/insights/quality/scorecards'],
      ['drift', '/insights/quality/drift'],
      ['thresholds', '/insights/quality/thresholds'],
    ],
  );
  assert.equal(insightsQualityDestination('scorecards')?.label, 'Scorecards');
  assert.equal(insightsQualityDestination(null), undefined);
});

test('eval run entity details are distinguished from Quality leaves', () => {
  assert.equal(isInsightsQualityEntityDetailPath('/insights/quality/evals/run-1'), true);
  assert.equal(isInsightsQualityEntityDetailPath('/insights/quality/evals/run-1/'), true);
  assert.equal(isInsightsQualityEntityDetailPath('/insights/quality/evals/run-1?tab=cases'), true);
  assert.equal(isInsightsQualityEntityDetailPath('/insights/quality/scorecards'), false);
  assert.equal(isInsightsQualityEntityDetailPath('/insights/quality/evals'), false);
  assert.equal(isInsightsQualityEntityDetailPath('/insights/quality/evals/run-1/cases'), false);
});

test('legacy Insights entry routes preserve URL-owned state and rehome pipeline scorecards', () => {
  assert.equal(legacyInsightsAiRoute({}), '/insights/ai/overview');
  assert.equal(legacyInsightsAiRoute({ lfRange: '30d' }), '/insights/ai/overview?lfRange=30d');
  assert.equal(
    legacyInsightsAiRoute({ lfReg: 'datasets', lfRange: '7d' }),
    '/insights/ai/prompt-registry?lfReg=datasets&lfRange=7d',
  );
  assert.equal(
    legacyInsightsAiRoute({ pipeline: 'pipe/a' }),
    '/insights/quality/scorecards?pipeline=pipe%2Fa',
  );
  assert.equal(
    insightsRouteWithSearchParams('/insights/quality/scorecards', {
      pipeline: ['one', 'two'],
      empty: undefined,
    }),
    '/insights/quality/scorecards?pipeline=one&pipeline=two',
  );
});
