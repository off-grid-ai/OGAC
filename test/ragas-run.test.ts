import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JudgeRouting } from '../src/lib/eval-judge.ts';
import {
  describeRagasAttribution,
  RAGAS_METRIC_SET,
  ragasScore,
  summarizeRagasRun,
} from '../src/lib/ragas-run.ts';

const judge: JudgeRouting = {
  model: 'gemma-4-e4b',
  agentId: 'agent_system_ai_quality_judge',
  pipelineId: 'pl_system_ai_quality_judge',
  gatewayId: 'gw_seed_default_onprem-cluster',
  conformant: true,
  attribution: 'judge=agent_system_ai_quality_judge pipeline=pl … model=gemma-4-e4b',
};

const base = {
  requested: RAGAS_METRIC_SET,
  judge,
  sidecarService: 'ragas-sidecar',
  ragasVersion: '0.2.6',
  passed: 3,
  total: 5,
};

test('ragasScore: means the returned metrics when present', () => {
  assert.equal(ragasScore({ faithfulness: 1, answer_relevancy: 0.5 }, 0, 10), 75);
});

test('ragasScore: falls back to pass-rate when nothing returned', () => {
  assert.equal(ragasScore({}, 4, 8), 50);
});

test('ragasScore: zero when nothing returned and no cases', () => {
  assert.equal(ragasScore({}, 0, 0), 0);
});

test('full run: all metrics returned → engineProven, not degraded, all attributed', () => {
  const s = summarizeRagasRun({
    ...base,
    metrics: {
      faithfulness: 0.9,
      answer_relevancy: 0.8,
      context_precision: 0.7,
      context_recall: 0.6,
      answer_correctness: 0.5,
    },
  });
  assert.equal(s.attribution.engineProven, true);
  assert.equal(s.attribution.degraded, false);
  assert.deepEqual(s.attribution.omitted, []);
  assert.equal(s.faithfulness, 0.9);
  assert.equal(s.score, 70); // mean(0.9,0.8,0.7,0.6,0.5)=0.7
  assert.equal(s.attribution.judge.conformant, true);
  assert.equal(s.attribution.judge.model, 'gemma-4-e4b');
});

test('partial run: faithfulness present but others omitted → proven AND degraded', () => {
  const s = summarizeRagasRun({ ...base, metrics: { faithfulness: 0.8 } });
  assert.equal(s.attribution.engineProven, true);
  assert.equal(s.attribution.degraded, true);
  assert.deepEqual(s.attribution.omitted.sort(), [
    'answer_correctness',
    'answer_relevancy',
    'context_precision',
    'context_recall',
  ]);
  assert.match(s.attribution.note, /4 of 5 requested metrics omitted/);
});

test('empty run: sidecar returned nothing → not proven, degraded, pass-rate score', () => {
  const s = summarizeRagasRun({ ...base, metrics: {} });
  assert.equal(s.attribution.engineProven, false);
  assert.equal(s.attribution.degraded, true);
  assert.equal(s.faithfulness, undefined);
  assert.equal(s.score, 60); // 3/5 pass-rate fallback
  assert.match(s.attribution.note, /engine path not proven/);
});

test('non-finite metric values are treated as omitted (not trusted)', () => {
  const s = summarizeRagasRun({
    ...base,
    metrics: { faithfulness: 0.9, answer_relevancy: Number.NaN, context_precision: 'oops' },
  });
  assert.equal(s.attribution.returned.faithfulness, 0.9);
  assert.equal('answer_relevancy' in s.attribution.returned, false);
  assert.ok(s.attribution.omitted.includes('answer_relevancy'));
  assert.ok(s.attribution.omitted.includes('context_precision'));
});

// ─── describeRagasAttribution (display normalizer) ──────────────────────────────────────────────
test('describeRagasAttribution: null/non-object → null (legacy rows never throw)', () => {
  assert.equal(describeRagasAttribution(null), null);
  assert.equal(describeRagasAttribution(undefined), null);
});

test('describeRagasAttribution: full attribution normalizes to display rows in canonical order', () => {
  const view = describeRagasAttribution({
    engine: 'ragas',
    sidecarService: 'ragas-sidecar',
    ragasVersion: '0.2.6',
    judge: {
      model: 'gemma-4-e4b',
      agentId: 'agent_system_ai_quality_judge',
      pipelineId: 'pl_system_ai_quality_judge',
      gatewayId: 'gw_seed_default_onprem-cluster',
      conformant: true,
      attribution: 'judge=…',
    },
    requested: [...RAGAS_METRIC_SET],
    returned: { faithfulness: 0.9, context_recall: 0.6 },
    omitted: ['answer_relevancy', 'context_precision', 'answer_correctness'],
    engineProven: true,
    degraded: true,
    note: 'partial',
  });
  assert.ok(view);
  assert.equal(view!.judgeConformant, true);
  assert.equal(view!.engineProven, true);
  assert.equal(view!.degraded, true);
  // canonical order: faithfulness before context_recall
  assert.deepEqual(view!.metrics, [
    { name: 'faithfulness', pct: 90 },
    { name: 'context_recall', pct: 60 },
  ]);
  assert.equal(view!.omitted.length, 3);
});

test('describeRagasAttribution: missing judge/returned degrade to safe defaults', () => {
  const view = describeRagasAttribution({ engine: 'ragas' });
  assert.ok(view);
  assert.equal(view!.judgeModel, '—');
  assert.equal(view!.judgeConformant, false);
  assert.deepEqual(view!.metrics, []);
  assert.deepEqual(view!.omitted, []);
});
