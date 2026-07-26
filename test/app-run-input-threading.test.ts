import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAgentQuery,
  describeRunInput,
  MAX_RUN_INPUT_CHARS,
  type AppStep,
  type StepResult,
} from '../src/lib/app-run.ts';
import { parseRunQuery } from '../src/lib/run-query-view.ts';

// G-APP-INPUT-DROPPED: an app's agent step never saw what the person submitted. buildAgentQuery
// composed the model query from the step label + prior step outputs only, so an app whose first step
// was an agent ran, reported `done`, and answered "no question was provided" — a silent wrong answer.

const step = (label: string): AppStep =>
  ({ id: 's1', kind: 'agent', label, inlineAgent: { systemPrompt: 'x' } }) as AppStep;

const prior = (kind: StepResult['kind'], output: string): StepResult =>
  ({ stepId: `p_${kind}`, kind, status: 'done', output }) as StepResult;

// ─── the defect itself ────────────────────────────────────────────────────────────────────────────

test('a first agent step is asked the question the person actually submitted', () => {
  const q = buildAgentQuery(step('Answer the question'), [], {
    question: 'What is the Re-KYC window for medium-risk customers?',
  });

  assert.match(q, /What is the Re-KYC window for medium-risk customers\?/);
  assert.match(q, /TASK: Answer the question/);
});

test('the request is stated before the task, so the label cannot be mistaken for the question', () => {
  const q = buildAgentQuery(step('Answer the question'), [], { question: 'Is this PAN valid?' });
  assert.ok(q.indexOf('Is this PAN valid?') < q.indexOf('TASK:'));
});

test('a multi-field form reaches the model intact, not just its first field', () => {
  const q = buildAgentQuery(step('Underwrite'), [], {
    panNumber: 'ABCDE1234F',
    amount: 250000,
    branch: 'Andheri East',
  });
  assert.match(q, /panNumber: ABCDE1234F/);
  assert.match(q, /amount: 250000/);
  assert.match(q, /branch: Andheri East/);
});

test('prior step context and the request are both present, request first', () => {
  const q = buildAgentQuery(step('Recommend a product'), [prior('agent', 'Customer is low risk.')], {
    question: 'What should we offer this customer?',
  });
  assert.ok(q.indexOf('What should we offer this customer?') < q.indexOf('Customer is low risk.'));
  assert.match(q, /CONTEXT FROM PRIOR STEPS:/);
  assert.match(q, /- \[agent\] Customer is low risk\./);
  assert.match(q, /TASK: Recommend a product/);
});

// ─── behaviour must be unchanged when there is no input (additive) ────────────────────────────────

test('with no input at all the query is exactly what it was before: the bare label', () => {
  assert.equal(buildAgentQuery(step('Verify KYC'), []), 'Verify KYC');
  assert.equal(buildAgentQuery(step('Verify KYC'), [], {}), 'Verify KYC');
  assert.equal(buildAgentQuery(step('Verify KYC'), [], undefined), 'Verify KYC');
});

test('with prior context but no input the composed shape is unchanged', () => {
  const q = buildAgentQuery(step('Decide'), [prior('agent', 'upstream answer')]);
  assert.equal(q, 'CONTEXT FROM PRIOR STEPS:\n- [agent] upstream answer\n\nTASK: Decide');
});

test('connector evidence still stays out of the prompt — it travels as sources', () => {
  // Copying rows in duplicates sensitive data and collapses source provenance into prompt text.
  const q = buildAgentQuery(step('Decide'), [prior('connector-query', 'Read 12 row(s). [{...}]')], {
    question: 'Approve?',
  });
  assert.doesNotMatch(q, /Read 12 row/);
  assert.match(q, /Approve\?/);
});

// ─── rendering the submitted input ───────────────────────────────────────────────────────────────

test('a single free-text field is passed through verbatim, not wrapped in key noise', () => {
  assert.equal(describeRunInput({ question: 'Why was this claim rejected?' }), 'Why was this claim rejected?');
  assert.equal(describeRunInput({ input: '  padded  ' }), 'padded');
});

test('a single field that is NOT a request field keeps its name for context', () => {
  assert.equal(describeRunInput({ policyNumber: 'PL-99213' }), 'policyNumber: PL-99213');
});

test('empty, blank and nested values contribute nothing', () => {
  assert.equal(describeRunInput({}), '');
  assert.equal(describeRunInput(undefined), '');
  assert.equal(describeRunInput({ question: '   ' }), '');
  assert.equal(describeRunInput({ a: null, b: undefined }), '');
  assert.equal(describeRunInput({ nested: { x: 1 }, ifsc: 'HDFC0001234' }), 'ifsc: HDFC0001234');
  assert.doesNotMatch(describeRunInput({ nested: { x: 1 }, ifsc: 'H' }), /object Object/);
});

test('a huge webhook payload cannot blow up the prompt', () => {
  const big = describeRunInput({ question: 'q'.repeat(MAX_RUN_INPUT_CHARS * 3) });
  assert.equal(big.length, MAX_RUN_INPUT_CHARS);
});

// ─── the parser is the composer's inverse (they must not drift) ───────────────────────────────────

test('every composed shape round-trips through parseRunQuery', () => {
  const cases: [string, Record<string, unknown> | undefined, StepResult[]][] = [
    ['bare label', undefined, []],
    ['request only', { question: 'Is this PAN valid?' }, []],
    ['context only', undefined, [prior('agent', 'upstream answer')]],
    ['request and context', { question: 'Approve this?' }, [prior('agent', 'upstream answer')]],
  ];

  for (const [name, input, priors] of cases) {
    const composed = buildAgentQuery(step('Do the thing'), priors, input);
    const view = parseRunQuery(composed);

    assert.equal(view.task, 'Do the thing', `${name}: task`);
    assert.equal(view.request, input ? describeRunInput(input) : '', `${name}: request`);
    assert.equal(view.context.length, priors.length, `${name}: context count`);
    if (priors.length) assert.equal(view.context[0].text, 'upstream answer', `${name}: context text`);
  }
});

test('a request-first query no longer collapses into one big task string', () => {
  // The regression this guards: before the parser knew about THE REQUEST, the whole composed blob
  // became the "task" and the operator's Query panel showed it as the title.
  const composed = buildAgentQuery(step('Answer it'), [], { question: 'What is the Re-KYC window?' });
  const view = parseRunQuery(composed);

  assert.equal(view.task, 'Answer it');
  assert.equal(view.request, 'What is the Re-KYC window?');
  assert.doesNotMatch(view.task, /THE REQUEST/);
});

test('a plain uncomposed query still parses to itself with no request', () => {
  const view = parseRunQuery('What is the Re-KYC window for medium-risk customers?');
  assert.equal(view.task, 'What is the Re-KYC window for medium-risk customers?');
  assert.deepEqual(view.context, []);
  assert.equal(view.request, '');
});
