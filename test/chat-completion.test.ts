// Reading a chat completion honestly.
//
// Live finding (2026-08-05): the guide copilot said "The AI is unavailable — showing the raw records
// instead" while the gateway was answering in 2.07 seconds. Measured on the box, same prompt:
//
//   max_tokens: 16  → finish_reason "length", content "",   reasoning_content 60+ chars
//   max_tokens: 600 → finish_reason "stop",   content "OK", reasoning_content 867 chars
//
// The fleet's only model is a REASONING model: chain of thought goes to `reasoning_content`, the answer
// to `content`. Too small a budget and it never reaches the answer. The caller read `content` alone, so
// "ran out of room" looked exactly like "gateway is down" — and an operator was sent to check a healthy
// service. These tests keep those three states distinguishable.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completionBudget,
  MIN_COMPLETION_BUDGET,
  readCompletion,
} from '@/lib/chat-completion';

const payload = (message: Record<string, unknown>, finish = 'stop') => ({
  choices: [{ message, finish_reason: finish }],
});

test('a real answer is read as an answer', () => {
  const r = readCompletion(payload({ content: 'OK', reasoning_content: 'x'.repeat(867) }));
  assert.equal(r.kind, 'answer');
  assert.equal(r.kind === 'answer' && r.text, 'OK');
  assert.equal(r.kind === 'answer' && r.reasoningChars, 867);
});

test('reasoning-only is TRUNCATED, not unavailable — the exact live bug', () => {
  // The whole point: the model was alive and working. Calling this an outage is a false alarm.
  const r = readCompletion(payload({ content: '', reasoning_content: 'thinking...' }, 'length'));
  assert.equal(r.kind, 'truncated-before-answer');
});

test('the reasoning text is never returned AS the answer', () => {
  // A model's private working contains false starts and self-correction. Presenting it as a conclusion
  // is the same defect as the source-echo fallback removed from the agent path today.
  const r = readCompletion(payload({ content: '', reasoning_content: 'Maybe A. No, actually B.' }));
  assert.ok(!('text' in r), 'no answer text is offered for a reasoning-only completion');
});

test('a genuinely empty completion is empty, not truncated', () => {
  for (const m of [{}, { content: '' }, { content: '   ', reasoning_content: '' }]) {
    assert.equal(readCompletion(payload(m)).kind, 'empty');
  }
});

test('a malformed or absent payload does not throw', () => {
  // This runs on whatever an upstream returned; a crash here would take out the surface entirely.
  for (const bad of [null, undefined, {}, { choices: [] }, { choices: [{}] }, 'nonsense', 42]) {
    assert.equal(readCompletion(bad).kind, 'empty');
  }
});

test('whitespace-only content is not an answer', () => {
  assert.equal(readCompletion(payload({ content: '\n  \t ' })).kind, 'empty');
});

test('the budget leaves real room for reasoning', () => {
  // 700 (the old value) was sized for the answer alone and is what caused the empty content.
  assert.ok(completionBudget(700) > 700);
  assert.equal(completionBudget(700), 2800);
  assert.equal(completionBudget(0), MIN_COMPLETION_BUDGET);
  assert.equal(completionBudget(-5), MIN_COMPLETION_BUDGET);
  assert.equal(completionBudget(Number.NaN), MIN_COMPLETION_BUDGET);
  assert.ok(completionBudget(1) >= MIN_COMPLETION_BUDGET, 'a tiny ask still gets thinking room');
});
