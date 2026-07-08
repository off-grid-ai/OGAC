import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  slugifyTenant,
  tenantHost,
  tenantUrl,
  tenantGatewayHost,
  randomGatewaySuffix,
} from '../src/lib/tenant-domain.ts';
import { sign, verify } from '../src/lib/sign.ts';
import { derivePool, activeModelConfig, validateFleetNode, type FleetNode } from '../src/lib/fleet.ts';
import {
  normalizeLifecycleRule,
  buildLifecycleXml,
  parseLifecycleXml,
  buildPublicReadPolicy,
  classifyBucketPolicy,
} from '../src/lib/storage-lifecycle.ts';

// ─── tenant-domain ─────────────────────────────────────────────────────────
test('slugifyTenant strips non-alphanumerics, lowercases, caps at 40', () => {
  assert.equal(slugifyTenant('Wednesday Solutions!'), 'wednesdaysolutions');
  assert.equal(slugifyTenant('   '), '');
  assert.equal(slugifyTenant('A'.repeat(60)).length, 40);
});

test('tenantHost / tenantUrl compose the first-level console host', () => {
  const h = tenantHost('acme');
  assert.match(h, /^acme-onprem-console\./);
  assert.equal(tenantUrl('acme'), `https://${h}`);
});

test('tenantGatewayHost takes 5 slug + 5 random chars, sanitising both', () => {
  const host = tenantGatewayHost('BharatUnion', 'K7x2P!!');
  assert.match(host, /^bharak7x2p-gateway\./);
});

test('randomGatewaySuffix returns 5 lowercase alphanumerics', () => {
  for (let i = 0; i < 20; i++) {
    const s = randomGatewaySuffix();
    assert.equal(s.length, 5);
    assert.match(s, /^[a-z0-9]{5}$/);
  }
});

// ─── sign / verify ─────────────────────────────────────────────────────────
test('sign is deterministic and verify accepts a genuine signature', () => {
  const payload = { answer: 'hi', citations: [1, 2] };
  const s = sign(payload);
  assert.ok(s.startsWith('sig_'));
  assert.equal(s, sign(payload));
  assert.equal(verify(payload, s), true);
});

test('verify rejects a tampered payload and a wrong-length signature', () => {
  const s = sign({ a: 1 });
  assert.equal(verify({ a: 2 }, s), false); // same length, different hmac
  assert.equal(verify({ a: 1 }, 'sig_short'), false); // length mismatch → early false
});

// ─── fleet.derivePool ────────────────────────────────────────────────────────
const node = (o: Partial<FleetNode>): FleetNode =>
  ({
    name: 'n', host: '10.0.0.1', port: 7878, role: 'gateway', kind: 'chat', model: 'gemma',
    primaryGguf: 'g.gguf', mmprojGguf: '', modelId: 'm', contextSize: null, vision: false, enabled: true,
    ...o,
  }) as FleetNode;

test('derivePool: server excluded, image→imagePool, gateway/spare→pool', () => {
  const { pool, imagePool } = derivePool([
    node({ name: 'g6', role: 'server' }),
    node({ name: 'img', role: 'image', model: 'flux' }),
    node({ name: 'chatkind', role: 'spare', kind: 'image', model: 'sd' }), // kind==='image' → imagePool
    node({ name: 'gw', role: 'gateway', kind: 'chat' }),
    node({ name: 'sp', role: 'spare', kind: 'grounding', enabled: false }),
  ]);
  assert.deepEqual(imagePool.map((p) => p.name).sort(), ['chatkind', 'img']);
  assert.deepEqual(pool.map((p) => p.name).sort(), ['gw', 'sp']);
  assert.equal(pool.find((p) => p.name === 'sp')!.enabled, false);
});

test('activeModelConfig omits empty mmproj + non-positive ctx, includes them when set', () => {
  const bare = activeModelConfig({ modelId: 'm', primaryGguf: 'p', mmprojGguf: '', contextSize: 0 });
  assert.deepEqual(bare, { id: 'm', primary: 'p' });
  const full = activeModelConfig({ modelId: 'm', primaryGguf: 'p', mmprojGguf: 'mm', contextSize: 4096 });
  assert.deepEqual(full, { id: 'm', primary: 'p', mmproj: 'mm', ctx: 4096 });
});

test('validateFleetNode: every rejection reason + the ok path', () => {
  assert.match((validateFleetNode({ name: 'BAD NAME' }) as { reason: string }).reason, /name must be/);
  assert.match((validateFleetNode({ name: 'ok', host: '' }) as { reason: string }).reason, /host is required/);
  assert.match((validateFleetNode({ name: 'ok', host: 'h', port: 0 }) as { reason: string }).reason, /port must be/);
  assert.match(
    (validateFleetNode({ name: 'ok', host: 'h', port: 80, role: 'nope' as unknown as FleetNode['role'] }) as { reason: string }).reason,
    /role must be/,
  );
  assert.match(
    (validateFleetNode({ name: 'ok', host: 'h', port: 80, role: 'gateway', kind: 'nope' as unknown as FleetNode['kind'] }) as { reason: string }).reason,
    /kind must be/,
  );
  assert.match(
    (validateFleetNode({ name: 'ok', host: 'h', port: 80, role: 'gateway', kind: 'chat', model: '' }) as { reason: string }).reason,
    /model \(routing tag\)/,
  );
  assert.match(
    (validateFleetNode({ name: 'ok', host: 'h', port: 80, role: 'gateway', kind: 'chat', model: 'm', primaryGguf: '' }) as { reason: string }).reason,
    /primaryGguf is required/,
  );
  // server needs no model/gguf, but bad contextSize still rejected
  assert.match(
    (validateFleetNode({ name: 'srv', host: 'h', port: 80, role: 'server', kind: 'chat', contextSize: 10 }) as { reason: string }).reason,
    /contextSize must be/,
  );
  assert.deepEqual(validateFleetNode({ name: 'srv', host: 'h', port: 80, role: 'server', kind: 'chat' }), { ok: true });
  assert.deepEqual(
    validateFleetNode({ name: 'gw', host: 'h', port: 7878, role: 'gateway', kind: 'chat', model: 'm', primaryGguf: 'g.gguf', contextSize: 4096 }),
    { ok: true },
  );
});

// ─── storage-lifecycle ─────────────────────────────────────────────────────
test('normalizeLifecycleRule: rejects non-positive/NaN, clamps to 3650, derives id/prefix', () => {
  assert.equal(normalizeLifecycleRule({ expireDays: 0 }), null);
  assert.equal(normalizeLifecycleRule({ expireDays: 'x' }), null);
  const clamped = normalizeLifecycleRule({ expireDays: 99999 })!;
  assert.equal(clamped.expireDays, 3650);
  assert.equal(clamped.id, 'expire-all-3650d');
  const withId = normalizeLifecycleRule({ id: '  keep  ', prefix: 'logs/', expireDays: 30, enabled: false })!;
  assert.equal(withId.id, 'keep');
  assert.equal(withId.prefix, 'logs/');
  assert.equal(withId.enabled, false);
  // enabled defaults true when not explicitly false
  assert.equal(normalizeLifecycleRule({ expireDays: 5 })!.enabled, true);
});

test('buildLifecycleXml round-trips through parseLifecycleXml, escaping specials', () => {
  const rules = [
    normalizeLifecycleRule({ id: 'a&b', prefix: 'x<y>', expireDays: 10, enabled: true })!,
    normalizeLifecycleRule({ id: 'off', prefix: '', expireDays: 20, enabled: false })!,
  ];
  const xml = buildLifecycleXml(rules);
  assert.match(xml, /&amp;/);
  assert.match(xml, /&lt;y&gt;/);
  const parsed = parseLifecycleXml(xml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].expireDays, 10);
  assert.equal(parsed[1].enabled, false);
});

test('buildLifecycleXml with no rules yields a rule-free config; parse of junk yields none', () => {
  assert.match(buildLifecycleXml([]), /<LifecycleConfiguration[^>]*><\/LifecycleConfiguration>/);
  assert.deepEqual(parseLifecycleXml('<garbage/>'), []);
  // a Rule without a valid Days is skipped
  assert.deepEqual(parseLifecycleXml('<Rule><ID>x</ID></Rule>'), []);
});

test('classifyBucketPolicy: null/empty→private, public policy→public, non-star→private, junk→private', () => {
  assert.equal(classifyBucketPolicy(null), 'private');
  assert.equal(classifyBucketPolicy(buildPublicReadPolicy('bkt')), 'public');
  assert.equal(
    classifyBucketPolicy(JSON.stringify({ Statement: [{ Effect: 'Deny', Principal: '*', Action: ['s3:GetObject'] }] })),
    'private',
  );
  assert.equal(
    classifyBucketPolicy(JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:x' }, Action: 's3:GetObject' }] })),
    'private',
  );
  // Principal object with a wildcard value → public
  assert.equal(
    classifyBucketPolicy(JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { AWS: '*' }, Action: 's3:*' }] })),
    'public',
  );
  assert.equal(classifyBucketPolicy('{not json'), 'private');
});
