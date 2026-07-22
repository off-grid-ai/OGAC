import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  callbacksUnconfigured,
  callbacksUnreachable,
  classifyCallbacks,
  classifySink,
  interpretCallbacks,
  planDisableTeamLogging,
  planTeamCallback,
  sampleCallbackPayload,
  sampleCallbackRecord,
  teamCallbackAuditResource,
  type RawCallbacksByType,
  type TeamCallbackPlan,
} from '../src/lib/litellm-callbacks.ts';

// ─── classifySink ─────────────────────────────────────────────────────────────────────────────
test('classifySink: known observability sinks map to label + category', () => {
  assert.deepEqual(classifySink('otel'), { label: 'OpenTelemetry', category: 'observability' });
  assert.deepEqual(classifySink(' Langfuse '), { label: 'Langfuse', category: 'observability' });
  assert.deepEqual(classifySink('OTEL'), { label: 'OpenTelemetry', category: 'observability' });
});

test('classifySink: metrics / storage / alerting categories', () => {
  assert.equal(classifySink('prometheus').category, 'metrics');
  assert.equal(classifySink('datadog').category, 'metrics');
  assert.equal(classifySink('s3').category, 'storage');
  assert.equal(classifySink('gcs_bucket').category, 'storage');
  assert.equal(classifySink('sentry').category, 'alerting');
  assert.equal(classifySink('generic').category, 'alerting');
});

test('classifySink: unknown name passes through with unknown category', () => {
  assert.deepEqual(classifySink('mystery_sink'), { label: 'mystery_sink', category: 'unknown' });
});

test('classifySink: empty/whitespace name → "unknown" label', () => {
  assert.deepEqual(classifySink('   '), { label: 'unknown', category: 'unknown' });
});

// ─── classifyCallbacks ────────────────────────────────────────────────────────────────────────
test('classifyCallbacks: success + failure split with success_and_failure feeding both', () => {
  const raw: RawCallbacksByType = {
    success: ['langfuse'],
    failure: ['sentry'],
    success_and_failure: ['otel'],
  };
  const { success, failure } = classifyCallbacks(raw);
  // otel + langfuse feed success; otel is onSuccess AND onFailure
  const otelS = success.find((s) => s.name === 'otel');
  assert.ok(otelS);
  assert.equal(otelS.onSuccess, true);
  assert.equal(otelS.onFailure, true);
  const langfuse = success.find((s) => s.name === 'langfuse');
  assert.ok(langfuse);
  assert.equal(langfuse.onFailure, false);
  // sentry + otel feed failure
  assert.deepEqual(failure.map((f) => f.name).sort(), ['otel', 'sentry']);
  const sentry = failure.find((f) => f.name === 'sentry');
  assert.equal(sentry?.onSuccess, false);
});

test('classifyCallbacks: dedupes + trims + drops empties, tolerates missing keys', () => {
  const raw: RawCallbacksByType = { success: ['otel', ' otel ', '', 'langfuse'] };
  const { success, failure } = classifyCallbacks(raw);
  assert.deepEqual(success.map((s) => s.name).sort(), ['langfuse', 'otel']);
  assert.deepEqual(failure, []);
});

test('classifyCallbacks: null / non-array inputs → empty', () => {
  assert.deepEqual(classifyCallbacks(null), { success: [], failure: [] });
  assert.deepEqual(classifyCallbacks(undefined), { success: [], failure: [] });
  assert.deepEqual(classifyCallbacks({ success: 'nope', failure: 42 } as unknown as RawCallbacksByType), {
    success: [],
    failure: [],
  });
});

// ─── interpretCallbacks / unconfigured / unreachable ────────────────────────────────────────────
test('interpretCallbacks: active when any sink present', () => {
  const s = interpretCallbacks({ success_and_failure: ['otel'] });
  assert.equal(s.configured, true);
  assert.equal(s.reachable, true);
  assert.equal(s.active, true);
  assert.equal(s.success.length, 1);
  assert.equal(s.failure.length, 1);
});

test('interpretCallbacks: no sinks → reachable but not active', () => {
  const s = interpretCallbacks({ success: [], failure: [], success_and_failure: [] });
  assert.equal(s.reachable, true);
  assert.equal(s.active, false);
});

test('callbacksUnconfigured / callbacksUnreachable are honest', () => {
  const u = callbacksUnconfigured();
  assert.deepEqual(u, { configured: false, reachable: false, active: false, success: [], failure: [] });
  const r = callbacksUnreachable('boom');
  assert.equal(r.configured, true);
  assert.equal(r.reachable, false);
  assert.equal(r.active, false);
  assert.equal(r.error, 'boom');
});

// ─── planTeamCallback ─────────────────────────────────────────────────────────────────────────
test('planTeamCallback: valid request → shaped body, default callback_type', () => {
  const plan = planTeamCallback({ teamId: 'team-1', callbackName: 'langfuse' });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.teamId, 'team-1');
    assert.equal(plan.body.callback_name, 'langfuse');
    assert.equal(plan.body.callback_type, 'success_and_failure');
    assert.deepEqual(plan.body.callback_vars, {});
  }
});

test('planTeamCallback: explicit callback_type + callback_vars coerced to string map', () => {
  const plan = planTeamCallback({
    teamId: ' team-2 ',
    callbackName: ' otel ',
    callbackType: 'success',
    callbackVars: { langfuse_public_key: 'pk-1', bad: 42, '': 'skip', ok2: 'v2' },
  });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.teamId, 'team-2');
    assert.equal(plan.body.callback_name, 'otel');
    assert.equal(plan.body.callback_type, 'success');
    assert.deepEqual(plan.body.callback_vars, { langfuse_public_key: 'pk-1', ok2: 'v2' });
  }
});

test('planTeamCallback: missing teamId / callbackName rejected', () => {
  assert.deepEqual(planTeamCallback({ callbackName: 'otel' }), { ok: false, error: 'teamId is required' });
  assert.deepEqual(planTeamCallback({ teamId: 't', callbackName: '   ' }), {
    ok: false,
    error: 'callbackName is required',
  });
});

test('planTeamCallback: bad callback_type rejected', () => {
  const plan = planTeamCallback({ teamId: 't', callbackName: 'otel', callbackType: 'sometimes' });
  assert.equal(plan.ok, false);
  if (!plan.ok) assert.match(plan.error, /callbackType must be/);
});

test('planTeamCallback: null callbackType falls back to default; non-object vars → {}', () => {
  const plan = planTeamCallback({ teamId: 't', callbackName: 'otel', callbackType: null, callbackVars: ['x'] });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.body.callback_type, 'success_and_failure');
    assert.deepEqual(plan.body.callback_vars, {});
  }
});

// ─── teamCallbackAuditResource ──────────────────────────────────────────────────────────────────
test('teamCallbackAuditResource: descriptive label', () => {
  const plan = planTeamCallback({ teamId: 'team-9', callbackName: 'langfuse' }) as Extract<
    TeamCallbackPlan,
    { ok: true }
  >;
  assert.equal(teamCallbackAuditResource(plan), 'gateway.callbacks.team(team-9).langfuse');
});

// ─── planDisableTeamLogging ─────────────────────────────────────────────────────────────────────
test('planDisableTeamLogging: validates team id', () => {
  assert.deepEqual(planDisableTeamLogging(' team-3 '), { ok: true, teamId: 'team-3' });
  assert.deepEqual(planDisableTeamLogging(''), { ok: false, error: 'teamId is required' });
  assert.deepEqual(planDisableTeamLogging(null), { ok: false, error: 'teamId is required' });
});

// ─── sample payload preview (reuses litellm-log-shape) ──────────────────────────────────────────
test('sampleCallbackPayload: representative successful on-prem completion', () => {
  const p = sampleCallbackPayload();
  assert.equal(p.status, 'success');
  assert.equal(p.model, 'onprem/qwen3.5-9b');
  assert.equal(p.total_tokens, 384);
});

test('sampleCallbackRecord: maps through litellm-log-shape to a terminal TrafficRecord', () => {
  const rec = sampleCallbackRecord();
  assert.equal(rec.gateway, 'g5');
  assert.equal(rec.model, 'onprem/qwen3.5-9b');
  assert.equal(rec.modelServed, 'qwen3.5-9b');
  assert.equal(rec.status, 200);
  assert.equal(rec.kind, 'text');
  assert.equal(rec.tokens, 384);
  assert.equal(rec.promptTokens, 128);
  assert.equal(rec.completionTokens, 256);
  assert.equal(rec.ms, 842);
  assert.equal(rec.caller, 'suraksha-claims-app');
  assert.equal(rec.corrId, 'chatcmpl-8Zx2example');
});

test('sampleCallbackRecord: ts falls back to injected now when appropriate', () => {
  // endTime is present, so ts is endTime regardless of `now` — assert the terminal ts.
  const rec = sampleCallbackRecord(999);
  assert.equal(rec.ts, 1_700_000_000_842);
});
