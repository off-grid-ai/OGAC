import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  type Expectation,
  failureVerdict,
  parseCheckpointResult,
  rejectedVerdict,
  summarize,
} from '../src/lib/data-quality-model.ts';


// ── B2.3 — a GREEN gate must name what it verified, and a refusal is not an outage ──────────────────
//
// Both found live on the great-expectations sidecar at :8944 (which is real — the "stub" in the backlog
// row was stale). A clean batch returned "3/3 passed" with the checks labelled passed_expectation_1/2/3,
// and an empty expectation list returned engineReachable:false / "engine unreachable" for what was
// actually a 400 answered BY the engine.
describe('B2.3 — naming passing expectations', () => {
  const REQUESTED: Expectation[] = [
    { type: 'expect_column_values_to_not_be_null', column: 'claim_no' },
    { type: 'expect_column_values_to_be_between', column: 'amount', min: 0, max: 1000000 },
    { type: 'expect_column_values_to_be_in_set', column: 'status', value_set: ['submitted'] },
  ];

  test('an all-pass run names every rule it verified', () => {
    const v = parseCheckpointResult({ success: true, evaluated: 3, failed: [] }, REQUESTED);
    assert.equal(v.passed, 3);
    // "3/3 passed" is not evidence if it cannot say WHICH three rules ran.
    const names = v.results.map((r) => r.expectation).join(' ');
    assert.match(names, /claim_no/);
    assert.match(names, /amount/);
    assert.match(names, /status/);
    assert.ok(!names.includes('passed_expectation_'), names);
    assert.ok(v.results.every((r) => r.success));
  });

  test('a mixed run names the passing rules and excludes the failing one', () => {
    const v = parseCheckpointResult(
      {
        success: false,
        evaluated: 3,
        failed: [{ type: 'expect_column_values_to_be_between', column: 'amount', unexpected_count: 1 }],
      },
      REQUESTED,
    );
    assert.equal(v.failed, 1);
    assert.equal(v.passed, 2);
    const passing = v.results.filter((r) => r.success).map((r) => r.column);
    assert.deepEqual(passing.sort(), ['claim_no', 'status']);
    const failing = v.results.filter((r) => !r.success);
    assert.equal(failing[0].column, 'amount');
  });

  test('without the requested list it degrades to the old labels rather than inventing names', () => {
    const v = parseCheckpointResult({ success: true, evaluated: 2, failed: [] });
    assert.equal(v.passed, 2);
    assert.ok(v.results.every((r) => r.expectation.startsWith('passed_expectation_')));
  });

  test('a count mismatch falls back rather than mislabelling a rule as passed', () => {
    // The sidecar says 3 evaluated but only 1 expectation was sent: elimination would be a guess, and a
    // wrongly-named passing rule is worse than an unnamed one.
    const v = parseCheckpointResult({ success: true, evaluated: 3, failed: [] }, [REQUESTED[0]]);
    assert.ok(v.results.every((r) => r.expectation.startsWith('passed_expectation_')));
  });
});

describe('B2.3 — rejectedVerdict (a refusal is not an outage)', () => {
  const EXPS: Expectation[] = [{ type: 'expect_column_values_to_not_be_null', column: 'claim_no' }];

  test('keeps engineReachable TRUE, because the engine answered', () => {
    const v = rejectedVerdict(EXPS, 'HTTP 400: expectations must contain 1-200 entries.');
    assert.equal(v.engineReachable, true);
    assert.equal(v.success, false);
    assert.match(v.note ?? '', /rejected the request/);
    assert.ok(!/unreachable/.test(v.note ?? ''), v.note);
  });

  test('marks the rules as NOT EVALUATED, never as passed', () => {
    const v = rejectedVerdict(EXPS, 'HTTP 422');
    assert.equal(v.passed, 0);
    assert.ok(v.results.every((r) => r.unexpectedCount === -1 && !r.success));
    assert.match(v.results[0].detail ?? '', /not evaluated/);
  });

  test('an outage still reads as an outage — the two stay distinguishable', () => {
    const down = failureVerdict(EXPS, 'ECONNREFUSED');
    assert.equal(down.engineReachable, false);
    assert.match(down.note ?? '', /unreachable/);
    const refused = rejectedVerdict(EXPS, 'HTTP 400');
    assert.notEqual(down.engineReachable, refused.engineReachable);
  });

  test('summarize surfaces the reason instead of a meaningless 0/1 count', () => {
    const s = summarize(rejectedVerdict(EXPS, 'HTTP 400: expectations must contain 1-200 entries.'));
    assert.match(s, /rejected the request/);
  });
});

// ── The CROSSING assertion for the data-quality boundary ─────────────────────────────────────────────
//
// This boundary dropped the expectation IDENTITIES: the verdict reported "3/3 passed" with the rules named
// passed_expectation_1/2/3, so a green gate could not say what it had checked. The guard is on the crossing —
// every rule the caller REQUESTED must be accounted for in the verdict it gets back.
describe('data-quality boundary — every requested rule must be accounted for', () => {
  const REQ: Expectation[] = [
    { type: 'expect_column_values_to_not_be_null', column: 'claim_no' },
    { type: 'expect_column_values_to_be_between', column: 'amount', min: 0, max: 1000 },
    { type: 'expect_column_values_to_be_in_set', column: 'status', value_set: ['submitted'] },
  ];

  test('all-pass: every requested rule appears by name in the verdict', () => {
    const v = parseCheckpointResult({ success: true, evaluated: 3, failed: [] }, REQ);
    assert.equal(v.results.length, REQ.length, 'one result per requested rule');
    for (const e of REQ) {
      assert.ok(
        v.results.some((r) => r.column === e.column && r.type === e.type),
        `${e.type} [${e.column}] must be accounted for, not summarised away`,
      );
    }
  });

  test('mixed: passes plus failures still account for every requested rule exactly once', () => {
    const v = parseCheckpointResult(
      {
        success: false,
        evaluated: 3,
        failed: [{ type: 'expect_column_values_to_be_between', column: 'amount', unexpected_count: 1 }],
      },
      REQ,
    );
    assert.equal(v.results.length, 3);
    assert.equal(v.passed + v.failed, REQ.length, 'passed + failed must equal what was asked');
    const seen = v.results.map((r) => `${r.type}|${r.column}`);
    assert.equal(new Set(seen).size, seen.length, 'no rule counted twice');
  });

  test('a refusal accounts for every rule as NOT EVALUATED — never silently fewer', () => {
    const v = rejectedVerdict(REQ, 'HTTP 400');
    assert.equal(v.results.length, REQ.length);
    assert.equal(v.total, REQ.length);
    assert.ok(v.results.every((r) => r.unexpectedCount === -1));
  });
});
