import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INSIGHTS_AI_DESTINATIONS,
  INSIGHTS_QUALITY_DESTINATIONS,
  insightsAiDestination,
  insightsQualityDestination,
  isInsightsQualityEntityDetailPath,
} from '../src/lib/insights-routes.ts';

test('Insights AI destinations expose the durable level-three places', () => {
  assert.deepEqual(
    INSIGHTS_AI_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['overview', '/insights/ai/overview'],
      ['traces', '/insights/ai/traces'],
      ['prompt-registry', '/insights/ai/prompt-registry'],
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
