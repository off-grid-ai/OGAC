import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractVariables, renderPromptTemplate } from '../src/lib/prompt-template.ts';

// PURE unit tests for the prompt-detail "fill & copy" template rendering (UX-audit T4 item 3).

test('renders supplied variables, leaves unfilled ones as their placeholder', () => {
  const tpl = 'Hello {{name}}, your ticket {{id}} is {{status}}.';
  const out = renderPromptTemplate(tpl, { name: 'Asha', status: 'open' });
  assert.equal(out, 'Hello Asha, your ticket {{id}} is open.');
});

test('substitutes every occurrence of the same variable', () => {
  const out = renderPromptTemplate('{{x}} and {{x}} again', { x: 'Z' });
  assert.equal(out, 'Z and Z again');
});

test('tolerates whitespace inside the braces (same grammar as extractVariables)', () => {
  const tpl = 'Amount {{ amount }} in INR';
  assert.deepEqual(extractVariables(tpl), ['amount']);
  assert.equal(renderPromptTemplate(tpl, { amount: '1000' }), 'Amount 1000 in INR');
});

test('empty-string value is treated as unfilled (placeholder kept)', () => {
  assert.equal(renderPromptTemplate('Hi {{name}}', { name: '' }), 'Hi {{name}}');
});

test('a template with no variables is returned unchanged', () => {
  assert.equal(renderPromptTemplate('plain text', { x: 'y' }), 'plain text');
});
