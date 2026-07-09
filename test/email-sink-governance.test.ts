import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emailEgressVerdict,
  emailMaskingRequired,
  maskEmailForSend,
  selectEmailProvider,
} from '@/lib/email-sink-governance';
import type { PipelineContract } from '@/lib/pipeline-enforcement';

// Build a contract with a routing leash tuned to a target egress for the 'general' data-class, and
// (optionally) an org guardrail default + overlay so masking can be escalated the SAME way the model
// path does. deriveEgress: no rule ⇒ 'local'; a cloud rule + egressAllowed ⇒ 'cloud'; a cloud rule +
// egressAllowed:false ⇒ 'block'. effectiveGovernance escalates a `default` control when the overlay
// sets bool:true.
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
        : { egressAllowed: false, rules: [cloudRule] }; // cloud rule + egress off ⇒ leashed to block
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

// ─── selectEmailProvider — default SMTP, explicit resend ───────────────────────────────────────────

test('selectEmailProvider defaults to smtp, honors provider/via = resend', () => {
  assert.equal(selectEmailProvider(undefined), 'smtp');
  assert.equal(selectEmailProvider({}), 'smtp');
  assert.equal(selectEmailProvider({ provider: 'resend' }), 'resend');
  assert.equal(selectEmailProvider({ via: 'resend' }), 'resend');
  assert.equal(selectEmailProvider({ provider: 'bogus' }), 'smtp');
});

// ─── emailEgressVerdict — SMTP always allowed; Resend leashed ──────────────────────────────────────

test('SMTP is always allowed (air-gapped, no cloud egress) regardless of contract', () => {
  const v = emailEgressVerdict(contractFor('block'), 'smtp');
  assert.equal(v.allow, true);
});

test('Resend allowed when there is NO pipeline (legacy permissive)', () => {
  assert.equal(emailEgressVerdict(null, 'resend').allow, true);
});

test('Resend DENIED when the pipeline egress leash blocks', () => {
  const v = emailEgressVerdict(contractFor('block'), 'resend');
  assert.equal(v.allow, false);
  assert.match(v.reason, /blocked/i);
});

test('Resend DENIED when the pipeline is leashed to LOCAL (stay on-prem)', () => {
  const v = emailEgressVerdict(contractFor('local'), 'resend');
  assert.equal(v.allow, false);
  assert.match(v.reason, /LOCAL/);
});

test('Resend ALLOWED when the egress leash permits cloud', () => {
  const v = emailEgressVerdict(contractFor('cloud'), 'resend');
  assert.equal(v.allow, true);
});

// ─── emailMaskingRequired — driven by the guardrail overlay ────────────────────────────────────────

test('emailMaskingRequired false with no pipeline; true when the overlay escalates masking on', () => {
  assert.equal(emailMaskingRequired(null), false);
  assert.equal(emailMaskingRequired(contractFor('cloud', false)), false);
  assert.equal(emailMaskingRequired(contractFor('cloud', true)), true);
});

// ─── maskEmailForSend — the raw→redacted substitution (reuses applyPiiEscalation) ─────────────────

test('maskEmailForSend leaves text unchanged when masking not required', () => {
  const out = maskEmailForSend('Subj PAN', 'body PAN', false, { hits: true, redacted: 'x' }, { hits: true, redacted: 'y' });
  assert.equal(out.subject, 'Subj PAN');
  assert.equal(out.text, 'body PAN');
  assert.equal(out.masked, false);
});

test('maskEmailForSend redacts subject+body before send when required and PII present', () => {
  const out = maskEmailForSend(
    'PAN ABCDE1234F',
    'card ABCDE1234F sent',
    true,
    { hits: true, redacted: 'PAN [REDACTED]' },
    { hits: true, redacted: 'card [REDACTED] sent' },
  );
  assert.equal(out.subject, 'PAN [REDACTED]');
  assert.equal(out.text, 'card [REDACTED] sent');
  assert.equal(out.masked, true);
});

test('maskEmailForSend required but nothing to redact → unchanged, masked:false', () => {
  const out = maskEmailForSend('clean', 'clean body', true, { hits: false }, { hits: false });
  assert.equal(out.masked, false);
  assert.equal(out.text, 'clean body');
});
