import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  availableChatPipelines,
  isChatPipelineAllowed,
  pipelineRunTag,
  resolveChatPipeline,
  resolveConsumerPipeline,
  type ChatBindingGovernance,
} from '../src/lib/chat-pipeline-policy.ts';

// PURE unit tests for the governed chat-binding rules (CONSUMERS-BIND #166). Zero IO.

const gov = (partial: Partial<ChatBindingGovernance> = {}): ChatBindingGovernance => ({
  defaultChatPipelineId: 'pl_default',
  allowlist: ['pl_a', 'pl_b'],
  ...partial,
});

// ─── availableChatPipelines ──────────────────────────────────────────────────────────────────────
test('availableChatPipelines: default first, then allowlist, de-duplicated', () => {
  assert.deepEqual(availableChatPipelines(gov()), ['pl_default', 'pl_a', 'pl_b']);
});

test('availableChatPipelines: default already in allowlist is not duplicated', () => {
  const g = gov({ defaultChatPipelineId: 'pl_a', allowlist: ['pl_a', 'pl_b'] });
  assert.deepEqual(availableChatPipelines(g), ['pl_a', 'pl_b']);
});

test('availableChatPipelines: no default → just the allowlist', () => {
  const g = gov({ defaultChatPipelineId: null, allowlist: ['pl_a'] });
  assert.deepEqual(availableChatPipelines(g), ['pl_a']);
});

// ─── isChatPipelineAllowed (the server-side gate) ──────────────────────────────────────────────────
test('isChatPipelineAllowed: null (inherit default) is always allowed', () => {
  assert.equal(isChatPipelineAllowed(null, gov()), true);
  assert.equal(isChatPipelineAllowed(undefined, gov()), true);
  assert.equal(isChatPipelineAllowed('', gov()), true);
});

test('isChatPipelineAllowed: an allowlisted pipeline is allowed', () => {
  assert.equal(isChatPipelineAllowed('pl_a', gov()), true);
});

test('isChatPipelineAllowed: the org default is always allowed (implicitly)', () => {
  const g = gov({ defaultChatPipelineId: 'pl_default', allowlist: [] });
  assert.equal(isChatPipelineAllowed('pl_default', g), true);
});

test('isChatPipelineAllowed: a disallowed pick is REJECTED (governance gate)', () => {
  assert.equal(isChatPipelineAllowed('pl_evil', gov()), false);
});

// ─── resolveChatPipeline (most-specific-wins) ──────────────────────────────────────────────────────
test('resolveChatPipeline: per-project override wins when allowed', () => {
  assert.equal(resolveChatPipeline({ pipelineId: 'pl_a' }, gov()), 'pl_a');
});

test('resolveChatPipeline: null project override falls back to the org default', () => {
  assert.equal(resolveChatPipeline({ pipelineId: null }, gov()), 'pl_default');
  assert.equal(resolveChatPipeline(null, gov()), 'pl_default');
});

test('resolveChatPipeline: a project pinning a NOW-disallowed pipeline falls back to the default', () => {
  // Admin removed pl_x from the set after the project pinned it — resolution can't retain it.
  assert.equal(resolveChatPipeline({ pipelineId: 'pl_x' }, gov()), 'pl_default');
});

test('resolveChatPipeline: no override + no default → null (ungoverned/off)', () => {
  const g = gov({ defaultChatPipelineId: null, allowlist: [] });
  assert.equal(resolveChatPipeline({ pipelineId: null }, g), null);
});

// ─── resolveConsumerPipeline (app/agent) + run tag ─────────────────────────────────────────────────
test('resolveConsumerPipeline: the bound pipeline wins, else the org default, else null', () => {
  assert.equal(resolveConsumerPipeline('pl_app', 'pl_default'), 'pl_app');
  assert.equal(resolveConsumerPipeline(null, 'pl_default'), 'pl_default');
  assert.equal(resolveConsumerPipeline(undefined, null), null);
});

test('pipelineRunTag: produces pipeline:<id> or null', () => {
  assert.equal(pipelineRunTag('pl_a'), 'pipeline:pl_a');
  assert.equal(pipelineRunTag(null), null);
  assert.equal(pipelineRunTag(undefined), null);
});
