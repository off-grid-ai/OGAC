import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildConditionalBranch,
  detectConditional,
} from '../src/lib/app-compile.ts';
import { evaluateGuard } from '../src/lib/app-run-plan.ts';

// The plain-language builder must turn "if X, A, else B" into a real BRANCH (a decision agent + two
// guarded edges), not a linear approximation. These prove the pure recognizer + builder; the runner
// honoring the guards is proven in app-run-branching / app-run tests.

test('detectConditional: if/then/else with commas (the FNOL phrasing)', () => {
  const c = detectConditional('if the claim is over 1 lakh, route to a surveyor, otherwise auto-approve it');
  assert.ok(c);
  assert.match(c!.condition, /claim is over 1 lakh/);
  assert.match(c!.thenText, /route to a surveyor/);
  assert.match(c!.elseText ?? '', /auto-approve/);
});

test('detectConditional: explicit "then", "else"', () => {
  const c = detectConditional('if the balance is sufficient then release the payment else flag for review');
  assert.ok(c);
  assert.match(c!.condition, /balance is sufficient/);
  assert.match(c!.thenText, /release the payment/);
  assert.match(c!.elseText ?? '', /flag for review/);
});

test('detectConditional: if-only (no else) still parses a single guarded branch', () => {
  const c = detectConditional('if the document is a duplicate, reject it');
  assert.ok(c);
  assert.match(c!.condition, /document is a duplicate/);
  assert.match(c!.thenText, /reject it/);
  assert.equal(c!.elseText, null);
});

test('detectConditional: no "if" ⇒ null; an "if" that cannot split condition/action ⇒ null', () => {
  assert.equal(detectConditional('read the invoice and notify the team'), null);
  assert.equal(detectConditional('if eligible'), null); // no then / no comma to split an action
});

test('buildConditionalBranch: emits a decision agent + a yes/no guarded edge per branch', () => {
  const cond = detectConditional('if the claim is over 1 lakh, route to a surveyor, otherwise auto-approve')!;
  const { steps, edges, leaves } = buildConditionalBranch(cond, 1);

  // decision agent instructed to answer YES/NO, then a step per branch
  assert.equal(steps[0].kind, 'agent');
  assert.equal(steps[0].id, 's1');
  assert.match((steps[0] as { inlineAgent?: { systemPrompt: string } }).inlineAgent!.systemPrompt, /YES or NO/);
  assert.equal(steps.length, 3, 'decision + then + else');

  // both edges leave the decision, guarded on the YES / NO token
  assert.deepEqual(edges.map((e) => e.from), ['s1', 's1']);
  assert.deepEqual(edges.map((e) => e.to), ['s2', 's3']);
  assert.match(edges[0].when ?? '', /s1 contains "yes"/);
  assert.match(edges[1].when ?? '', /s1 contains "no"/);
  assert.deepEqual(leaves, ['s2', 's3']);
});

test('buildConditionalBranch: the emitted guards actually route with the runner guard-evaluator', () => {
  const cond = detectConditional('if approved, pay the claim, otherwise reject it')!;
  const { edges } = buildConditionalBranch(cond, 1);
  const [thenEdge, elseEdge] = edges;
  // A decision output of "YES" activates the then-edge only; "NO" activates the else-edge only.
  assert.equal(evaluateGuard(thenEdge.when, { s1: 'YES' }), true);
  assert.equal(evaluateGuard(elseEdge.when, { s1: 'YES' }), false);
  assert.equal(evaluateGuard(thenEdge.when, { s1: 'the answer is NO' }), false);
  assert.equal(evaluateGuard(elseEdge.when, { s1: 'the answer is NO' }), true);
});

test('buildConditionalBranch: an if-only conditional emits a single guarded branch', () => {
  const cond = detectConditional('if the document is a duplicate, reject it')!;
  const { steps, edges, leaves } = buildConditionalBranch(cond, 1);
  assert.equal(steps.length, 2, 'decision + one branch');
  assert.equal(edges.length, 1);
  assert.match(edges[0].when ?? '', /s1 contains "yes"/);
  assert.deepEqual(leaves, ['s2']);
});
