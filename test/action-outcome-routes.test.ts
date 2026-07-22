import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionOutcomeDetailHref,
  correctActionOutcomeHref,
  newActionOutcomeHref,
} from '../src/lib/action-outcome-routes.ts';

test('every business-result URL identifies the exact action step in a multi-action run', () => {
  const first = newActionOutcomeHref('app 1', 'run 1', 'create-task');
  const second = newActionOutcomeHref('app 1', 'run 1', 'update-opportunity', 'converted');
  assert.equal(first, '/solutions/apps/app%201/runs/run%201/actions/create-task/outcomes/new');
  assert.equal(
    second,
    '/solutions/apps/app%201/runs/run%201/actions/update-opportunity/outcomes/new?result=converted',
  );
  assert.notEqual(first, second);
  assert.equal(
    actionOutcomeDetailHref('app 1', 'run 1', 'create-task', 'out/1'),
    '/solutions/apps/app%201/runs/run%201/actions/create-task/outcomes/out%2F1',
  );
  assert.equal(
    correctActionOutcomeHref('app 1', 'run 1', 'create-task', 'out/1'),
    '/solutions/apps/app%201/runs/run%201/actions/create-task/outcomes/out%2F1/correct',
  );
});
