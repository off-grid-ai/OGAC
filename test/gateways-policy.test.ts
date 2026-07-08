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
  validateMergedGateway,
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

// ─── update validation — PARTIAL: only supplied fields validated + returned (gap PA-10) ────────────
test('validateGatewayUpdate: a defaultModel-only patch is valid and returns JUST that field', () => {
  const r = validateGatewayUpdate({ defaultModel: '  gpt-5-mini  ' });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { defaultModel: 'gpt-5-mini' }, 'only defaultModel present, trimmed');
});

test('validateGatewayUpdate: each field is validated only WHEN PRESENT', () => {
  // name present but blank → error; kind present but bogus → error.
  assert.equal(validateGatewayUpdate({ name: '   ' }).ok, false, 'blank name rejected when present');
  assert.equal(validateGatewayUpdate({ kind: 'bogus' }).ok, false, 'bogus kind rejected when present');
  // A non-string name is treated as blank → rejected.
  assert.equal(validateGatewayUpdate({ name: 42 }).ok, false, 'non-string name rejected');
  // Absent fields impose no requirement — a name-only patch with a valid name passes.
  const okName = validateGatewayUpdate({ name: 'Renamed' });
  assert.ok(okName.ok);
  assert.deepEqual(okName.value, { name: 'Renamed' });
});

test('validateGatewayUpdate: baseUrl present is trimmed of trailing slashes; empty is allowed here', () => {
  const trimmed = validateGatewayUpdate({ baseUrl: 'https://openrouter.ai/api/v1///' });
  assert.ok(trimmed.ok);
  assert.equal(trimmed.value.baseUrl, 'https://openrouter.ai/api/v1');
  // An empty baseUrl is allowed at this layer — the compat-needs-a-URL rule is judged on the MERGED
  // row (validateMergedGateway), since a partial patch may not carry both kind and baseUrl.
  const empty = validateGatewayUpdate({ baseUrl: '' });
  assert.ok(empty.ok);
  assert.equal(empty.value.baseUrl, '');
  // A non-string baseUrl normalises to empty string.
  const nonStr = validateGatewayUpdate({ baseUrl: 5 });
  assert.ok(nonStr.ok);
  assert.equal(nonStr.value.baseUrl, '');
});

test('validateGatewayUpdate: when kind IS present, egress is RE-DERIVED from it (never client-trusted)', () => {
  const toCloud = validateGatewayUpdate({ kind: 'openai' });
  assert.ok(toCloud.ok);
  assert.equal(toCloud.value.kind, 'openai');
  assert.equal(toCloud.value.egressClass, 'cloud', 'kind→cloud ⇒ egress cloud');

  const toOnPrem = validateGatewayUpdate({ kind: 'on-prem' });
  assert.ok(toOnPrem.ok);
  assert.equal(toOnPrem.value.egressClass, 'on-prem', 'kind→on-prem ⇒ egress on-prem');
});

test('validateGatewayUpdate: egressClass is absent from the patch when kind is NOT supplied', () => {
  const r = validateGatewayUpdate({ defaultModel: 'm' });
  assert.ok(r.ok);
  assert.equal('egressClass' in r.value, false, 'no kind ⇒ no egress in the partial patch');
  assert.equal('kind' in r.value, false);
});

test('validateGatewayUpdate: enabled present is coerced to a boolean; absent ⇒ not in the patch', () => {
  const off = validateGatewayUpdate({ enabled: false });
  assert.ok(off.ok);
  assert.equal(off.value.enabled, false);
  const truthy = validateGatewayUpdate({ enabled: 1 });
  assert.ok(truthy.ok);
  assert.equal(truthy.value.enabled, true, 'coerced to boolean');
  const noEnabled = validateGatewayUpdate({ name: 'X' });
  assert.ok(noEnabled.ok);
  assert.equal('enabled' in noEnabled.value, false, 'absent enabled ⇒ untouched');
});

test('validateGatewayUpdate: an EMPTY patch (no recognised fields) is a clean error, not a no-op', () => {
  assert.equal(validateGatewayUpdate({}).ok, false, 'empty patch rejected');
  const r = validateGatewayUpdate({});
  assert.ok(!r.ok);
  assert.match(r.error, /no updatable fields/);
});

// ─── the compat invariant on the MERGED row (checked by the store after applying a patch) ──────────
test('validateMergedGateway: compat with a base URL is valid; without one is rejected', () => {
  assert.equal(validateMergedGateway({ kind: 'compat', baseUrl: 'https://openrouter.ai/api/v1' }), null);
  assert.match(
    validateMergedGateway({ kind: 'compat', baseUrl: '' })!,
    /requires a base URL/,
    'compat with empty baseUrl rejected',
  );
  assert.match(
    validateMergedGateway({ kind: 'compat', baseUrl: '   ' })!,
    /requires a base URL/,
    'whitespace-only baseUrl is treated as empty',
  );
});

test('validateMergedGateway: non-compat kinds never require a base URL', () => {
  assert.equal(validateMergedGateway({ kind: 'on-prem', baseUrl: '' }), null);
  assert.equal(validateMergedGateway({ kind: 'openai', baseUrl: '' }), null);
  assert.equal(validateMergedGateway({ kind: 'anthropic', baseUrl: '' }), null);
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
