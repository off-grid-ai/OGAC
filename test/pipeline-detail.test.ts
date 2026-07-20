import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeTabForPath,
  pipelineNavGroups,
  pipelineTabHref,
  pipelineTabs,
  pipelineTransitions,
} from '../src/lib/pipeline-detail.ts';

// The per-pipeline detail model is pure. It drives the entity-local rail and keeps every destination
// deep-linkable + Back-coherent.

test('pipelineTabs: the tabs in reading order, each with a hint', () => {
  const tabs = pipelineTabs('pl_42');
  assert.deepEqual(
    tabs.map((t) => t.tab),
    [
      'overview',
      'routing',
      'api',
      'versions',
      'policy',
      'guardrails',
      'quality',
      'drift',
      'observability',
      'audit',
      'cost',
    ],
  );
  assert.ok(
    tabs.every((t) => t.hint.length > 0),
    'every tab carries a helper hint',
  );
});

test('pipelineNavGroups: groups every non-overview route by operator job', () => {
  const groups = pipelineNavGroups('pl_42');
  assert.deepEqual(
    groups.map(({ id, label, tabs }) => ({
      id,
      label,
      tabs: tabs.map((tab) => [tab.tab, tab.label, tab.href]),
    })),
    [
      {
        id: 'configure',
        label: 'Configure',
        tabs: [
          ['routing', 'Gateway & routing', '/runtime/pipelines/pl_42/routing'],
          ['api', 'API', '/runtime/pipelines/pl_42/api'],
          ['versions', 'Versions', '/runtime/pipelines/pl_42/versions'],
        ],
      },
      {
        id: 'govern',
        label: 'Govern',
        tabs: [
          ['policy', 'Policy', '/runtime/pipelines/pl_42/policy'],
          ['guardrails', 'Guardrails', '/runtime/pipelines/pl_42/guardrails'],
        ],
      },
      {
        id: 'assure',
        label: 'Assure',
        tabs: [
          ['quality', 'Quality', '/runtime/pipelines/pl_42/quality'],
          ['drift', 'Drift', '/runtime/pipelines/pl_42/drift'],
        ],
      },
      {
        id: 'observe',
        label: 'Observe',
        tabs: [
          ['observability', 'Observability', '/runtime/pipelines/pl_42/observability'],
          ['audit', 'Audit', '/runtime/pipelines/pl_42/audit'],
          ['cost', 'Cost', '/runtime/pipelines/pl_42/cost'],
        ],
      },
    ],
  );

  const groupedTabs = groups.flatMap((group) => group.tabs.map((tab) => tab.tab));
  assert.deepEqual(
    groupedTabs,
    pipelineTabs('pl_42')
      .slice(1)
      .map((tab) => tab.tab),
  );
});

test('pipelineTabHref: overview is the bare pipeline path; others hang off it', () => {
  assert.equal(pipelineTabHref('pl_42', 'overview'), '/runtime/pipelines/pl_42');
  assert.equal(pipelineTabHref('pl_42', 'routing'), '/runtime/pipelines/pl_42/routing');
  assert.equal(pipelineTabHref('pl_42', 'versions'), '/runtime/pipelines/pl_42/versions');
});

test('pipelineTabHref: encodes the id', () => {
  assert.equal(pipelineTabHref('pl a/b', 'overview'), '/runtime/pipelines/pl%20a%2Fb');
});

test('activeTabForPath: bare pipeline path selects overview', () => {
  assert.equal(activeTabForPath('/runtime/pipelines/pl_42', 'pl_42'), 'overview');
});

test('activeTabForPath: a named sub-segment selects that tab', () => {
  assert.equal(activeTabForPath('/runtime/pipelines/pl_42/routing', 'pl_42'), 'routing');
  assert.equal(activeTabForPath('/runtime/pipelines/pl_42/guardrails', 'pl_42'), 'guardrails');
  assert.equal(activeTabForPath('/runtime/pipelines/pl_42/versions', 'pl_42'), 'versions');
  assert.equal(
    activeTabForPath('/runtime/pipelines/pl_42/observability', 'pl_42'),
    'observability',
  );
});

test('activeTabForPath: a deep sub-path still resolves to its tab', () => {
  assert.equal(activeTabForPath('/runtime/pipelines/pl_42/versions/v3', 'pl_42'), 'versions');
});

test('activeTabForPath: an unknown sub-segment falls back to overview', () => {
  assert.equal(activeTabForPath('/runtime/pipelines/pl_42/nonsense', 'pl_42'), 'overview');
});

test('activeTabForPath: a path for a different pipeline is not claimed', () => {
  assert.equal(activeTabForPath('/runtime/pipelines/other', 'pl_42'), null);
  assert.equal(activeTabForPath('/gateway/registry', 'pl_42'), null);
});

// ─── pipelineTransitions — the legal lifecycle actions from each status (drives Overview actions) ──

test('pipelineTransitions: a draft can be published or archived', () => {
  const t = pipelineTransitions('draft');
  assert.deepEqual(
    t.map((x) => x.action),
    ['publish', 'archive'],
  );
  assert.equal(t.find((x) => x.action === 'publish')?.to, 'published');
  assert.equal(t.find((x) => x.action === 'archive')?.to, 'archived');
  assert.ok(t.every((x) => x.label && x.hint));
});

test('pipelineTransitions: a published pipeline can only be archived (not re-published)', () => {
  const t = pipelineTransitions('published');
  assert.deepEqual(
    t.map((x) => x.action),
    ['archive'],
  );
});

test('pipelineTransitions: an archived pipeline restores to draft', () => {
  const t = pipelineTransitions('archived');
  assert.deepEqual(
    t.map((x) => x.action),
    ['unarchive'],
  );
  assert.equal(t[0].to, 'draft');
});

test('pipelineTransitions: an unknown status offers nothing', () => {
  assert.deepEqual(pipelineTransitions('bogus'), []);
});
