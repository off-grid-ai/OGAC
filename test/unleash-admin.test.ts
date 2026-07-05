import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCreateFeaturePayload,
  buildRolloutStrategy,
  buildVariantsPayload,
  envStrategiesPath,
  envTogglePath,
  envVariantsPath,
  featurePath,
  featuresPath,
  findRolloutStrategyId,
  readRolloutPercent,
  strategyPath,
  toFlagDetail,
  toFlagList,
  type UnleashFeatureDetail,
} from '../src/lib/unleash-admin.ts';

// PURE unit tests for the Unleash Admin API shaping — no network. These lock down the payload
// builders and the response → FlagDetail transforms that the thin I/O client composes.

test('buildVariantsPayload auto-balances variable weights to sum 1000', () => {
  const out = buildVariantsPayload([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
  assert.equal(out.length, 3);
  assert.equal(out.reduce((s, v) => s + v.weight, 0), 1000, 'weights sum to 1000');
  // 1000/3 → 334,333,333 (remainder to the first bucket)
  assert.deepEqual(out.map((v) => v.weight), [334, 333, 333]);
  assert.ok(out.every((v) => v.weightType === 'variable' && v.stickiness === 'default'));
});

test('buildVariantsPayload honors fix weights and balances the remainder', () => {
  const out = buildVariantsPayload([
    { name: 'pinned', weight: 200, weightType: 'fix' },
    { name: 'x' },
    { name: 'y' },
  ]);
  const byName = Object.fromEntries(out.map((v) => [v.name, v.weight]));
  assert.equal(byName.pinned, 200);
  // remaining 800 split across two variable buckets
  assert.equal(byName.x + byName.y, 800);
  assert.equal(byName.x, 400);
});

test('buildVariantsPayload clamps overweight fix and zeros the variable pool', () => {
  const out = buildVariantsPayload([
    { name: 'huge', weight: 5000, weightType: 'fix' },
    { name: 'leftover' },
  ]);
  const byName = Object.fromEntries(out.map((v) => [v.name, v.weight]));
  assert.equal(byName.huge, 1000, 'fix weight clamped to 1000');
  assert.equal(byName.leftover, 0, 'no budget left for variable buckets');
});

test('buildVariantsPayload preserves payloads and rejects bad names', () => {
  const out = buildVariantsPayload([
    { name: 'json', payload: { type: 'json', value: '{"a":1}' } },
  ]);
  assert.deepEqual(out[0].payload, { type: 'json', value: '{"a":1}' });
  assert.throws(() => buildVariantsPayload([{ name: 'bad name!' }]), /invalid variant name/);
});

test('buildVariantsPayload returns empty for no variants', () => {
  assert.deepEqual(buildVariantsPayload([]), []);
});

test('buildRolloutStrategy clamps percent and defaults stickiness', () => {
  assert.deepEqual(buildRolloutStrategy(37, { groupId: 'flagx' }), {
    name: 'flexibleRollout',
    parameters: { rollout: '37', stickiness: 'default', groupId: 'flagx' },
  });
  assert.equal(buildRolloutStrategy(150).parameters.rollout, '100');
  assert.equal(buildRolloutStrategy(-5).parameters.rollout, '0');
  assert.equal(buildRolloutStrategy(33.7).parameters.rollout, '34', 'rounds');
  assert.equal(buildRolloutStrategy(NaN).parameters.rollout, '0');
});

test('readRolloutPercent / findRolloutStrategyId read strategies', () => {
  const strategies = [
    { id: 's1', name: 'default' },
    { id: 's2', name: 'flexibleRollout', parameters: { rollout: '25', stickiness: 'default', groupId: 'g' } },
  ];
  assert.equal(readRolloutPercent(strategies), 25);
  assert.equal(findRolloutStrategyId(strategies), 's2');
  assert.equal(readRolloutPercent(undefined), null);
  assert.equal(readRolloutPercent([{ name: 'default' }]), null);
  assert.equal(findRolloutStrategyId([{ name: 'default' }]), null);
});

test('buildCreateFeaturePayload shapes the create body', () => {
  assert.deepEqual(buildCreateFeaturePayload('agent-code-exec', 'gates exec'), {
    name: 'agent-code-exec',
    description: 'gates exec',
    type: 'release',
    impressionData: false,
  });
});

test('toFlagDetail pulls the selected environment state, variants and rollout', () => {
  const feature: UnleashFeatureDetail = {
    name: 'f1',
    description: 'a flag',
    environments: [
      { name: 'development', enabled: true, strategies: [
        { id: 's', name: 'flexibleRollout', parameters: { rollout: '40', stickiness: 'default', groupId: 'f1' } },
      ], variants: [{ name: 'A', weight: 1000 }] },
      { name: 'production', enabled: false },
    ],
  };
  const dev = toFlagDetail(feature, 'development');
  assert.equal(dev.enabled, true);
  assert.equal(dev.rolloutPercent, 40);
  assert.deepEqual(dev.variants, [{ name: 'A', weight: 1000 }]);
  assert.equal(dev.source, 'unleash');

  const prod = toFlagDetail(feature, 'production');
  assert.equal(prod.enabled, false);
  assert.equal(prod.rolloutPercent, null);
  assert.deepEqual(prod.variants, []);
});

test('toFlagDetail falls back to feature-level variants when env has none', () => {
  const feature: UnleashFeatureDetail = {
    name: 'f2',
    variants: [{ name: 'top', weight: 1000 }],
    environments: [{ name: 'development', enabled: true }],
  };
  assert.deepEqual(toFlagDetail(feature, 'development').variants, [{ name: 'top', weight: 1000 }]);
});

test('toFlagList projects and sorts features for an env', () => {
  const list = toFlagList(
    [
      { name: 'zebra', environments: [{ name: 'development', enabled: true }] },
      { name: 'alpha', description: 'first', environments: [{ name: 'development', enabled: false }] },
      { name: 'other-env-only', environments: [{ name: 'production', enabled: true }] },
    ],
    'development',
  );
  assert.deepEqual(list, [
    { key: 'alpha', enabled: false, description: 'first' },
    { key: 'other-env-only', enabled: false, description: '' },
    { key: 'zebra', enabled: true, description: '' },
  ]);
});

test('path builders assemble Admin API URLs and URL-encode names', () => {
  assert.equal(featuresPath('default'), '/api/admin/projects/default/features');
  assert.equal(featurePath('default', 'a b'), '/api/admin/projects/default/features/a%20b');
  assert.equal(
    envTogglePath('default', 'f', 'development', true),
    '/api/admin/projects/default/features/f/environments/development/on',
  );
  assert.equal(
    envTogglePath('default', 'f', 'development', false),
    '/api/admin/projects/default/features/f/environments/development/off',
  );
  assert.equal(
    envVariantsPath('default', 'f', 'development'),
    '/api/admin/projects/default/features/f/environments/development/variants',
  );
  assert.equal(
    envStrategiesPath('default', 'f', 'development'),
    '/api/admin/projects/default/features/f/environments/development/strategies',
  );
  assert.equal(
    strategyPath('default', 'f', 'development', 's2'),
    '/api/admin/projects/default/features/f/environments/development/strategies/s2',
  );
});
