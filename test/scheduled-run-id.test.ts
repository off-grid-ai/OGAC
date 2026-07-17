import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInputForExecution } from '../src/lib/scheduled-run-id.ts';

test('two recurring agent fires receive distinct correlated run ids', () => {
  const input = { agentId: 'claims', runId: 'sched_claims', scheduled: true as const };
  const first = runInputForExecution(input, '11111111-1111-1111-1111-111111111111');
  const second = runInputForExecution(input, '22222222-2222-2222-2222-222222222222');
  assert.notEqual(first.runId, second.runId);
  assert.match(first.runId, /^sched_claims_/);
  assert.match(second.runId, /^sched_claims_/);
});

test('two recurring App fires are unique while direct submissions retain idempotent ids', () => {
  const scheduled = { appId: 'indemnity', runId: 'appsched_indemnity', scheduled: true as const };
  assert.notEqual(
    runInputForExecution(scheduled, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa').runId,
    runInputForExecution(scheduled, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb').runId,
  );
  const direct = { appId: 'indemnity', runId: 'run_operator_1' };
  assert.equal(runInputForExecution(direct, 'temporal-run-a'), direct);
});
