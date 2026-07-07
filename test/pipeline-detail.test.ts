import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeTabForPath, pipelineTabHref, pipelineTabs } from '../src/lib/pipeline-detail.ts';

// The per-pipeline detail tab model (mirrors app-lifecycle). Pure — drives the scoped SubNav and keeps
// every tab deep-linkable + Back-coherent.

test('pipelineTabs: the tabs in reading order, each with a hint', () => {
  const tabs = pipelineTabs('pl_42');
  assert.deepEqual(
    tabs.map((t) => t.tab),
    ['overview', 'routing', 'policy', 'guardrails', 'quality', 'drift', 'observability', 'audit', 'cost', 'api', 'versions'],
  );
  assert.ok(tabs.every((t) => t.hint.length > 0), 'every tab carries a helper hint');
});

test('pipelineTabHref: overview is the bare pipeline path; others hang off it', () => {
  assert.equal(pipelineTabHref('pl_42', 'overview'), '/pipelines/pl_42');
  assert.equal(pipelineTabHref('pl_42', 'routing'), '/pipelines/pl_42/routing');
  assert.equal(pipelineTabHref('pl_42', 'versions'), '/pipelines/pl_42/versions');
});

test('pipelineTabHref: encodes the id', () => {
  assert.equal(pipelineTabHref('pl a/b', 'overview'), '/pipelines/pl%20a%2Fb');
});

test('activeTabForPath: bare pipeline path selects overview', () => {
  assert.equal(activeTabForPath('/pipelines/pl_42', 'pl_42'), 'overview');
});

test('activeTabForPath: a named sub-segment selects that tab', () => {
  assert.equal(activeTabForPath('/pipelines/pl_42/routing', 'pl_42'), 'routing');
  assert.equal(activeTabForPath('/pipelines/pl_42/guardrails', 'pl_42'), 'guardrails');
  assert.equal(activeTabForPath('/pipelines/pl_42/versions', 'pl_42'), 'versions');
  assert.equal(activeTabForPath('/pipelines/pl_42/observability', 'pl_42'), 'observability');
});

test('activeTabForPath: a deep sub-path still resolves to its tab', () => {
  assert.equal(activeTabForPath('/pipelines/pl_42/versions/v3', 'pl_42'), 'versions');
});

test('activeTabForPath: an unknown sub-segment falls back to overview', () => {
  assert.equal(activeTabForPath('/pipelines/pl_42/nonsense', 'pl_42'), 'overview');
});

test('activeTabForPath: a path for a different pipeline is not claimed', () => {
  assert.equal(activeTabForPath('/pipelines/other', 'pl_42'), null);
  assert.equal(activeTabForPath('/gateways', 'pl_42'), null);
});
