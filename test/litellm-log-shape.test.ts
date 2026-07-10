import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  litellmPayloadToTrafficRecord,
  callTypeToKind,
  deriveStatus,
  type LiteLLMStandardLoggingPayload,
} from '../src/lib/litellm-log-shape.ts';

// PURE mapper: a realistic LiteLLM StandardLoggingPayload → the console's canonical TrafficRecord
// (the TERMINAL artifact that lands in the offgrid-gateway index the traffic/logs UI reads). No I/O.

const successPayload: LiteLLMStandardLoggingPayload = {
  model: 'onprem/qwythos-9b',
  model_group: 'qwythos-9b',
  response_cost: 0.0012,
  status: 'success',
  startTime: 1_700_000_000_000,
  endTime: 1_700_000_002_500, // 2500ms later
  total_tokens: 350,
  prompt_tokens: 120,
  completion_tokens: 230,
  call_type: 'completion',
  id: 'req-abc-123',
  metadata: {
    user_api_key_alias: 'pipeline-tax',
    user_api_key: 'sk-hash-never-mapped',
    deployment: 'g3',
    model_info: { id: 'g3', egress: 'on-prem' },
  },
};

test('success payload → the exact TrafficRecord fields that land in the index', () => {
  const r = litellmPayloadToTrafficRecord(successPayload);
  assert.equal(r.ts, 1_700_000_002_500);
  assert.equal(r.gateway, 'g3'); // attributed to the deployment LiteLLM routed to
  assert.equal(r.model, 'onprem/qwythos-9b');
  assert.equal(r.modelServed, 'qwythos-9b');
  assert.equal(r.kind, 'text');
  assert.equal(r.status, 200);
  assert.equal(r.ms, 2500);
  assert.equal(r.tokens, 350);
  assert.equal(r.promptTokens, 120);
  assert.equal(r.completionTokens, 230);
  assert.equal(r.caller, 'pipeline-tax');
  assert.equal(r.corrId, 'req-abc-123');
  assert.equal(r.bytes, 0);
});

test('the raw api key value is NEVER copied into the record', () => {
  const r = litellmPayloadToTrafficRecord(successPayload);
  assert.ok(!JSON.stringify(r).includes('sk-hash-never-mapped'));
});

test('failure with a real HTTP error_code → that status (>=400), counted as an error', () => {
  const r = litellmPayloadToTrafficRecord({
    ...successPayload,
    status: 'failure',
    error_code: 429,
  });
  assert.equal(r.status, 429);
});

test('failure with no/invalid error_code → generic 500 (never recorded as ok)', () => {
  assert.equal(litellmPayloadToTrafficRecord({ status: 'failure' }).status, 500);
  assert.equal(litellmPayloadToTrafficRecord({ status: 'failure', error_code: 'oops' }).status, 500);
  // an error_code below 400 (not a real HTTP error) also falls to 500.
  assert.equal(litellmPayloadToTrafficRecord({ status: 'failure', error_code: 200 }).status, 500);
});

test('missing tokens → 0; total derived from prompt+completion when total absent', () => {
  const noTotal = litellmPayloadToTrafficRecord({
    status: 'success',
    prompt_tokens: 40,
    completion_tokens: 60,
  });
  assert.equal(noTotal.tokens, 100);
  const none = litellmPayloadToTrafficRecord({ status: 'success' });
  assert.equal(none.tokens, 0);
  assert.equal(none.promptTokens, undefined);
  assert.equal(none.completionTokens, undefined);
});

test('missing cost is simply absent (no cost field forced onto the record shape)', () => {
  const r = litellmPayloadToTrafficRecord({ status: 'success' });
  // TrafficRecord has no cost field; the mapper must not invent one.
  assert.ok(!('costUsd' in r));
  assert.equal(r.params, undefined);
});

test('missing timestamps → ms 0 and ts falls back to the injected now', () => {
  const r = litellmPayloadToTrafficRecord({ status: 'success' }, 999);
  assert.equal(r.ms, 0);
  assert.equal(r.ts, 999);
});

test('negative/garbage token values are floored to 0 (never negative in the index)', () => {
  const r = litellmPayloadToTrafficRecord({
    status: 'success',
    total_tokens: -5,
    prompt_tokens: -1,
    completion_tokens: 10,
  });
  // total_tokens is invalid → falls to prompt(-1→0) + completion(10) = 10
  assert.equal(r.tokens, 10);
});

test('gateway falls back through model_info.id → metadata.deployment → "litellm"', () => {
  assert.equal(
    litellmPayloadToTrafficRecord({ status: 'success', metadata: { deployment: 'g7' } }).gateway,
    'g7',
  );
  assert.equal(litellmPayloadToTrafficRecord({ status: 'success' }).gateway, 'litellm');
  assert.equal(
    litellmPayloadToTrafficRecord({ status: 'success', metadata: null }).gateway,
    'litellm',
  );
});

test('caller falls back to the end-user id when no key alias is present', () => {
  const r = litellmPayloadToTrafficRecord({
    status: 'success',
    metadata: { user_api_key_user_id: 'user-42' },
  });
  assert.equal(r.caller, 'user-42');
});

test('model absent → "unknown"; model_group absent → modelServed undefined', () => {
  const r = litellmPayloadToTrafficRecord({ status: 'success' });
  assert.equal(r.model, 'unknown');
  assert.equal(r.modelServed, undefined);
});

test('callTypeToKind maps embedding + image, defaults text', () => {
  assert.equal(callTypeToKind('embedding'), 'embedding');
  assert.equal(callTypeToKind('aembedding'), 'embedding');
  assert.equal(callTypeToKind('image_generation'), 'image');
  assert.equal(callTypeToKind('aimage_generation'), 'image');
  assert.equal(callTypeToKind('completion'), 'text');
  assert.equal(callTypeToKind(undefined), 'text');
});

test('an embedding call is recorded with kind embedding', () => {
  const r = litellmPayloadToTrafficRecord({ status: 'success', call_type: 'embedding' });
  assert.equal(r.kind, 'embedding');
});

test('deriveStatus is a pure helper reused by the mapper (success 200)', () => {
  assert.equal(deriveStatus({ status: 'success' }), 200);
});
