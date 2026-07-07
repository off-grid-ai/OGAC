import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shapeCloudRequest, cloudHeaders } from '../src/lib/cloud-client.ts';
import { egressAuditEvent, egressBlockedAuditEvent } from '../src/lib/cloud-egress-audit.ts';
import type { CloudSelection } from '../src/lib/cloud-providers.ts';
import type { CloudPlan } from '../src/lib/cloud-routing.ts';
import { costUsdFor } from '../src/lib/audit-event.ts';

// PURE request-shaping + audit-builder tests. The adapter's fetch is I/O and not exercised here; its
// SHAPE is (the load-bearing part: correct upstream model + auth, local-only knobs stripped).

const selection: CloudSelection = {
  provider: { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-secret', prefixes: ['openai'], defaultModel: 'gpt-4o-mini' },
  model: 'gpt-4o-mini',
};

test('shape: rewrites model to the upstream id, drops llama.cpp-only chat_template_kwargs', () => {
  const body = {
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 2048,
    stream: true,
    chat_template_kwargs: { enable_thinking: false },
  };
  const shaped = shapeCloudRequest(body, selection);
  assert.equal(shaped.model, 'gpt-4o-mini');
  assert.equal('chat_template_kwargs' in shaped, false);
  assert.deepEqual(shaped.messages, body.messages);
  assert.equal(shaped.stream, true);
});

test('headers: bearer auth carries the provider key', () => {
  assert.deepEqual(cloudHeaders(selection.provider), {
    'content-type': 'application/json',
    authorization: 'Bearer sk-secret',
  });
});

// ── Egress audit builders (cost attribution + egress logging) ────────────────────
const cloudPlan: CloudPlan = { kind: 'cloud', selection, cloudUnavailable: false, model: 'gpt-4o-mini', reason: 'public → cloud' };
const ctx = { actor: { type: 'user' as const, id: 'a@b.co', label: 'a@b.co' }, org: 'default', project: null };

test('egress audit: emits gateway.egress with provider-namespaced model + token triple', () => {
  const ev = egressAuditEvent(ctx, cloudPlan, { promptTokens: 100, completionTokens: 50 }, 'ok');
  assert.equal(ev.action, 'gateway.egress');
  assert.equal(ev.model, 'openai:gpt-4o-mini');
  assert.equal(ev.resource, 'provider:openai');
  assert.deepEqual(ev.tokens, { prompt: 100, completion: 50, total: 150 });
  assert.equal(ev.outcome, 'ok');
  // Cost auto-derives from model + total tokens (buildAuditEvent) — the provider-namespaced model is
  // non-local so it prices as cloud (> 0).
  assert.ok(costUsdFor('openai:gpt-4o-mini', 150) > 0);
});

test('egress-blocked audit: leash and unavailable are both recorded as blocked outcomes', () => {
  const leashed: CloudPlan = { kind: 'block', selection: null, cloudUnavailable: false, model: null, reason: 'egress off' };
  const unavailable: CloudPlan = { kind: 'local', selection: null, cloudUnavailable: true, model: null, reason: 'no provider' };
  assert.equal(egressBlockedAuditEvent(ctx, leashed).outcome, 'blocked');
  assert.equal(egressBlockedAuditEvent(ctx, leashed).resource, 'provider:leashed');
  assert.equal(egressBlockedAuditEvent(ctx, unavailable).resource, 'provider:unavailable');
});
