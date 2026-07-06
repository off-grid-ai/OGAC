import assert from 'node:assert/strict';
import { test } from 'node:test';
import { thinkingState, thinkingLabel } from '../src/lib/chat-thinking.ts';

// Pure tests for the inline "Thinking" block lifecycle — NO React, NO mocks. This governs the
// task's rule: thinking streams above the answer, then collapses once the answer starts.

test('thinkingState: no reasoning → hidden, nothing renders', () => {
  assert.deepEqual(thinkingState('', '', true), { phase: 'hidden', hasReasoning: false, defaultOpen: false });
  assert.deepEqual(thinkingState(null, 'answer', false), { phase: 'hidden', hasReasoning: false, defaultOpen: false });
  assert.deepEqual(thinkingState('   ', '', true), { phase: 'hidden', hasReasoning: false, defaultOpen: false });
});

test('thinkingState: reasoning arriving, answer not started, streaming → expanded live block', () => {
  const s = thinkingState('Let me think', '', true);
  assert.equal(s.phase, 'streaming');
  assert.equal(s.defaultOpen, true);
  assert.equal(s.hasReasoning, true);
});

test('thinkingState: answer started (still streaming) → collapse by default', () => {
  const s = thinkingState('Reasoned about it', 'The answer is', true);
  assert.equal(s.phase, 'done');
  assert.equal(s.defaultOpen, false);
});

test('thinkingState: generation finished with reasoning → done, collapsed', () => {
  const s = thinkingState('Reasoned', 'Final answer.', false);
  assert.equal(s.phase, 'done');
  assert.equal(s.defaultOpen, false);
});

test('thinkingState: reasoning present but stream ended before any answer → done (collapsed)', () => {
  const s = thinkingState('Reasoned but no answer', '', false);
  assert.equal(s.phase, 'done');
  assert.equal(s.defaultOpen, false);
});

test('thinkingLabel: ellipsis only while streaming', () => {
  assert.equal(thinkingLabel('streaming'), 'Thinking…');
  assert.equal(thinkingLabel('done'), 'Thinking');
  assert.equal(thinkingLabel('hidden'), 'Thinking');
});
