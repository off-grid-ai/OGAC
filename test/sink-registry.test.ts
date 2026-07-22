import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getSinkDescriptor,
  planSinkGovernance,
  SINK_REGISTRY,
  type DeliverSinkKind,
} from '@/lib/adapters/sinks/registry';
import type { PiiScanLike } from '@/lib/guardrail-rules-runtime';
import type { PipelineContract } from '@/lib/pipeline-enforcement';

// Same contract builder as the governance tests: a routing leash for 'general' + an optional mask
// overlay. egress: local / cloud / block; maskOn escalates PII masking.
function contractFor(egress: 'local' | 'cloud' | 'block', maskOn = false): PipelineContract {
  const cloudRule = {
    name: 'r', priority: 1, enabled: true, attribute: 'data_class',
    operator: 'eq', value: 'general', action: 'cloud', model: '', fallback: '',
  };
  const routing =
    egress === 'local'
      ? { egressAllowed: true, rules: [] }
      : egress === 'cloud'
        ? { egressAllowed: true, rules: [cloudRule] }
        : { egressAllowed: false, rules: [cloudRule] };
  return {
    pipelineId: 'pl_test', dataAllowlist: [], routing: routing as never,
    orgPolicyDefaults: {}, orgGuardrailDefaults: { requirePiiMasking: { mode: 'default', bool: false } },
    policyOverlay: {}, guardrailOverlay: maskOn ? { requirePiiMasking: { bool: true } } : {},
  } as PipelineContract;
}

const scanHit: PiiScanLike = { hits: true, redacted: 'card [PII_REDACTED]' };
const scanClean: PiiScanLike = { hits: false };

test('SINK_REGISTRY declares transport + destination field per deliver-sink', () => {
  assert.equal(SINK_REGISTRY.webhook.transport, 'cloud');
  assert.equal(SINK_REGISTRY.slack.transport, 'cloud');
  assert.equal(SINK_REGISTRY.whatsapp.transport, 'air-gapped');
  assert.equal(SINK_REGISTRY.webhook.destinationField, 'url');
  assert.equal(SINK_REGISTRY.slack.destinationField, 'channel');
  assert.equal(getSinkDescriptor('slack').label, 'Slack message');
});

// ─── egress leash ────────────────────────────────────────────────────────────────────────────────

test('cloud sink BLOCKED when egress leash denies — one deny audit, no delivery', () => {
  const d = planSinkGovernance({
    descriptor: getSinkDescriptor('webhook'),
    contract: contractFor('block'),
    outcome: 'result',
  });
  assert.equal(d.verdict, 'blocked');
  assert.equal(d.audits.length, 1);
  assert.equal(d.audits[0].action, 'pipeline.egress.block');
  assert.equal(d.audits[0].outcome, 'blocked');
});

test('cloud sink BLOCKED when leashed to LOCAL', () => {
  const d = planSinkGovernance({
    descriptor: getSinkDescriptor('slack'),
    contract: contractFor('local'),
    outcome: 'result',
  });
  assert.equal(d.verdict, 'blocked');
});

test('air-gapped sink is NEVER egress-blocked even under a block leash', () => {
  const d = planSinkGovernance({
    descriptor: getSinkDescriptor('whatsapp'),
    contract: contractFor('block'),
    outcome: 'result',
  });
  assert.equal(d.verdict, 'deliver');
});

// ─── PII mask ────────────────────────────────────────────────────────────────────────────────────

test('deliver without masking when no mask required — body unchanged, masked:false', () => {
  const d = planSinkGovernance({
    descriptor: getSinkDescriptor('webhook'),
    contract: contractFor('cloud', false),
    outcome: 'card 4111-1111-1111-1111',
    scan: scanHit,
  });
  assert.equal(d.verdict, 'deliver');
  if (d.verdict !== 'deliver') return;
  assert.equal(d.body, 'card 4111-1111-1111-1111');
  assert.equal(d.masked, false);
  assert.equal(d.audits.length, 0);
});

test('cloud sink masks body before send when required + PII present — mask audit', () => {
  const d = planSinkGovernance({
    descriptor: getSinkDescriptor('webhook'),
    contract: contractFor('cloud', true),
    outcome: 'card 4111-1111-1111-1111',
    scan: scanHit,
  });
  assert.equal(d.verdict, 'deliver');
  if (d.verdict !== 'deliver') return;
  assert.equal(d.body, 'card [PII_REDACTED]');
  assert.equal(d.masked, true);
  assert.ok(d.audits.some((a) => a.action === 'pipeline.pii.mask' && a.outcome === 'redacted'));
});

test('required mask but nothing to redact → deliver unchanged, no mask audit', () => {
  const d = planSinkGovernance({
    descriptor: getSinkDescriptor('slack'),
    contract: contractFor('cloud', true),
    outcome: 'hello team',
    scan: scanClean,
  });
  assert.equal(d.verdict, 'deliver');
  if (d.verdict !== 'deliver') return;
  assert.equal(d.body, 'hello team');
  assert.equal(d.masked, false);
  assert.equal(d.audits.length, 0);
});

test('cloud sink HELD when masking required but detector unavailable (scan absent)', () => {
  for (const scan of [null, undefined] as const) {
    const d = planSinkGovernance({
      descriptor: getSinkDescriptor('slack'),
      contract: contractFor('cloud', true),
      outcome: 'secret',
      scan,
    });
    assert.equal(d.verdict, 'held');
    if (d.verdict !== 'held') return;
    assert.match(d.reason, /detector is unavailable/);
    assert.ok(d.audits.some((a) => a.action === 'pipeline.pii.mask' && a.outcome === 'error'));
  }
});

test('air-gapped sink proceeds unmasked when detector unavailable — skipped audit, still delivers', () => {
  const d = planSinkGovernance({
    descriptor: getSinkDescriptor('whatsapp'),
    contract: contractFor('cloud', true),
    outcome: 'secret',
    scan: null,
  });
  assert.equal(d.verdict, 'deliver');
  if (d.verdict !== 'deliver') return;
  assert.equal(d.body, 'secret');
  assert.ok(
    d.audits.some(
      (a) => a.action === 'pipeline.pii.mask' && a.outcome === 'ok' && /skipped/.test(a.reason),
    ),
  );
});

test('no contract → deliver, no masking (legacy permissive)', () => {
  const kinds: DeliverSinkKind[] = ['email', 'webhook', 'slack', 'whatsapp'];
  for (const kind of kinds) {
    const d = planSinkGovernance({
      descriptor: getSinkDescriptor(kind),
      contract: null,
      outcome: 'x',
    });
    assert.equal(d.verdict, 'deliver');
  }
});
