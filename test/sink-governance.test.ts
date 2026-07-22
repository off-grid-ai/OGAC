import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cloudEgressVerdict,
  maskTextForSend,
  sinkMaskingRequired,
} from '@/lib/adapters/sinks/sink-governance';
import type { PiiScanLike } from '@/lib/guardrail-rules-runtime';
import type { PipelineContract } from '@/lib/pipeline-enforcement';

// Same contract builder the email-sink-governance test uses (one routing leash for the 'general'
// data-class + an optional PII-mask overlay), so the shared authority is exercised the SAME way the
// model path + email sink exercise it. deriveEgress: no rule ⇒ 'local'; cloud rule + egressAllowed ⇒
// 'cloud'; cloud rule + egressAllowed:false ⇒ 'block'.
function contractFor(egress: 'local' | 'cloud' | 'block', maskOn = false): PipelineContract {
  const cloudRule = {
    name: 'r',
    priority: 1,
    enabled: true,
    attribute: 'data_class',
    operator: 'eq',
    value: 'general',
    action: 'cloud',
    model: '',
    fallback: '',
  };
  const routing =
    egress === 'local'
      ? { egressAllowed: true, rules: [] }
      : egress === 'cloud'
        ? { egressAllowed: true, rules: [cloudRule] }
        : { egressAllowed: false, rules: [cloudRule] };
  return {
    pipelineId: 'pl_test',
    dataAllowlist: [],
    routing: routing as never,
    orgPolicyDefaults: {},
    orgGuardrailDefaults: { requirePiiMasking: { mode: 'default', bool: false } },
    policyOverlay: {},
    guardrailOverlay: maskOn ? { requirePiiMasking: { bool: true } } : {},
  } as PipelineContract;
}

// ─── cloudEgressVerdict — air-gapped always allowed; cloud leashed ─────────────────────────────────

test('air-gapped transport is always allowed regardless of contract', () => {
  for (const egress of ['local', 'cloud', 'block'] as const) {
    const v = cloudEgressVerdict(contractFor(egress), 'air-gapped', 'WhatsApp');
    assert.equal(v.allow, true);
    assert.equal(v.egress, 'local');
    assert.match(v.reason, /air-gapped/);
  }
});

test('cloud transport allowed when there is NO pipeline (legacy permissive)', () => {
  const v = cloudEgressVerdict(null, 'cloud', 'webhook');
  assert.equal(v.allow, true);
  assert.match(v.reason, /permits cloud webhook/);
});

test('cloud transport DENIED when the egress leash blocks', () => {
  const v = cloudEgressVerdict(contractFor('block'), 'cloud', 'webhook');
  assert.equal(v.allow, false);
  assert.match(v.reason, /blocked cloud webhook/i);
});

test('cloud transport DENIED when leashed to LOCAL (stay on-prem)', () => {
  const v = cloudEgressVerdict(contractFor('local'), 'cloud', 'Slack message');
  assert.equal(v.allow, false);
  assert.match(v.reason, /LOCAL/);
  assert.match(v.reason, /Slack message/);
});

test('cloud transport ALLOWED when the egress leash permits cloud', () => {
  const v = cloudEgressVerdict(contractFor('cloud'), 'cloud', 'webhook');
  assert.equal(v.allow, true);
  assert.equal(v.egress, 'cloud');
});

test('transportLabel defaults to "delivery" when omitted', () => {
  const v = cloudEgressVerdict(null, 'cloud');
  assert.match(v.reason, /permits cloud delivery/);
});

// ─── sinkMaskingRequired ───────────────────────────────────────────────────────────────────────────

test('sinkMaskingRequired false with no pipeline; true when overlay escalates masking on', () => {
  assert.equal(sinkMaskingRequired(null), false);
  assert.equal(sinkMaskingRequired(contractFor('cloud', false)), false);
  assert.equal(sinkMaskingRequired(contractFor('cloud', true)), true);
});

// ─── maskTextForSend ────────────────────────────────────────────────────────────────────────────────

const scanClean: PiiScanLike = { hits: false };
const scanHit: PiiScanLike = { hits: true, redacted: 'PAN [PII_REDACTED]' };

test('maskTextForSend leaves text unchanged when masking not required', () => {
  const r = maskTextForSend('PAN ABCDE1234F', false, scanHit);
  assert.equal(r.text, 'PAN ABCDE1234F');
  assert.equal(r.masked, false);
});

test('maskTextForSend redacts when required and PII present', () => {
  const r = maskTextForSend('PAN ABCDE1234F', true, scanHit);
  assert.equal(r.text, 'PAN [PII_REDACTED]');
  assert.equal(r.masked, true);
});

test('maskTextForSend required but nothing to redact → unchanged, masked:false', () => {
  const r = maskTextForSend('hello world', true, scanClean);
  assert.equal(r.text, 'hello world');
  assert.equal(r.masked, false);
});
