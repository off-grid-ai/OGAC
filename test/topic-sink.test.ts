import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SINK_REGISTRY, planSinkGovernance } from '../src/lib/adapters/sinks/registry.ts';
import { effectiveGovernance } from '../src/lib/pipelines-policy.ts';

// The topic sink exists to CLOSE a capability gap that was about binding, not primitives: "no general
// pipeline output uses this adapter". What matters in tests is therefore not that Kafka works — it does,
// and that is proven live — but that binding it did not open a governance hole.

// NOTE the org defaults. `effectiveGovernance` merges by iterating the ORG catalogue, so a guardrail
// overlay naming a control the org never declares contributes NOTHING — I got this wrong first and the
// test caught it. A realistic contract declares the control at org level; the overlay then tightens it.
const strictLocal = {
  pipelineId: 'p1',
  routing: { rules: [{ name: 'no-cloud', attribute: 'data_class', operator: 'eq', value: 'pii', action: 'local', enabled: true, priority: 10 }] },
  orgPolicyDefaults: { maxEgress: { level: 'local', mode: 'locked' } },
  policyOverlay: {},
  orgGuardrailDefaults: { requirePiiMasking: { bool: true, mode: 'locked' } },
  guardrailOverlay: {},
} as never;

test('the topic sink is air-gapped — the broker is on the customer network', () => {
  assert.equal(SINK_REGISTRY.topic.transport, 'air-gapped');
  assert.equal(SINK_REGISTRY.topic.destinationField, 'topic');
  // Same posture as the on-prem WhatsApp gateway, and deliberately NOT the cloud posture of webhook/slack.
  assert.equal(SINK_REGISTRY.topic.transport, SINK_REGISTRY.whatsapp.transport);
  assert.notEqual(SINK_REGISTRY.topic.transport, SINK_REGISTRY.webhook.transport);
});

test('a local-only egress ceiling does NOT block a topic send — nothing leaves the box', () => {
  // The point of air-gapped: a pipeline that forbids cloud egress must still be able to publish
  // internally. If this blocked, binding the sink would have made strict tenants unable to use it.
  const d = planSinkGovernance({
    descriptor: SINK_REGISTRY.topic,
    contract: strictLocal,
    outcome: 'Approved — within quota.',
    scan: { hits: false, redacted: 'Approved — within quota.' } as never,
  });
  assert.notEqual(d.verdict, 'blocked');
});

test('the same strict contract DOES block a cloud sink — the leash still bites', () => {
  const d = planSinkGovernance({
    descriptor: SINK_REGISTRY.webhook,
    contract: strictLocal,
    outcome: 'Approved.',
    scan: { hits: false, redacted: 'Approved.' } as never,
  });
  // Proves the previous assertion is about TRANSPORT, not about the contract being toothless.
  assert.equal(d.verdict, 'blocked');
});

test('PII is masked before a topic record is published — internal is not unprotected', () => {
  const d = planSinkGovernance({
    descriptor: SINK_REGISTRY.topic,
    contract: strictLocal,
    outcome: 'Approved for PAN ABCDE1234F.',
    scan: { hits: true, redacted: 'Approved for PAN [PAN].' } as never,
  });
  assert.equal(d.verdict, 'deliver');
  if (d.verdict === 'deliver') {
    assert.ok(!d.body.includes('ABCDE1234F'), 'the raw PAN must never reach the topic');
    assert.match(d.body, /\[PAN\]/);
  }
});

test('a detector outage does not hold an air-gapped topic send — the body stays on the box', () => {
  // Only the AIR-GAPPED half is asserted. The cloud counterpart ('held' when the detector is down) is
  // already covered by the existing sink-governance tests, and constructing a contract here that both
  // mandates masking AND permits cloud egress took me three wrong shapes — a test I cannot state
  // confidently is worse than one I leave to the suite that already owns it.
  const topic = planSinkGovernance({
    descriptor: SINK_REGISTRY.topic,
    contract: strictLocal,
    outcome: 'x',
    scan: null,
  } as never);
  assert.notEqual(topic.verdict, 'held');
});

test('an overlay control the org never declared is REPORTED, not silently dropped', () => {
  // Found while writing the tests above: effectiveGovernance iterates the ORG catalogue, so an overlay key
  // with no org default contributed nothing and nothing said so. A pipeline reading "PII masking: locked
  // ON" while doing nothing is the worst kind of wrong.
  const eff = effectiveGovernance({}, { requirePiiMasking: { bool: true, mode: 'locked' } } as never);
  assert.deepEqual(eff.ignored, ['requirePiiMasking']);
  assert.equal(eff.controls.requirePiiMasking, undefined, 'it genuinely has no effect — that is the point');

  // Declared at org level ⇒ honoured and NOT reported as ignored.
  const ok = effectiveGovernance(
    { requirePiiMasking: { bool: true, mode: 'default' } } as never,
    { requirePiiMasking: { bool: true } } as never,
  );
  assert.deepEqual(ok.ignored, []);
  assert.equal(ok.controls.requirePiiMasking?.bool, true);
});
