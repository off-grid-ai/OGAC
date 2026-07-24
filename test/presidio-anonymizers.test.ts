import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bindEncryptKey,
  policyUsesEncrypt,
  stripInlineEncryptKeys,
  ANONYMIZE_OPERATORS,
  buildAnonymizeRequest,
  byteLength,
  clampCount,
  DEFAULT_ANONYMIZER_POLICY,
  DEFAULT_OPERATOR,
  describeOperator,
  HASH_TYPES,
  normalizeAnonymizeResponse,
  normalizeAnonymizerPolicy,
  normalizeEntityKey,
  normalizeMaskingChar,
  normalizeOperatorSpec,
  specToOperatorConfig,
  validateAnonymizerPolicy,
  validateOperatorSpec,
  VALID_ENCRYPT_KEY_BYTES,
  type AnonymizerPolicy,
} from '@/lib/presidio-anonymizers';

// PURE unit tests for the advanced-anonymizer policy layer. Asserts the TERMINAL artifact — the
// exact Presidio /anonymize wire body and the normalized response — plus every validation branch.
// Zero I/O, zero mocks.

// ─── byteLength ────────────────────────────────────────────────────────────────
test('byteLength counts UTF-8 bytes, not code units', () => {
  assert.equal(byteLength('abcd'), 4);
  assert.equal(byteLength('WmZq4t7w!z%C&F)J'), 16); // an AES-128 key
  assert.equal(byteLength('€'), 3); // multi-byte
});

// ─── clampCount ─────────────────────────────────────────────────────────────────
test('clampCount clamps, floors, and falls back', () => {
  assert.equal(clampCount(4, 2), 4);
  assert.equal(clampCount('7', 2), 7);
  assert.equal(clampCount(3.9, 2), 3); // floored
  assert.equal(clampCount(0, 2), 1); // below min
  assert.equal(clampCount(9999, 2), 256); // above max
  assert.equal(clampCount('nope', 2), 2); // non-numeric fallback
  assert.equal(clampCount(undefined, 5), 5);
});

// ─── normalizeMaskingChar ─────────────────────────────────────────────────────
test('normalizeMaskingChar reduces to a single code point', () => {
  assert.equal(normalizeMaskingChar('#'), '#');
  assert.equal(normalizeMaskingChar('xyz'), 'x');
  assert.equal(normalizeMaskingChar(''), '*');
  assert.equal(normalizeMaskingChar(42), '*');
  assert.equal(normalizeMaskingChar('🙂!'), '🙂'); // surrogate pair stays one char
});

// ─── normalizeEntityKey ───────────────────────────────────────────────────────
test('normalizeEntityKey upper-snakes valid tokens and rejects junk', () => {
  assert.equal(normalizeEntityKey('in_pan'), 'IN_PAN');
  assert.equal(normalizeEntityKey('  Credit_Card '), 'CREDIT_CARD');
  assert.equal(normalizeEntityKey('9INVALID'), null); // must start with a letter
  assert.equal(normalizeEntityKey('has space'), null);
  assert.equal(normalizeEntityKey(''), null);
});

// ─── validateOperatorSpec: happy paths per operator ─────────────────────────────
test('validateOperatorSpec normalizes each operator, keeping only its own fields', () => {
  assert.deepEqual(validateOperatorSpec({ type: 'redact' }), { ok: true, value: { type: 'redact' } });
  assert.deepEqual(validateOperatorSpec({ type: 'keep' }), { ok: true, value: { type: 'keep' } });

  // replace with a value, and replace with none (→ Presidio default token)
  assert.deepEqual(validateOperatorSpec({ type: 'replace', newValue: '<X>' }), {
    ok: true,
    value: { type: 'replace', newValue: '<X>' },
  });
  assert.deepEqual(validateOperatorSpec({ type: 'replace' }), { ok: true, value: { type: 'replace' } });
  assert.deepEqual(validateOperatorSpec({ type: 'replace', newValue: '' }), {
    ok: true,
    value: { type: 'replace' },
  });

  // mask defaults + stale fields stripped
  assert.deepEqual(
    validateOperatorSpec({ type: 'mask', hashType: 'md5', newValue: 'junk' }),
    { ok: true, value: { type: 'mask', maskingChar: '*', charsToMask: 4, fromEnd: false } },
  );
  assert.deepEqual(
    validateOperatorSpec({ type: 'mask', maskingChar: 'X', charsToMask: 6, fromEnd: true }),
    { ok: true, value: { type: 'mask', maskingChar: 'X', charsToMask: 6, fromEnd: true } },
  );

  // hash default + explicit
  assert.deepEqual(validateOperatorSpec({ type: 'hash' }), {
    ok: true,
    value: { type: 'hash', hashType: 'sha256' },
  });
  assert.deepEqual(validateOperatorSpec({ type: 'hash', hashType: 'sha512' }), {
    ok: true,
    value: { type: 'hash', hashType: 'sha512' },
  });
  assert.deepEqual(validateOperatorSpec({ type: 'hash', hashType: 'bogus' }), {
    ok: true,
    value: { type: 'hash', hashType: 'sha256' }, // invalid → default
  });

  // encrypt with each valid key length
  for (const bytes of VALID_ENCRYPT_KEY_BYTES) {
    const key = 'k'.repeat(bytes);
    assert.deepEqual(validateOperatorSpec({ type: 'encrypt', key }), {
      ok: true,
      value: { type: 'encrypt', key },
    });
  }
});

// ─── validateOperatorSpec: error paths ──────────────────────────────────────────
test('validateOperatorSpec rejects bad operator + bad encrypt keys', () => {
  assert.equal(validateOperatorSpec({ type: 'custom' }).ok, false); // custom NOT allowed via API
  assert.equal(validateOperatorSpec({ type: 'nope' }).ok, false);
  assert.equal(validateOperatorSpec(null).ok, false);
  assert.equal(validateOperatorSpec('string').ok, false);

  // A KEYLESS encrypt spec is now the PRODUCTION shape — it means "use the org's vaulted key", so the
  // policy row never carries key material. It validates, carrying the intent with no key.
  const noKey = validateOperatorSpec({ type: 'encrypt' });
  assert.equal(noKey.ok, true);
  assert.deepEqual((noKey as { value: unknown }).value, { type: 'encrypt' });

  const shortKey = validateOperatorSpec({ type: 'encrypt', key: 'short' });
  assert.equal(shortKey.ok, false);
  assert.match((shortKey as { error: string }).error, /16, 24, or 32 bytes/);
});

// ─── normalizeOperatorSpec (lenient) ────────────────────────────────────────────
test('normalizeOperatorSpec collapses invalid specs to the fallback', () => {
  assert.deepEqual(normalizeOperatorSpec({ type: 'hash', hashType: 'md5' }), {
    type: 'hash',
    hashType: 'md5',
  });
  assert.deepEqual(normalizeOperatorSpec({ type: 'garbage' }), DEFAULT_OPERATOR);
  assert.deepEqual(normalizeOperatorSpec({ type: 'encrypt', key: 'x' }, { type: 'redact' }), {
    type: 'redact',
  });
});

// ─── validateAnonymizerPolicy ────────────────────────────────────────────────────
test('validateAnonymizerPolicy: full valid policy round-trips', () => {
  const res = validateAnonymizerPolicy({
    default: { type: 'replace', newValue: '<PII>' },
    perEntity: {
      in_pan: { type: 'mask', maskingChar: '*', charsToMask: 6, fromEnd: false },
      CREDIT_CARD: { type: 'hash', hashType: 'sha256' },
    },
  });
  assert.equal(res.ok, true);
  assert.ok(res.ok && res.value.perEntity.IN_PAN); // key upper-snaked
  assert.deepEqual(res.ok && res.value.perEntity.CREDIT_CARD, { type: 'hash', hashType: 'sha256' });
});

test('validateAnonymizerPolicy: missing default uses safe fallback; empty is valid', () => {
  const res = validateAnonymizerPolicy({ perEntity: {} });
  assert.deepEqual(res, { ok: true, value: { default: DEFAULT_OPERATOR, perEntity: {} } });
  const empty = validateAnonymizerPolicy(null);
  assert.deepEqual(empty, { ok: true, value: { default: DEFAULT_OPERATOR, perEntity: {} } });
});

test('validateAnonymizerPolicy: bad default operator is a hard error', () => {
  // A wrong-LENGTH inline key is still a hard error (a keyless encrypt is legal — vault-backed).
  const res = validateAnonymizerPolicy({ default: { type: 'encrypt', key: 'too-short' } });
  assert.equal(res.ok, false);
  assert.match((res as { error: string }).error, /default operator/);
});

test('validateAnonymizerPolicy: bad entity key or spec is a hard error', () => {
  const badKey = validateAnonymizerPolicy({ perEntity: { '9bad': { type: 'redact' } } });
  assert.equal(badKey.ok, false);
  assert.match((badKey as { error: string }).error, /invalid entity type/);

  const badSpec = validateAnonymizerPolicy({ perEntity: { IN_PAN: { type: 'encrypt', key: 'z' } } });
  assert.equal(badSpec.ok, false);
  assert.match((badSpec as { error: string }).error, /IN_PAN/);
});

// ─── normalizeAnonymizerPolicy (lenient) ──────────────────────────────────────────
test('normalizeAnonymizerPolicy never throws, drops junk keys, collapses bad specs', () => {
  const p = normalizeAnonymizerPolicy({
    default: { type: 'redact' },
    perEntity: {
      IN_PAN: { type: 'mask', maskingChar: '#', charsToMask: 5, fromEnd: true },
      'bad key': { type: 'redact' }, // dropped
      CREDIT_CARD: { type: 'garbage' }, // → default
    },
  });
  assert.deepEqual(p.default, { type: 'redact' });
  assert.deepEqual(p.perEntity.IN_PAN, {
    type: 'mask',
    maskingChar: '#',
    charsToMask: 5,
    fromEnd: true,
  });
  assert.equal(p.perEntity['bad key'], undefined);
  assert.deepEqual(p.perEntity.CREDIT_CARD, { type: 'redact' }); // collapsed to the policy default
  // Wholly junk input → safe empty policy
  assert.deepEqual(normalizeAnonymizerPolicy('nope'), { default: DEFAULT_OPERATOR, perEntity: {} });
});

// ─── specToOperatorConfig: exact wire shape per operator ──────────────────────────
test('specToOperatorConfig emits the exact Presidio wire config', () => {
  assert.deepEqual(specToOperatorConfig({ type: 'redact' }), { type: 'redact' });
  assert.deepEqual(specToOperatorConfig({ type: 'keep' }), { type: 'keep' });
  assert.deepEqual(specToOperatorConfig({ type: 'replace', newValue: '<X>' }), {
    type: 'replace',
    new_value: '<X>',
  });
  assert.deepEqual(specToOperatorConfig({ type: 'replace' }), { type: 'replace' });
  assert.deepEqual(
    specToOperatorConfig({ type: 'mask', maskingChar: '*', charsToMask: 6, fromEnd: false }),
    { type: 'mask', masking_char: '*', chars_to_mask: 6, from_end: false },
  );
  // mask with missing params falls back to safe defaults in the wire mapping
  assert.deepEqual(specToOperatorConfig({ type: 'mask' }), {
    type: 'mask',
    masking_char: '*',
    chars_to_mask: 4,
    from_end: false,
  });
  assert.deepEqual(specToOperatorConfig({ type: 'hash', hashType: 'sha512' }), {
    type: 'hash',
    hash_type: 'sha512',
  });
  assert.deepEqual(specToOperatorConfig({ type: 'hash' }), { type: 'hash', hash_type: 'sha256' });
  assert.deepEqual(specToOperatorConfig({ type: 'encrypt', key: 'k'.repeat(16) }), {
    type: 'encrypt',
    key: 'k'.repeat(16),
  });
  assert.deepEqual(specToOperatorConfig({ type: 'encrypt' }), { type: 'encrypt', key: '' });
});

// ─── buildAnonymizeRequest: the terminal request body ─────────────────────────────
test('buildAnonymizeRequest attaches DEFAULT + only per-entity operators that are present', () => {
  const policy: AnonymizerPolicy = {
    default: { type: 'replace', newValue: '<PII>' },
    perEntity: {
      IN_PAN: { type: 'mask', maskingChar: '*', charsToMask: 6, fromEnd: false },
      CREDIT_CARD: { type: 'hash', hashType: 'sha256' },
      // A per-entity op for an entity NOT in the results — must NOT appear in the payload.
      EMAIL_ADDRESS: { type: 'redact' },
    },
  };
  const results = [
    { entity_type: 'IN_PAN', start: 10, end: 20, score: 0.95 },
    { entity_type: 'CREDIT_CARD', start: 30, end: 46, score: 1 },
    { entity_type: 'LOCATION', start: 10, end: 20, score: 0.85 }, // no override → DEFAULT
  ];
  const body = buildAnonymizeRequest('text', results, policy);

  assert.equal(body.text, 'text');
  assert.deepEqual(body.analyzer_results, results);
  assert.deepEqual(body.anonymizers.DEFAULT, { type: 'replace', new_value: '<PII>' });
  assert.deepEqual(body.anonymizers.IN_PAN, {
    type: 'mask',
    masking_char: '*',
    chars_to_mask: 6,
    from_end: false,
  });
  assert.deepEqual(body.anonymizers.CREDIT_CARD, { type: 'hash', hash_type: 'sha256' });
  assert.equal(body.anonymizers.EMAIL_ADDRESS, undefined); // not present in results
  assert.equal(body.anonymizers.LOCATION, undefined); // uses DEFAULT
});

test('buildAnonymizeRequest with no results still sends the DEFAULT operator', () => {
  const body = buildAnonymizeRequest('clean', [], DEFAULT_ANONYMIZER_POLICY);
  assert.deepEqual(body.analyzer_results, []);
  assert.deepEqual(body.anonymizers.DEFAULT, { type: 'replace' });
});

// ─── normalizeAnonymizeResponse ──────────────────────────────────────────────────
test('normalizeAnonymizeResponse parses items and falls back when text is missing', () => {
  const out = normalizeAnonymizeResponse(
    {
      text: 'My PAN is ******234F',
      items: [
        { start: 10, end: 20, entity_type: 'IN_PAN', text: '******234F', operator: 'mask' },
        { bogus: true }, // dropped
      ],
    },
    'raw',
  );
  assert.equal(out.text, 'My PAN is ******234F');
  assert.equal(out.items.length, 1);
  assert.deepEqual(out.items[0], {
    entityType: 'IN_PAN',
    operator: 'mask',
    start: 10,
    end: 20,
    text: '******234F',
  });

  // Missing text → fallback; missing item coords default to 0
  const fb = normalizeAnonymizeResponse({ items: [{ entity_type: 'X', operator: 'redact' }] }, 'FALL');
  assert.equal(fb.text, 'FALL');
  assert.deepEqual(fb.items[0], { entityType: 'X', operator: 'redact', start: 0, end: 0, text: '' });

  // Wholly junk → fallback text, empty items
  assert.deepEqual(normalizeAnonymizeResponse(null, 'F'), { text: 'F', items: [] });
  assert.deepEqual(normalizeAnonymizeResponse({ items: 'notarray' }, 'F'), { text: 'F', items: [] });
});

// ─── describeOperator ─────────────────────────────────────────────────────────────
test('describeOperator gives a stable human label per operator', () => {
  assert.equal(describeOperator({ type: 'replace', newValue: '<X>' }), 'replace → "<X>"');
  assert.equal(describeOperator({ type: 'replace' }), 'replace → <ENTITY>');
  assert.equal(describeOperator({ type: 'redact' }), 'redact (remove)');
  assert.equal(describeOperator({ type: 'keep' }), 'keep (no change)');
  assert.equal(
    describeOperator({ type: 'mask', maskingChar: '#', charsToMask: 6, fromEnd: true }),
    'mask 6× "#" from end',
  );
  assert.equal(describeOperator({ type: 'mask' }), 'mask 4× "*" from start');
  assert.equal(describeOperator({ type: 'hash', hashType: 'md5' }), 'hash (md5)');
  assert.equal(describeOperator({ type: 'hash' }), 'hash (sha256)');
  assert.equal(describeOperator({ type: 'encrypt' }), 'encrypt (AES)');
});

// ─── catalog invariants ───────────────────────────────────────────────────────────
test('operator + hash catalogs match the verified live engine contract', () => {
  assert.deepEqual([...ANONYMIZE_OPERATORS], ['replace', 'redact', 'mask', 'hash', 'encrypt', 'keep']);
  assert.deepEqual([...HASH_TYPES], ['md5', 'sha256', 'sha512']);
  assert.ok(!(ANONYMIZE_OPERATORS as readonly string[]).includes('custom'));
  // The shipped BFSI default policy is itself valid.
  assert.equal(validateAnonymizerPolicy(DEFAULT_ANONYMIZER_POLICY).ok, true);
});

// ─── Vault-backed encryption keys ─────────────────────────────────────────────────────────────────
// The rule: key material never lives in the policy row. The persisted policy carries the encrypt
// INTENT (keyless spec); the key is bound from the secrets store at call time; an unresolvable key
// DOWNGRADES to replace (still masked — never plaintext) and is reported, never hidden.

test('policyUsesEncrypt detects encryption in the default or any per-entity spec', () => {
  assert.equal(policyUsesEncrypt({ default: { type: 'replace' }, perEntity: {} }), false);
  assert.equal(policyUsesEncrypt({ default: { type: 'encrypt' }, perEntity: {} }), true);
  assert.equal(
    policyUsesEncrypt({ default: { type: 'replace' }, perEntity: { IN_PAN: { type: 'encrypt' } } }),
    true,
  );
});

test('stripInlineEncryptKeys removes key material but PRESERVES the encrypt intent', () => {
  const key = 'k'.repeat(32);
  const stripped = stripInlineEncryptKeys({
    default: { type: 'encrypt', key },
    perEntity: { IN_PAN: { type: 'encrypt', key }, EMAIL_ADDRESS: { type: 'mask', charsToMask: 4 } },
  });
  assert.deepEqual(stripped.default, { type: 'encrypt' }, 'default keeps encrypt, loses the key');
  assert.deepEqual(stripped.perEntity.IN_PAN, { type: 'encrypt' });
  assert.equal(stripped.perEntity.EMAIL_ADDRESS.charsToMask, 4, 'other operators untouched');
  // The stripped shape must survive a persist→read round-trip as ENCRYPT (not silently downgraded).
  assert.equal(normalizeAnonymizerPolicy(stripped).perEntity.IN_PAN.type, 'encrypt');
});

test('bindEncryptKey injects the vaulted key into every keyless encrypt spec', () => {
  const key = 'v'.repeat(24);
  const { policy, downgraded } = bindEncryptKey(
    { default: { type: 'encrypt' }, perEntity: { IN_PAN: { type: 'encrypt' }, X: { type: 'redact' } } },
    key,
  );
  assert.deepEqual(policy.default, { type: 'encrypt', key });
  assert.deepEqual(policy.perEntity.IN_PAN, { type: 'encrypt', key });
  assert.deepEqual(policy.perEntity.X, { type: 'redact' }, 'non-encrypt specs pass through');
  assert.deepEqual(downgraded, [], 'nothing degraded when the key resolves');
});

test('bindEncryptKey FAILS SAFE: no key ⇒ downgrade to replace (masked, never plaintext) + report', () => {
  const { policy, downgraded } = bindEncryptKey(
    { default: { type: 'replace' }, perEntity: { IN_PAN: { type: 'encrypt' }, AADHAAR: { type: 'encrypt' } } },
    null,
  );
  assert.deepEqual(policy.perEntity.IN_PAN, { type: 'replace' }, 'still masked, not passed through');
  assert.deepEqual(policy.perEntity.AADHAAR, { type: 'replace' });
  assert.deepEqual(downgraded.sort(), ['AADHAAR', 'IN_PAN'], 'the degradation is reported honestly');
  // and the produced Presidio operator config is a real masking operator, never an empty-key encrypt
  assert.deepEqual(specToOperatorConfig(policy.perEntity.IN_PAN), { type: 'replace' });
});

test('bindEncryptKey keeps an inline key (bootstrap) in preference to the vaulted one', () => {
  const inline = 'i'.repeat(16);
  const { policy, downgraded } = bindEncryptKey(
    { default: { type: 'encrypt', key: inline }, perEntity: {} },
    'v'.repeat(32),
  );
  assert.deepEqual(policy.default, { type: 'encrypt', key: inline });
  assert.deepEqual(downgraded, []);
});

test('a keyless encrypt policy never reaches Presidio with an empty key', () => {
  // The regression this guards: specToOperatorConfig({type:'encrypt'}) yields key:'' which Presidio
  // rejects; bindEncryptKey must resolve or downgrade FIRST, so an empty key can never be sent.
  const { policy } = bindEncryptKey({ default: { type: 'encrypt' }, perEntity: {} }, null);
  const built = buildAnonymizeRequest('x', [{ entity_type: 'IN_PAN', start: 0, end: 1, score: 1 }], policy);
  assert.notDeepEqual(built.anonymizers.DEFAULT, { type: 'encrypt', key: '' });
  assert.deepEqual(built.anonymizers.DEFAULT, { type: 'replace' });
});
