import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GATEWAY_KEY_CLIENT_PREFIX,
  GATEWAY_KEY_PREFIX,
  GATEWAY_KEY_SCOPE,
  deriveKeyClientId,
  formatApiKey,
  isGatewayApiKey,
  isGatewayKeyClient,
  keyPreview,
  mapKeyClient,
  parseApiKey,
  slugifyKeyName,
  sortKeyViews,
  validateKeyName,
} from '../src/lib/gateway-api-key.ts';

// ── format / parse round-trip ──────────────────────────────────────────────────

test('formatApiKey composes ogk_<clientId>.<secret>', () => {
  assert.equal(formatApiKey('ogk-mobile-ab12', 's3cr3t'), 'ogk_ogk-mobile-ab12.s3cr3t');
});

test('parseApiKey round-trips a formatted key', () => {
  const raw = formatApiKey('ogk-mobile-ab12', 'abc.def.ghi'); // secret may contain dots
  assert.deepEqual(parseApiKey(raw), { clientId: 'ogk-mobile-ab12', secret: 'abc.def.ghi' });
});

test('parseApiKey splits on the FIRST dot only (secret keeps later dots)', () => {
  assert.deepEqual(parseApiKey('ogk_ogk-x.a.b.c'), { clientId: 'ogk-x', secret: 'a.b.c' });
});

test('parseApiKey rejects malformed / foreign tokens', () => {
  for (const bad of [
    null,
    undefined,
    '',
    'sk-ant-123',
    'ogk_nodot', // no dot
    'ogk_.secret', // empty clientId
    'ogk_ogk-x.', // empty secret
    'ogk_notprefixed.secret', // clientId lacks ogk- prefix
    'Bearer ogk_ogk-x.y',
  ]) {
    assert.equal(parseApiKey(bad as string), null, `should reject: ${String(bad)}`);
  }
});

test('isGatewayApiKey matches only prefixed, dotted values', () => {
  assert.equal(isGatewayApiKey('ogk_ogk-x.y'), true);
  assert.equal(isGatewayApiKey('ogk_nodot'), false);
  assert.equal(isGatewayApiKey('sk-123.abc'), false);
  assert.equal(isGatewayApiKey(null), false);
});

test('keyPreview masks the secret and never leaks it', () => {
  const raw = formatApiKey('ogk-mobile-ab12', 'supersecretvalue');
  const preview = keyPreview(raw);
  assert.ok(!preview.includes('supersecretvalue'));
  assert.equal(preview, 'ogk_ogk-mobile-ab12.••••');
});

// ── name validation + clientId derivation ──────────────────────────────────────

test('validateKeyName requires a non-empty, bounded name', () => {
  assert.equal(validateKeyName('').ok, false);
  assert.equal(validateKeyName('   ').ok, false);
  assert.equal(validateKeyName('x'.repeat(65)).ok, false);
  const ok = validateKeyName('  mobile app  ');
  assert.equal(ok.ok, true);
  assert.equal(ok.name, 'mobile app');
});

test('slugifyKeyName produces a dns-safe fragment', () => {
  assert.equal(slugifyKeyName('Mobile App!!'), 'mobile-app');
  assert.equal(slugifyKeyName('  --weird__name--  '), 'weird-name');
  assert.equal(slugifyKeyName('@@@'), 'key'); // unsluggable → fallback
});

test('deriveKeyClientId always carries the ogk- prefix and includes the random suffix', () => {
  const id = deriveKeyClientId('Mobile App', 'ABCD1234efgh');
  assert.ok(id.startsWith(GATEWAY_KEY_CLIENT_PREFIX));
  assert.match(id, /^ogk-mobile-app-[a-z0-9]{1,8}$/);
});

test('deriveKeyClientId with two different rands yields two different ids (uniqueness)', () => {
  assert.notEqual(deriveKeyClientId('same', 'aaaa'), deriveKeyClientId('same', 'bbbb'));
});

// ── view shaping ────────────────────────────────────────────────────────────────

test('isGatewayKeyClient only matches ogk- clients', () => {
  assert.equal(isGatewayKeyClient({ id: '1', clientId: 'ogk-mobile-ab12' }), true);
  assert.equal(isGatewayKeyClient({ id: '2', clientId: 'offgrid-gateway' }), false);
  assert.equal(isGatewayKeyClient({ id: '3', clientId: 'offgrid-console' }), false);
});

test('mapKeyClient shapes attributes into a key view; disabled → revoked', () => {
  const view = mapKeyClient(
    {
      id: 'kc-1',
      clientId: 'ogk-mobile-ab12',
      name: 'Mobile',
      enabled: false,
      attributes: { ownerOrg: ['acme'], scope: ['gateway'], createdAt: ['2026-01-01T00:00:00.000Z'] },
    },
    '2026-06-01T00:00:00.000Z',
  );
  assert.equal(view.id, 'kc-1');
  assert.equal(view.name, 'Mobile');
  assert.equal(view.owner, 'acme');
  assert.equal(view.scope, 'gateway');
  assert.equal(view.status, 'revoked');
  assert.equal(view.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(view.lastUsedAt, '2026-06-01T00:00:00.000Z');
});

test('mapKeyClient defaults owner/scope and treats missing enabled as active', () => {
  const view = mapKeyClient({ id: 'kc-2', clientId: 'ogk-x-1' });
  assert.equal(view.status, 'active');
  assert.equal(view.owner, 'default');
  assert.equal(view.scope, GATEWAY_KEY_SCOPE);
  assert.equal(view.name, 'ogk-x-1'); // falls back to clientId
});

test('sortKeyViews orders newest-first, nulls last, stable by clientId', () => {
  const rows = sortKeyViews([
    { id: '1', clientId: 'ogk-c', name: '', owner: '', scope: '', status: 'active', createdAt: null, lastUsedAt: null },
    { id: '2', clientId: 'ogk-a', name: '', owner: '', scope: '', status: 'active', createdAt: '2026-02-01T00:00:00Z', lastUsedAt: null },
    { id: '3', clientId: 'ogk-b', name: '', owner: '', scope: '', status: 'active', createdAt: '2026-03-01T00:00:00Z', lastUsedAt: null },
  ]);
  assert.deepEqual(rows.map((r) => r.clientId), ['ogk-b', 'ogk-a', 'ogk-c']);
});

test('GATEWAY_KEY_PREFIX / client prefix are the stable contract with the aggregator', () => {
  assert.equal(GATEWAY_KEY_PREFIX, 'ogk_');
  assert.equal(GATEWAY_KEY_CLIENT_PREFIX, 'ogk-');
});
