import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADVERSE_IMPACT_RATIO,
  fairnessReport,
  testAttribute,
  type DecidedCase,
} from '../src/lib/fairness.ts';

// Real behaviour, not shape assertions. The live tenant cannot exercise the disparity arithmetic — no
// app has 20 decided cases in two groups yet — so these cases stand in for the population the check will
// see in production, and they are the ones a regulator's question turns on.

function cases(spec: { value: string; approved: number; declined: number }[], attribute = 'city'): DecidedCase[] {
  const out: DecidedCase[] = [];
  let n = 0;
  for (const s of spec) {
    for (let i = 0; i < s.approved; i++) out.push({ id: `a${n++}`, approved: true, attributes: { [attribute]: s.value } });
    for (let i = 0; i < s.declined; i++) out.push({ id: `d${n++}`, approved: false, attributes: { [attribute]: s.value } });
  }
  return out;
}

test('a clear approval gap is flagged for investigation, with the ratio', () => {
  // Pune 90% vs Nagpur 40% → ratio 0.44, well under the four-fifths threshold.
  const f = testAttribute(cases([
    { value: 'Pune', approved: 27, declined: 3 },
    { value: 'Nagpur', approved: 12, declined: 18 },
  ]), 'city');
  assert.equal(f.verdict, 'investigate');
  assert.ok(f.ratio !== null && f.ratio < ADVERSE_IMPACT_RATIO, `ratio ${f.ratio} should be under the threshold`);
  assert.equal(f.testable, 2);
  // It must name both sides — a finding a DPO cannot act on is not a finding.
  assert.match(f.sentence, /Nagpur/);
  assert.match(f.sentence, /Pune/);
  // And it must NOT assert discrimination.
  assert.doesNotMatch(f.sentence, /discriminat/i);
  assert.match(f.sentence, /worth explaining/);
});

test('broadly even approval rates pass, and say so with the ratio', () => {
  const f = testAttribute(cases([
    { value: 'Pune', approved: 24, declined: 6 },
    { value: 'Nagpur', approved: 22, declined: 8 },
  ]), 'city');
  assert.equal(f.verdict, 'within-threshold');
  assert.ok(f.ratio !== null && f.ratio >= ADVERSE_IMPACT_RATIO);
});

test('a group under the minimum is never scored, and the shortfall is named', () => {
  const f = testAttribute(cases([
    { value: 'Pune', approved: 25, declined: 5 },
    { value: 'Nagpur', approved: 1, declined: 4 }, // 5 cases — far too few to claim anything
  ]), 'city');
  assert.equal(f.verdict, 'not-enough-data');
  assert.equal(f.ratio, null);
  const nagpur = f.groups.find((g) => g.value === 'Nagpur');
  assert.equal(nagpur?.rate, null, 'an under-minimum group must carry no rate at all');
  assert.match(f.sentence, /Not enough decided cases/);
});

test('an identifier is refused rather than reported as a disparity per person', () => {
  const near: DecidedCase[] = Array.from({ length: 30 }, (_, i) => ({
    id: `r${i}`,
    approved: i % 2 === 0,
    attributes: { customer: `Person ${i}` },
  }));
  const f = testAttribute(near, 'customer');
  assert.equal(f.verdict, 'not-a-group');
  assert.equal(f.ratio, null);
});

test('nobody approved anywhere is not a disparity', () => {
  // 0/25 in both groups. A naive worst/best would be 0/0 = NaN, or 0 → a false "investigate".
  const f = testAttribute(cases([
    { value: 'Pune', approved: 0, declined: 25 },
    { value: 'Nagpur', approved: 0, declined: 25 },
  ]), 'city');
  assert.equal(f.verdict, 'within-threshold');
  assert.equal(f.ratio, 1);
});

test('an attribute no case records is reported as untestable, never as a pass', () => {
  const f = testAttribute(cases([{ value: 'Pune', approved: 25, declined: 5 }]), 'gender');
  assert.equal(f.verdict, 'not-enough-data');
  assert.match(f.sentence, /No decided case records/);
});

test('the report names missing protected attributes and refuses to read as clear', () => {
  const r = fairnessReport(cases([{ value: 'Pune', approved: 5, declined: 2 }]));
  // gender/age/religion/caste are absent from the data and must be listed as such.
  for (const a of ['gender', 'age_band', 'religion', 'caste']) assert.ok(r.absent.includes(a), `${a} should be absent`);
  assert.ok(!r.absent.includes('city'), 'city IS present in these cases');
  assert.match(r.sentence, /UNTESTED rather than clear/);
  assert.ok(r.remedy && r.remedy.includes('gender'), 'the remedy must name what to record');
});

test('coverage reports how completely each attribute is recorded', () => {
  const mixed: DecidedCase[] = [
    { id: '1', approved: true, attributes: { city: 'Pune', channel: 'branch' } },
    { id: '2', approved: false, attributes: { city: 'Pune' } },
    { id: '3', approved: true, attributes: { city: 'Nagpur' } },
  ];
  const r = fairnessReport(mixed);
  const city = r.coverage.find((c) => c.attribute === 'city');
  const channel = r.coverage.find((c) => c.attribute === 'channel');
  assert.deepEqual({ recorded: city?.recorded, of: city?.of }, { recorded: 3, of: 3 });
  assert.deepEqual({ recorded: channel?.recorded, of: channel?.of }, { recorded: 1, of: 3 });
});

test('a report over no decided cases says there is nothing to test', () => {
  const r = fairnessReport([]);
  assert.equal(r.decided, 0);
  assert.match(r.sentence, /has not decided any cases yet/);
});
