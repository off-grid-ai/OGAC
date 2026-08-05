import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_INFERENCE_TIMEOUT_MS,
  FAST_FAILURE_MS,
  InferenceUnavailableError,
  MAX_INFERENCE_TIMEOUT_MS,
  MIN_INFERENCE_TIMEOUT_MS,
  inferenceTimeoutMs,
  shouldRetryUpstream,
} from '../src/lib/inference-timeout.ts';

// The regression these tests exist for: the agent path aborted every governed model call at 20 000 ms
// while the real on-prem prompt needed 262s, so the app produced no assessment. The default must be
// the aggregator's own upstream allowance, not a number that truncates real work.
test('defaults to the aggregator upstream allowance when unset', () => {
  assert.equal(inferenceTimeoutMs({}), DEFAULT_INFERENCE_TIMEOUT_MS);
  assert.equal(DEFAULT_INFERENCE_TIMEOUT_MS, 300_000);
  // The value that caused the live defect must no longer be what an unconfigured box uses.
  assert.notEqual(DEFAULT_INFERENCE_TIMEOUT_MS, 20_000);
});

test('honours an explicit operator override', () => {
  assert.equal(inferenceTimeoutMs({ OFFGRID_INFERENCE_TIMEOUT_MS: '45000' }), 45_000);
  assert.equal(inferenceTimeoutMs({ OFFGRID_INFERENCE_TIMEOUT_MS: '  600000  ' }), 600_000);
  // A fractional value is floored rather than passed to AbortSignal as a non-integer.
  assert.equal(inferenceTimeoutMs({ OFFGRID_INFERENCE_TIMEOUT_MS: '30000.9' }), 30_000);
});

test('an unusable value falls back rather than disabling inference', () => {
  // Each of these previously would have been Number()'d into 0 or NaN. A zero budget aborts every
  // call instantly, which reads as configuration but behaves as a total outage.
  for (const raw of ['', '   ', 'abc', 'NaN', 'Infinity', '-1', '0', '1e', 'null']) {
    assert.equal(
      inferenceTimeoutMs({ OFFGRID_INFERENCE_TIMEOUT_MS: raw }),
      DEFAULT_INFERENCE_TIMEOUT_MS,
      `"${raw}" must fall back`,
    );
  }
  assert.equal(inferenceTimeoutMs({ OFFGRID_INFERENCE_TIMEOUT_MS: undefined }), DEFAULT_INFERENCE_TIMEOUT_MS);
});

test('clamps to a usable range at both ends', () => {
  assert.equal(inferenceTimeoutMs({ OFFGRID_INFERENCE_TIMEOUT_MS: '5' }), MIN_INFERENCE_TIMEOUT_MS);
  assert.equal(inferenceTimeoutMs({ OFFGRID_INFERENCE_TIMEOUT_MS: '999' }), MIN_INFERENCE_TIMEOUT_MS);
  assert.equal(inferenceTimeoutMs({ OFFGRID_INFERENCE_TIMEOUT_MS: '1000' }), 1_000);
  assert.equal(
    inferenceTimeoutMs({ OFFGRID_INFERENCE_TIMEOUT_MS: '99999999' }),
    MAX_INFERENCE_TIMEOUT_MS,
  );
  assert.equal(
    inferenceTimeoutMs({ OFFGRID_INFERENCE_TIMEOUT_MS: String(MAX_INFERENCE_TIMEOUT_MS) }),
    MAX_INFERENCE_TIMEOUT_MS,
  );
});

// The retry rule exists for a measured signature: on a single-slot on-prem node the FIRST of three
// identical calls came back 502 in 1.63s and the next two succeeded. A fast failure did no work; a
// failure that burned the whole budget means the node is saturated and must not be hit again.
test('retries a fast rejection exactly once', () => {
  assert.equal(shouldRetryUpstream(1, 1_630), true, 'the measured 1.63s 502 must retry');
  assert.equal(shouldRetryUpstream(1, 0), true, 'an instant connection refusal must retry');
  // Only ONE extra attempt — this absorbs a cold slot, it does not paper over a down node.
  assert.equal(shouldRetryUpstream(2, 1_630), false);
  assert.equal(shouldRetryUpstream(3, 10), false);
});

test('never retries a failure that consumed real time', () => {
  // 262s is the measured duration of a REAL answer on this node, so a failure near that is a
  // saturated node. Retrying would double an already four-minute step and add load to the cause.
  assert.equal(shouldRetryUpstream(1, 262_000), false);
  assert.equal(shouldRetryUpstream(1, FAST_FAILURE_MS), false, 'the boundary is exclusive');
  assert.equal(shouldRetryUpstream(1, FAST_FAILURE_MS - 1), true);
  // A nonsense clock reading must not be treated as "fast".
  assert.equal(shouldRetryUpstream(1, -1), false);
});

// The error type is what keeps "the model was not reached" distinguishable from "the model answered
// with nothing". Collapsing the two is what let a raw source dump be published as a claim verdict.
test('InferenceUnavailableError names the reason and is catchable by type', () => {
  const err = new InferenceUnavailableError('TimeoutError: signal timed out');
  assert.ok(err instanceof InferenceUnavailableError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'InferenceUnavailableError');
  assert.match(err.message, /could not be reached/);
  // The operator-facing detail survives, because "timed out" and "connection refused" are different
  // problems and the app run surfaces this message verbatim on the failed step.
  assert.match(err.message, /TimeoutError: signal timed out/);
});
