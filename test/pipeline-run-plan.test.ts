import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PLATFORM_DEFAULT_MODEL,
  buildRunPlan,
  chooseModel,
  extractPrompt,
} from '@/lib/pipeline-run-plan';
import type { ModelCallVerdict } from '@/lib/pipeline-enforcement';

// PURE unit tests for the public-pipeline execution planner (PA-11). No I/O, no mocks — exercise the
// exact model-precedence, egress-narrowing, overlay-passthrough, and prompt-extraction decisions the
// executor relies on.

function verdict(over: Partial<ModelCallVerdict> = {}): ModelCallVerdict {
  return {
    allow: true,
    egress: 'cloud',
    forceLocal: false,
    requirePiiMasking: false,
    blockPromptInjection: false,
    requirePurpose: false,
    reason: 'ok',
    noPipeline: false,
    ...over,
  };
}

// ─── chooseModel — leash > pipeline default > platform default ─────────────────────────────────────
test('chooseModel: the leash model wins when the routing rule pinned one', () => {
  assert.equal(chooseModel('llama-local', 'gemma-local', 'x-default'), 'llama-local');
});

test('chooseModel: falls back to the pipeline default when the leash names none', () => {
  assert.equal(chooseModel(null, 'gemma-local', 'x-default'), 'gemma-local');
  assert.equal(chooseModel('   ', 'gemma-local'), 'gemma-local');
});

test('chooseModel: falls back to the injected platform default when neither is set', () => {
  assert.equal(chooseModel(null, null, 'x-default'), 'x-default');
  assert.equal(chooseModel('', ''), PLATFORM_DEFAULT_MODEL);
});

// ─── buildRunPlan — egress narrowing + overlay passthrough ─────────────────────────────────────────
test('buildRunPlan: a cloud verdict plans a cloud, not-force-local call', () => {
  const p = buildRunPlan(verdict({ egress: 'cloud' }), null, 'gemma-local');
  assert.equal(p.egress, 'cloud');
  assert.equal(p.forceLocal, false);
  assert.equal(p.model, 'gemma-local');
});

test('buildRunPlan: a local verdict forces local (never a cloud reach)', () => {
  const p = buildRunPlan(verdict({ egress: 'local', forceLocal: true }), null, 'gemma-local');
  assert.equal(p.egress, 'local');
  assert.equal(p.forceLocal, true);
});

test('buildRunPlan: a stray block egress is coerced to local (safe default, never trusted as cloud)', () => {
  // A blocked verdict should never reach the planner, but if a mis-wired caller passes one, the plan
  // must NOT plan a cloud reach — it collapses to the on-prem default.
  const p = buildRunPlan(verdict({ egress: 'block' as unknown as 'cloud' }), null, 'gemma-local');
  assert.equal(p.egress, 'local');
  assert.equal(p.forceLocal, true);
});

test('buildRunPlan: policy/guardrail overlay flags pass straight through', () => {
  const p = buildRunPlan(
    verdict({ requirePiiMasking: true, blockPromptInjection: true, requirePurpose: true }),
    null,
    'gemma-local',
  );
  assert.equal(p.requirePiiMasking, true);
  assert.equal(p.blockPromptInjection, true);
  assert.equal(p.requirePurpose, true);
});

// ─── extractPrompt — bare string OR OpenAI-style messages ──────────────────────────────────────────
test('extractPrompt: reads a bare `input` string', () => {
  assert.equal(extractPrompt({ input: '  hello  ' }), 'hello');
});

test('extractPrompt: reads a bare `prompt` string', () => {
  assert.equal(extractPrompt({ prompt: 'why is the sky blue' }), 'why is the sky blue');
});

test('extractPrompt: reads the LAST user message from a messages array', () => {
  const body = {
    messages: [
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'second' },
    ],
  };
  assert.equal(extractPrompt(body), 'second');
});

test('extractPrompt: falls back to the last message of any role', () => {
  assert.equal(extractPrompt({ messages: [{ role: 'system', content: 'lone system' }] }), 'lone system');
});

test('extractPrompt: returns empty when there is nothing usable', () => {
  assert.equal(extractPrompt({}), '');
  assert.equal(extractPrompt({ input: '   ' }), '');
  assert.equal(extractPrompt({ messages: [] }), '');
});
