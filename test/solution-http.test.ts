import assert from 'node:assert/strict';
import test from 'node:test';
import { solutionErrorResponse } from '../src/lib/solution-http.ts';
import {
  SolutionConflictError,
  SolutionValidationError,
} from '../src/lib/solution-blueprints-store.ts';

test('solution HTTP errors distinguish invalid input from state conflicts', async () => {
  const invalid = solutionErrorResponse(new SolutionValidationError(['invalid status']));
  assert.equal(invalid?.status, 422);
  assert.deepEqual(await invalid?.json(), {
    error: 'invalid solution contract',
    errors: ['invalid status'],
  });

  const conflict = solutionErrorResponse(
    new SolutionConflictError('App already adopted', 'duplicate', ['choose another App']),
  );
  assert.equal(conflict?.status, 409);
  assert.deepEqual(await conflict?.json(), {
    error: 'App already adopted',
    code: 'duplicate',
    errors: ['choose another App'],
  });
  assert.equal(solutionErrorResponse(new Error('unexpected')), null);
});
