import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeDeployments,
  bindablePairCount,
  buildSolutionsFlow,
  type SolutionsFlowInput,
} from '../src/lib/solutions-flow.ts';

// The Solutions section was unreadable because nothing said how Blueprints, Apps and Deployments
// relate, and an empty stage simply showed an empty list. These tests lock the two things that fix
// that: all three stages are ALWAYS present in chain order, and an un-deployable org is told the
// specific precondition it is missing rather than shown a blank page.

const base: SolutionsFlowInput = {
  blueprints: [],
  apps: [],
  deployments: [],
  candidates: [],
  templateCount: 0,
};

const flow = (over: Partial<SolutionsFlowInput> = {}) => buildSolutionsFlow({ ...base, ...over });

test('all three stages are always present, in chain order, even when empty', () => {
  // A stage that vanishes when empty is how the relationship became invisible.
  assert.deepEqual(
    flow().stages.map((s) => s.id),
    ['blueprint', 'app', 'deployment'],
  );
  assert.deepEqual(
    flow({ blueprints: [{ id: 'b', adoptable: true }] }).stages.map((s) => s.id),
    ['blueprint', 'app', 'deployment'],
  );
});

test('every stage explains what it IS, so the section is self-describing', () => {
  for (const stage of flow().stages) {
    assert.ok(stage.whatItIs.length > 40, `${stage.id} must explain itself`);
    assert.ok(stage.action.label && stage.action.href, `${stage.id} must offer a next step`);
  }
});

test('an empty org: every stage reads empty and points at how to start', () => {
  const stages = flow().stages;
  assert.deepEqual(
    stages.map((s) => s.state),
    ['empty', 'empty', 'blocked'],
  );
  assert.equal(stages[0].action.label, 'Create a blueprint');
  assert.equal(stages[1].action.href, '/solutions/apps/new');
  assert.match(stages[2].blockedReason ?? '', /no blueprints to adopt/i);
});

test('blueprints but no app: deployment names the APP as the missing precondition', () => {
  const stages = flow({ blueprints: [{ id: 'b1', adoptable: false }] }).stages;
  const dep = stages[2];
  assert.equal(dep.state, 'blocked');
  assert.match(dep.blockedReason ?? '', /needs an App to implement it/i);
});

test('blueprint + app but NO compatible pair: says what to inspect instead of showing nothing', () => {
  // This is the case that previously rendered a bare "No blueprints are deployed yet" and left the
  // operator with no idea why binding was impossible.
  const stages = flow({
    blueprints: [{ id: 'b1', adoptable: false }],
    apps: [{ id: 'a1', published: true }],
    candidates: [{ appId: 'a1', compatibleBlueprintIds: [] }],
  }).stages;
  const dep = stages[2];
  assert.equal(dep.state, 'blocked');
  assert.match(dep.blockedReason ?? '', /No App currently satisfies a blueprint contract/i);
  assert.match(dep.blockedReason ?? '', /data domains, actions or pipeline/i);
  assert.equal(dep.action.label, 'See what is missing');
});

test('a compatible pair exists: deployment is READY and offers the bind action', () => {
  const stages = flow({
    blueprints: [{ id: 'b1', adoptable: true }],
    apps: [{ id: 'a1', published: true }],
    candidates: [{ appId: 'a1', compatibleBlueprintIds: ['b1'] }],
  }).stages;
  const dep = stages[2];
  assert.equal(dep.state, 'ready');
  assert.equal(dep.blockedReason, undefined);
  assert.equal(dep.action.href, '/solutions/deployed');
  assert.match(dep.action.label, /bind a blueprint/i);
});

test('an active deployment reports the real count and a measured headline', () => {
  const f = flow({
    blueprints: [{ id: 'b1', adoptable: true }],
    apps: [{ id: 'a1', published: true }],
    deployments: [{ id: 'd1', status: 'active' }],
    candidates: [{ appId: 'a1', compatibleBlueprintIds: ['b1'] }],
  });
  assert.equal(f.stages[2].count, 1);
  assert.equal(f.stages[2].state, 'ready');
  assert.match(f.headline, /1 solution is deployed and measured/i);
});

test('paused and retired deployments do not count as deployed', () => {
  const f = flow({
    blueprints: [{ id: 'b1', adoptable: true }],
    apps: [{ id: 'a1', published: true }],
    deployments: [
      { id: 'd1', status: 'paused' },
      { id: 'd2', status: 'retired' },
    ],
    candidates: [{ appId: 'a1', compatibleBlueprintIds: ['b1'] }],
  });
  // Counting a paused adoption as live would overstate what the org actually has running.
  assert.equal(f.stages[2].count, 0);
  assert.equal(activeDeployments(f.stages.length ? [{ status: 'paused' }] : []).length, 0);
});

test('apps that exist but are unpublished are flagged without being called blocked', () => {
  const app = flow({ apps: [{ id: 'a1', published: false }] }).stages[1];
  assert.equal(app.state, 'ready', 'an unpublished app is still buildable and testable');
  assert.match(app.blockedReason ?? '', /None are published/i);
});

test('bindablePairCount totals compatible pairs across apps', () => {
  assert.equal(
    bindablePairCount({
      ...base,
      candidates: [
        { appId: 'a1', compatibleBlueprintIds: ['b1', 'b2'] },
        { appId: 'a2', compatibleBlueprintIds: ['b1'] },
        { appId: 'a3', compatibleBlueprintIds: [] },
      ],
    }),
    3,
  );
});

test('the plural reads correctly for more than one deployment', () => {
  const f = flow({
    deployments: [
      { id: 'd1', status: 'active' },
      { id: 'd2', status: 'active' },
    ],
  });
  assert.match(f.headline, /2 solutions are deployed/i);
});

test('templateCount is carried through as adjacent, not as a chain stage', () => {
  const f = flow({ templateCount: 6 });
  assert.equal(f.templateCount, 6);
  assert.ok(
    !f.stages.some((s) => s.title === 'Templates'),
    'templates are a shortcut for creating an App, not a step in the chain',
  );
});
