import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickJudgeGateway, resolveJudgeRouting } from '../src/lib/eval-judge.ts';

const agent = { id: 'agent_system_ai_quality_judge', pipelineId: 'pl_system_ai_quality_judge' };
const pipeline = {
  id: 'pl_system_ai_quality_judge',
  gatewayId: 'gw_onprem',
  defaultModel: 'gemma-4-e4b',
};
const gateway = { id: 'gw_onprem', defaultModel: 'qwen3-vl-8b' };

test('conformant chain resolves the pipeline model + full attribution', () => {
  const r = resolveJudgeRouting({ agent, pipeline, gateway, fallbackModel: 'fb' });
  assert.equal(r.conformant, true);
  assert.equal(r.model, 'gemma-4-e4b'); // pipeline default wins over gateway default
  assert.equal(r.agentId, 'agent_system_ai_quality_judge');
  assert.equal(r.pipelineId, 'pl_system_ai_quality_judge');
  assert.equal(r.gatewayId, 'gw_onprem');
  assert.match(r.attribution, /judge=agent_system_ai_quality_judge pipeline=.* gateway=gw_onprem model=gemma-4-e4b/);
});

test('falls back to gateway defaultModel when pipeline has none (still conformant)', () => {
  const r = resolveJudgeRouting({
    agent,
    pipeline: { ...pipeline, defaultModel: null },
    gateway,
    fallbackModel: 'fb',
  });
  assert.equal(r.conformant, true);
  assert.equal(r.model, 'qwen3-vl-8b');
});

test('non-conformant: no judge agent → bootstrap fallback', () => {
  const r = resolveJudgeRouting({ agent: null, pipeline, gateway, fallbackModel: 'fb' });
  assert.equal(r.conformant, false);
  assert.equal(r.model, 'gemma-4-e4b'); // still prefers a chain model if present, just not conformant
  assert.match(r.attribution, /chain incomplete/);
});

test('non-conformant: agent not bound to the pipeline', () => {
  const r = resolveJudgeRouting({
    agent: { ...agent, pipelineId: 'other' },
    pipeline,
    gateway,
    fallbackModel: 'fb',
  });
  assert.equal(r.conformant, false);
});

test('non-conformant: pipeline not on the gateway', () => {
  const r = resolveJudgeRouting({
    agent,
    pipeline: { ...pipeline, gatewayId: 'other' },
    gateway,
    fallbackModel: 'fb',
  });
  assert.equal(r.conformant, false);
});

test('non-conformant with no model anywhere → env fallback model', () => {
  const r = resolveJudgeRouting({
    agent: null,
    pipeline: null,
    gateway: null,
    fallbackModel: 'gemma-4-e4b',
  });
  assert.equal(r.conformant, false);
  assert.equal(r.model, 'gemma-4-e4b');
  assert.equal(r.agentId, null);
  assert.equal(r.pipelineId, null);
});

// ─── pickJudgeGateway (seed target selection) ───────────────────────────────────────────────────
test('pickJudgeGateway: prefers an enabled on-prem gateway that already has a defaultModel', () => {
  const g = pickJudgeGateway([
    { id: 'a', defaultModel: '', enabled: true, egressClass: 'on-prem' },
    { id: 'b', defaultModel: 'gemma-4-e4b', enabled: true, egressClass: 'on-prem' },
    { id: 'c', defaultModel: 'x', enabled: false, egressClass: 'on-prem' },
  ]);
  assert.equal(g?.id, 'b');
});

test('pickJudgeGateway: prefers on-prem over a cloud gateway even when only cloud has a model', () => {
  const g = pickJudgeGateway([
    { id: 'cloud', defaultModel: 'claude-3-5-haiku-latest', enabled: true, egressClass: 'cloud' },
    { id: 'local', defaultModel: '', enabled: true, egressClass: 'on-prem' },
  ]);
  assert.equal(g?.id, 'local'); // judge must not silently egress when a local gateway exists
});

test('pickJudgeGateway: uses a cloud gateway with a model only when no on-prem exists', () => {
  const g = pickJudgeGateway([
    { id: 'c1', defaultModel: '', enabled: true, egressClass: 'cloud' },
    { id: 'c2', defaultModel: 'claude-3-5-haiku-latest', enabled: true, egressClass: 'cloud' },
  ]);
  assert.equal(g?.id, 'c2');
});

test('pickJudgeGateway: falls back to any enabled gateway when none advertise a model', () => {
  const g = pickJudgeGateway([
    { id: 'a', defaultModel: 'x', enabled: false, egressClass: 'cloud' },
    { id: 'b', defaultModel: '', enabled: true, egressClass: 'cloud' },
  ]);
  assert.equal(g?.id, 'b');
});

test('pickJudgeGateway: falls back to the first gateway when none are enabled', () => {
  const g = pickJudgeGateway([
    { id: 'a', defaultModel: '', enabled: false, egressClass: 'cloud' },
    { id: 'b', defaultModel: '', enabled: false, egressClass: 'on-prem' },
  ]);
  assert.equal(g?.id, 'a');
});

test('pickJudgeGateway: returns null when the org has no gateway', () => {
  assert.equal(pickJudgeGateway([]), null);
});
