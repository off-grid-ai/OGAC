import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampScore, summarizeQuality, toOnlineScore, type OnlineScore } from '@/lib/qa/online-scores';

// Retaining the continuous judge verdict. Every governed run is already scored out-of-band, but the
// verdict only went to Langfuse — so if Langfuse was down or undeployed, the quality signal vanished
// and the console could not answer "is this app's quality holding up?" from its own data.
// The rule that matters most: an UNJUDGED verdict (engine unreachable) must never be read as a BAD
// one — a missing measurement and a bad measurement mean very different things.

const score = (over: Partial<OnlineScore> = {}): OnlineScore => ({
  runId: 'r1', orgId: 'default', subjectId: 'agent:a1',
  quality: 0.9, faithfulness: 0.9, judged: true, reasoning: '', ts: '2026-07-26T00:00:00.000Z', ...over,
});

test('clampScore bounds into 0..1 and treats junk as 0', () => {
  assert.equal(clampScore(0.42), 0.42);
  assert.equal(clampScore(1.7), 1);
  assert.equal(clampScore(-3), 0);
  assert.equal(clampScore('0.5'), 0.5);
  assert.equal(clampScore('nonsense'), 0);
  assert.equal(clampScore(undefined), 0);
});

test('an UNJUDGED result is retained honestly, not as a zero score', () => {
  const s = toOnlineScore({ runId: 'r', orgId: 'o', subjectId: 'agent:x', quality: 0.8, faithfulness: 0.8, judged: false });
  assert.equal(s.judged, false, 'the fact it was not measured is preserved');
  assert.equal(s.quality, 0, 'no score is claimed for an unmeasured run');
});

test('toOnlineScore fills safe defaults and bounds the reasoning', () => {
  const s = toOnlineScore({ runId: 'r', orgId: '', subjectId: '', quality: 2, faithfulness: -1, judged: true, reasoning: 'x'.repeat(5000) });
  assert.equal(s.orgId, 'default');
  assert.equal(s.subjectId, 'unknown');
  assert.equal(s.quality, 1);
  assert.equal(s.faithfulness, 0);
  assert.equal(s.reasoning.length, 2000);
});

test('summarizeQuality averages only JUDGED verdicts — an outage must not look like bad quality', () => {
  const [t] = summarizeQuality([
    score({ runId: '1', quality: 1, faithfulness: 1 }),
    score({ runId: '2', quality: 0.8, faithfulness: 0.6 }),
    score({ runId: '3', judged: false, quality: 0, faithfulness: 0 }), // engine was down
  ]);
  assert.equal(t.judged, 2);
  assert.equal(t.unjudged, 1, 'the outage is surfaced, not hidden');
  assert.equal(t.avgQuality, 0.9, 'the unjudged 0 does NOT drag the average down');
  assert.equal(t.avgFaithfulness, 0.8);
});

test('belowThreshold counts a judged verdict failing EITHER dimension', () => {
  const [t] = summarizeQuality(
    [
      score({ runId: '1', quality: 0.95, faithfulness: 0.95 }),
      score({ runId: '2', quality: 0.95, faithfulness: 0.4 }), // faithful-fail only
      score({ runId: '3', quality: 0.3, faithfulness: 0.95 }), // quality-fail only
    ],
    0.7,
  );
  assert.equal(t.belowThreshold, 2);
});

test('trend is grouped per subject and sorted, so one bad app is visible among good ones', () => {
  const out = summarizeQuality([
    score({ runId: '1', subjectId: 'agent:zeta', quality: 0.2, faithfulness: 0.2 }),
    score({ runId: '2', subjectId: 'agent:alpha', quality: 1, faithfulness: 1 }),
  ]);
  assert.deepEqual(out.map((t) => t.subjectId), ['agent:alpha', 'agent:zeta']);
  assert.equal(out[1].belowThreshold, 1);
});

test('an all-unjudged subject reports zero averages WITHOUT claiming zero quality', () => {
  const [t] = summarizeQuality([score({ judged: false, quality: 0, faithfulness: 0 })]);
  assert.equal(t.judged, 0);
  assert.equal(t.unjudged, 1);
  assert.equal(t.belowThreshold, 0, 'nothing was measured, so nothing failed');
});
