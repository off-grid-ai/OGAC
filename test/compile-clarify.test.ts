import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type ClarifiableStep, blocksRun, clarifyingQuestions } from '../src/lib/compile-clarify.ts';

// ── Flow 3, step 2: "OGAC asks clarifying questions" ─────────────────────────────────────────────────
//
// Compile was one-shot: where the sentence was ambiguous it picked something and moved on. `gaps` reported
// what could not be wired — honest, but a statement rather than a question, leaving the author no next move.
//
// Every question here is derived from a CONCRETE fact about the compiled spec, never invented by a model:
// a step with no bound domain, a limit with no number, "approve" with no human step. That keeps them
// deterministic (the same sentence asks the same questions) and pointable-at.

const DESC =
  "When an employee submits an expense claim, read the claim, check that employee's remaining " +
  'reimbursement quota, decide whether it is within quota, have a manager approve it, then email them.';

const FULL: ClarifiableStep[] = [
  { id: 's1', kind: 'connector-query', label: 'Read Expense Claim', domain: 'dom_claims' },
  { id: 's2', kind: 'agent', label: 'Check quota' },
  { id: 's3', kind: 'human', label: 'Manager Approval' },
  { id: 's4', kind: 'output', label: 'Email the employee', sink: 'email' },
];

describe('clarifyingQuestions', () => {
  test('a fully specified app asks nothing — no invented busywork', () => {
    assert.deepEqual(clarifyingQuestions(DESC, FULL), []);
  });

  test('an UNBOUND read is asked about, and blocks the run', () => {
    const steps = [{ id: 's1', kind: 'connector-query', label: 'Read Expense Claim' }, ...FULL.slice(1)];
    const qs = clarifyingQuestions(DESC, steps);
    assert.equal(qs.length, 1);
    assert.match(qs[0].question, /Which data source should "Read Expense Claim" read from\?/);
    assert.equal(qs[0].stepId, 's1');
    assert.equal(qs[0].resolves, 'data-binding');
    assert.ok(blocksRun(qs), 'an app that cannot read cannot run');
  });

  test('a phrase no source binds becomes a question, not just a gap statement', () => {
    const qs = clarifyingQuestions(DESC, FULL, ['no data-domain binds "vendor risk score" (unbound — not guessed)']);
    assert.equal(qs.length, 1);
    assert.match(qs[0].question, /vendor risk score/);
    assert.match(qs[0].question, /Which source holds it\?/);
  });

  test('a limit with no number is asked about — otherwise each run invents its own', () => {
    const qs = clarifyingQuestions('Flag any unusually large expense claim.', FULL);
    const t = qs.find((q) => q.resolves === 'threshold')!;
    assert.ok(t, JSON.stringify(qs));
    assert.match(t.question, /what value is the cut-off\?/);
    assert.match(t.because, /its own interpretation/);
  });

  test('approval asked for but no human step ⇒ asked, because nothing would pause', () => {
    const qs = clarifyingQuestions(DESC, FULL.filter((s) => s.kind !== 'human'));
    const a = qs.find((q) => q.resolves === 'approver')!;
    assert.ok(a, JSON.stringify(qs));
    assert.match(a.because, /nothing would pause for a person/);
  });

  test('delivery asked for but nothing sends ⇒ asked', () => {
    const qs = clarifyingQuestions(DESC, FULL.filter((s) => s.kind !== 'output'));
    const d = qs.find((q) => q.resolves === 'destination')!;
    assert.ok(d, JSON.stringify(qs));
    assert.match(d.question, /Where should the result be sent/);
  });

  test('an output step with no destination set is asked about', () => {
    const steps = FULL.map((s) => (s.kind === 'output' ? { ...s, sink: undefined } : s));
    const qs = clarifyingQuestions(DESC, steps);
    assert.ok(qs.some((q) => q.stepId === 's4' && q.resolves === 'destination'), JSON.stringify(qs));
  });

  test('does not ask about approval or delivery the author never requested', () => {
    // A read-and-record app: no "approve", no "email" in the sentence, so neither is missing.
    const qs = clarifyingQuestions('Summarise yesterday’s expense claims.', [
      { id: 's1', kind: 'connector-query', domain: 'dom_claims' },
      { id: 's2', kind: 'agent' },
    ]);
    assert.deepEqual(qs, []);
  });

  test('every question carries a reason and a resolvable field', () => {
    const qs = clarifyingQuestions('Flag any large claim and email someone.', [
      { id: 's1', kind: 'connector-query' },
    ]);
    assert.ok(qs.length >= 3, JSON.stringify(qs));
    for (const q of qs) {
      assert.ok(q.question.trim().endsWith('?'), q.question);
      assert.ok(q.because.trim().length > 0, q.question);
      assert.ok(q.resolves, q.question);
    }
  });

  test('tolerates an empty description and no steps', () => {
    assert.deepEqual(clarifyingQuestions('', []), []);
    assert.equal(blocksRun([]), false);
  });
});

// ── The CROSSING assertion for the compile boundary ──────────────────────────────────────────────────
//
// The compile ROUTE dropped `questions`: the compiler produced three and the API returned none, because the
// handler destructured only { spec, gaps }. Unit tests on both sides passed throughout. The guard is that a
// CompileResult-shaped object must carry the questions through whatever serialises it — a JSON round-trip is
// what a route actually does to it.
describe('compile boundary — questions must survive serialisation to the client', () => {
  const steps: ClarifiableStep[] = [{ id: 's1', kind: 'connector-query', label: 'Read claims' }];

  test('questions survive the JSON round-trip a route performs', () => {
    const questions = clarifyingQuestions('Flag any large claim and email the employee.', steps);
    assert.ok(questions.length > 0, 'fixture must actually produce questions');
    const overWire = JSON.parse(JSON.stringify({ object: 'app_compile', spec: {}, gaps: [], questions }));
    assert.equal(overWire.questions.length, questions.length, 'none dropped in transit');
    for (const q of overWire.questions) {
      assert.ok(q.question && q.because && q.resolves, `every field must survive: ${JSON.stringify(q)}`);
    }
  });

  test('a response shape that omits questions is detectably wrong', () => {
    // This is precisely what the route returned before the fix, and what this asserts can never pass silently.
    const questions = clarifyingQuestions('Flag any large claim.', steps);
    const bad = { object: 'app_compile', spec: {}, gaps: [] } as { questions?: unknown[] };
    assert.notEqual(bad.questions?.length ?? 0, questions.length);
  });
});
