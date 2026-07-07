import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GATEWAY_KINDS,
  deriveStatus,
  egressClassFor,
  isGatewayKind,
  mergeGatewayHealth,
  validateGatewayCreate,
  validateGatewayUpdate,
  type GatewayHealthSignal,
  type GatewayRow,
} from '../src/lib/gateways-policy.ts';
import { planSeedGateways, sampleGatewayId, SAMPLE_GATEWAYS } from '../src/lib/gateways-seed.ts';

// PURE gateway rules — kind→egressClass, health-merge, validation, seed planning. No I/O, no mocks.

// ─── kind → egressClass ────────────────────────────────────────────────────────────────────────
test('egressClassFor: on-prem keeps data on the fleet; every cloud kind means data leaves', () => {
  assert.equal(egressClassFor('on-prem'), 'on-prem');
  assert.equal(egressClassFor('openai'), 'cloud');
  assert.equal(egressClassFor('anthropic'), 'cloud');
  assert.equal(egressClassFor('compat'), 'cloud');
});

test('egressClassFor: an unknown kind is conservatively cloud (never silently claims data stays)', () => {
  assert.equal(egressClassFor('mystery'), 'cloud');
  assert.equal(egressClassFor(''), 'cloud');
});

test('isGatewayKind guards the four known kinds only', () => {
  for (const k of GATEWAY_KINDS) assert.equal(isGatewayKind(k), true);
  assert.equal(isGatewayKind('nope'), false);
  assert.equal(isGatewayKind(null), false);
  assert.equal(isGatewayKind(42), false);
});

// ─── health merge — configured+reachable ⇒ available; anything less ⇒ NOT ────────────────────────
const baseRow: GatewayRow = {
  id: 'gw_1',
  orgId: 'default',
  name: 'X',
  kind: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o-mini',
  egressClass: 'cloud',
  enabled: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

test('merge: enabled + configured + reachable ⇒ available/up', () => {
  const sig: GatewayHealthSignal = { configured: true, reachable: true };
  const v = mergeGatewayHealth(baseRow, sig);
  assert.equal(v.available, true);
  assert.equal(v.status, 'up');
  assert.equal(v.configured, true);
  assert.equal(v.reachable, true);
});

test('merge: configured but UNREACHABLE ⇒ not available, status down (honest)', () => {
  const v = mergeGatewayHealth(baseRow, { configured: true, reachable: false });
  assert.equal(v.available, false);
  assert.equal(v.status, 'down');
});

test('merge: UNCONFIGURED ⇒ not available, status unconfigured — never faked', () => {
  const v = mergeGatewayHealth(baseRow, { configured: false, reachable: false });
  assert.equal(v.available, false);
  assert.equal(v.status, 'unconfigured');
});

test('merge: a DISABLED gateway is never available even when reachable', () => {
  const v = mergeGatewayHealth({ ...baseRow, enabled: false }, { configured: true, reachable: true });
  assert.equal(v.available, false);
  assert.equal(v.status, 'disabled');
});

test('merge: egressClass is re-derived from kind even if the stored row drifted', () => {
  const drifted: GatewayRow = { ...baseRow, kind: 'on-prem', egressClass: 'cloud' };
  const v = mergeGatewayHealth(drifted, { configured: true, reachable: true });
  assert.equal(v.egressClass, 'on-prem');
});

test('merge: createdAt Date is serialized to ISO', () => {
  const v = mergeGatewayHealth(baseRow, { configured: true, reachable: true });
  assert.equal(v.createdAt, '2026-01-01T00:00:00.000Z');
});

test('deriveStatus: degraded signal surfaces as degraded when enabled+configured', () => {
  assert.equal(
    deriveStatus(true, { configured: true, reachable: true, status: 'degraded' }),
    'degraded',
  );
});

// ─── validation ──────────────────────────────────────────────────────────────────────────────────
test('validate: name is required', () => {
  const r = validateGatewayCreate({ name: '  ', kind: 'openai' });
  assert.equal(r.ok, false);
});

test('validate: kind must be a known kind', () => {
  const r = validateGatewayCreate({ name: 'X', kind: 'bogus' });
  assert.equal(r.ok, false);
});

test('validate: compat REQUIRES a base URL; other kinds may omit it', () => {
  assert.equal(validateGatewayCreate({ name: 'X', kind: 'compat' }).ok, false);
  const withUrl = validateGatewayCreate({ name: 'X', kind: 'compat', baseUrl: 'https://openrouter.ai/api/v1/' });
  assert.ok(withUrl.ok);
  assert.equal(withUrl.value.baseUrl, 'https://openrouter.ai/api/v1', 'trailing slash trimmed');
  assert.equal(withUrl.value.egressClass, 'cloud');
  assert.ok(validateGatewayCreate({ name: 'Cluster', kind: 'on-prem' }).ok, 'on-prem needs no URL');
});

test('validate: egressClass is derived, never taken from input', () => {
  const r = validateGatewayCreate({ name: 'Cluster', kind: 'on-prem' });
  assert.ok(r.ok);
  assert.equal(r.value.egressClass, 'on-prem');
  assert.equal(r.value.enabled, true, 'defaults enabled');
});

// ─── update validation — same rules as create + egress ALWAYS re-derived from the new kind ────────
test('validateGatewayUpdate: name + valid kind required, compat needs a base URL', () => {
  assert.equal(validateGatewayUpdate({ name: '  ', kind: 'openai' }).ok, false);
  assert.equal(validateGatewayUpdate({ name: 'X', kind: 'bogus' }).ok, false);
  assert.equal(validateGatewayUpdate({ name: 'X', kind: 'compat' }).ok, false, 'compat with no URL rejected');
  const ok = validateGatewayUpdate({ name: 'X', kind: 'compat', baseUrl: 'https://openrouter.ai/api/v1/' });
  assert.ok(ok.ok);
  assert.equal(ok.value.baseUrl, 'https://openrouter.ai/api/v1', 'trailing slash trimmed');
});

test('validateGatewayUpdate: egress is RE-DERIVED from the new kind, never trusted from the client', () => {
  // Flipping an on-prem gateway to a cloud kind must flip egress to cloud, regardless of any input.
  const toCloud = validateGatewayUpdate({ name: 'Was on-prem', kind: 'openai' });
  assert.ok(toCloud.ok);
  assert.equal(toCloud.value.egressClass, 'cloud', 'kind→cloud ⇒ egress cloud');

  // Flipping a cloud gateway to on-prem must flip egress back to on-prem.
  const toOnPrem = validateGatewayUpdate({ name: 'Was cloud', kind: 'on-prem' });
  assert.ok(toOnPrem.ok);
  assert.equal(toOnPrem.value.egressClass, 'on-prem', 'kind→on-prem ⇒ egress on-prem');
});

test('validateGatewayUpdate: enabled false is honoured (disable via update); defaults true', () => {
  const disabled = validateGatewayUpdate({ name: 'X', kind: 'openai', enabled: false });
  assert.ok(disabled.ok);
  assert.equal(disabled.value.enabled, false);
  const dflt = validateGatewayUpdate({ name: 'X', kind: 'openai' });
  assert.ok(dflt.ok);
  assert.equal(dflt.value.enabled, true);
});

// ─── seed planning — stable ids, per-org isolation, correct egress ───────────────────────────────
test('seed: sampleGatewayId is deterministic per org+key (idempotency key)', () => {
  assert.equal(sampleGatewayId('default', 'openai'), 'gw_seed_default_openai');
  assert.notEqual(sampleGatewayId('default', 'openai'), sampleGatewayId('org_bharat', 'openai'));
});

test('seed: the four sample gateways plan with derived egress + org-scoped stable ids', () => {
  const plan = planSeedGateways('org_bharat');
  assert.equal(plan.length, SAMPLE_GATEWAYS.length);
  const byName = new Map(plan.map((p) => [p.name, p]));
  assert.equal(byName.get('On-Prem Cluster')!.egressClass, 'on-prem');
  assert.equal(byName.get('OpenAI')!.egressClass, 'cloud');
  assert.equal(byName.get('Anthropic')!.egressClass, 'cloud');
  const or = byName.get('OpenRouter')!;
  assert.equal(or.kind, 'compat');
  assert.equal(or.egressClass, 'cloud');
  assert.equal(or.baseUrl, 'https://openrouter.ai/api/v1');
  for (const p of plan) assert.match(p.id, /^gw_seed_org_bharat_/);
});
