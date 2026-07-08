// CONDITION-COVERAGE tests for chat-pipeline-policy.ts — the last uncovered branch is the
// `gov.allowlist ?? []` nullish arm in availableChatPipelines, plus the de-dup/skip guards and every
// resolution fallback in resolveChatPipeline / resolveConsumerPipeline. Additive; existing exports.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ChatBindingGovernance,
  availableChatPipelines,
  isChatPipelineAllowed,
  pipelineRunTag,
  resolveChatPipeline,
  resolveConsumerPipeline,
} from '@/lib/chat-pipeline-policy';

// ─── availableChatPipelines — default+allowlist merge, de-dup, null-skip, missing-allowlist arm ────

test('available: default first, then allowlist, de-duplicated', () => {
  const gov: ChatBindingGovernance = { defaultChatPipelineId: 'pl_def', allowlist: ['pl_a', 'pl_def', 'pl_b'] };
  assert.deepEqual(availableChatPipelines(gov), ['pl_def', 'pl_a', 'pl_b']);
});

test('available: null default is not added (the `if (!id) return` skip arm)', () => {
  const gov: ChatBindingGovernance = { defaultChatPipelineId: null, allowlist: ['pl_a'] };
  assert.deepEqual(availableChatPipelines(gov), ['pl_a']);
});

test('available: a MISSING allowlist hits the `?? []` nullish arm (line 41) → just the default', () => {
  // allowlist deliberately absent to force the nullish fallback.
  const gov = { defaultChatPipelineId: 'pl_def' } as unknown as ChatBindingGovernance;
  assert.deepEqual(availableChatPipelines(gov), ['pl_def']);
});

test('available: empty everything → empty list', () => {
  assert.deepEqual(availableChatPipelines({ defaultChatPipelineId: null, allowlist: [] }), []);
});

// ─── isChatPipelineAllowed — null legal arm, in-set arm, out-of-set arm ────────────────────────────

test('allowed: null/empty pick is always legal (inherit-default arm)', () => {
  const gov: ChatBindingGovernance = { defaultChatPipelineId: 'pl_def', allowlist: [] };
  assert.equal(isChatPipelineAllowed(null, gov), true);
  assert.equal(isChatPipelineAllowed(undefined, gov), true);
  assert.equal(isChatPipelineAllowed('', gov), true);
});

test('allowed: a pipeline in the available set is legal; one outside is not', () => {
  const gov: ChatBindingGovernance = { defaultChatPipelineId: 'pl_def', allowlist: ['pl_a'] };
  assert.equal(isChatPipelineAllowed('pl_a', gov), true);
  assert.equal(isChatPipelineAllowed('pl_def', gov), true); // default always allowed
  assert.equal(isChatPipelineAllowed('pl_rogue', gov), false);
});

// ─── resolveChatPipeline — override wins (if allowed), else default, else null ─────────────────────

test('resolve chat: an allowed project override wins (most-specific)', () => {
  const gov: ChatBindingGovernance = { defaultChatPipelineId: 'pl_def', allowlist: ['pl_ov'] };
  assert.equal(resolveChatPipeline({ pipelineId: 'pl_ov' }, gov), 'pl_ov');
});

test('resolve chat: a NO-LONGER-allowed override falls back to the org default', () => {
  const gov: ChatBindingGovernance = { defaultChatPipelineId: 'pl_def', allowlist: [] };
  // pl_stale is not in the available set anymore → override rejected → default.
  assert.equal(resolveChatPipeline({ pipelineId: 'pl_stale' }, gov), 'pl_def');
});

test('resolve chat: null project + null default → null (both fallbacks exhausted)', () => {
  const gov: ChatBindingGovernance = { defaultChatPipelineId: null, allowlist: [] };
  assert.equal(resolveChatPipeline(null, gov), null);
  assert.equal(resolveChatPipeline({ pipelineId: null }, gov), null);
});

// ─── resolveConsumerPipeline — bound || orgDefault || null (every OR arm) ──────────────────────────

test('resolve consumer: bound binding wins', () => {
  assert.equal(resolveConsumerPipeline('pl_bound', 'pl_def'), 'pl_bound');
});

test('resolve consumer: no binding falls to org default (second OR arm)', () => {
  assert.equal(resolveConsumerPipeline(null, 'pl_def'), 'pl_def');
  assert.equal(resolveConsumerPipeline('', 'pl_def'), 'pl_def');
});

test('resolve consumer: neither → null (final OR arm)', () => {
  assert.equal(resolveConsumerPipeline(null, null), null);
  assert.equal(resolveConsumerPipeline(undefined, undefined), null);
});

// ─── pipelineRunTag — both arms ────────────────────────────────────────────────────────────────────

test('pipelineRunTag: id → tagged; null/empty → null', () => {
  assert.equal(pipelineRunTag('pl_x'), 'pipeline:pl_x');
  assert.equal(pipelineRunTag(null), null);
  assert.equal(pipelineRunTag(''), null);
});
