import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  regexError,
  RULE_ACTIONS,
  RULE_MATCHERS,
  validateRule,
} from '../src/lib/guardrails-rules.ts';

// Pure guardrails-rule validation + normalization. No DB, no mocks — a loose draft in, a
// normalized rule or a validation error out. The I/O (table ensure + CRUD queries) is exercised
// separately; these lock the rule that decides what's a valid, storable masking rule.

// ── happy paths ─────────────────────────────────────────────────────────────

test('validateRule: entity draft normalizes (upper-cases name, defaults enabled)', () => {
  const r = validateRule({ matcher: 'entity', pattern: 'us_ssn', action: 'redact' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value, {
    matcher: 'entity',
    pattern: 'US_SSN',
    action: 'redact',
    label: '',
    enabled: true,
  });
});

test('validateRule: regex draft keeps the pattern verbatim', () => {
  const r = validateRule({
    matcher: 'regex',
    pattern: '\\bACME-\\d+\\b',
    action: 'hash',
    label: '  internal ids  ',
    enabled: false,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.pattern, '\\bACME-\\d+\\b');
  assert.equal(r.value.action, 'hash');
  assert.equal(r.value.label, 'internal ids'); // trimmed
  assert.equal(r.value.enabled, false); // explicit false honored
});

test('validateRule: every action is accepted', () => {
  for (const action of RULE_ACTIONS) {
    const r = validateRule({ matcher: 'entity', pattern: 'PERSON', action });
    assert.equal(r.ok, true, `action ${action} should validate`);
  }
});

test('validateRule: every matcher is accepted', () => {
  for (const matcher of RULE_MATCHERS) {
    const r = validateRule({ matcher, pattern: matcher === 'entity' ? 'EMAIL' : '\\d+', action: 'mask' });
    assert.equal(r.ok, true, `matcher ${matcher} should validate`);
  }
});

// ── rejections ──────────────────────────────────────────────────────────────

test('validateRule: bad matcher rejected', () => {
  const r = validateRule({ matcher: 'nope', pattern: 'X', action: 'redact' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /matcher/);
});

test('validateRule: bad action rejected', () => {
  const r = validateRule({ matcher: 'entity', pattern: 'EMAIL', action: 'delete' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /action/);
});

test('validateRule: empty pattern rejected', () => {
  const r = validateRule({ matcher: 'entity', pattern: '   ', action: 'redact' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /pattern is required/);
});

test('validateRule: non-upper-snake entity name rejected', () => {
  const r = validateRule({ matcher: 'entity', pattern: 'bad name!', action: 'redact' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /UPPER_SNAKE/);
});

test('validateRule: uncompilable regex rejected', () => {
  const r = validateRule({ matcher: 'regex', pattern: '(', action: 'mask' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /invalid regex/);
});

test('validateRule: null/malformed draft degrades to an error, never throws', () => {
  assert.equal(validateRule(null).ok, false);
  assert.equal(validateRule(undefined).ok, false);
  assert.equal(validateRule('nope' as unknown as null).ok, false);
});

// ── regexError helper ────────────────────────────────────────────────────────

test('regexError: valid pattern → null, invalid → message', () => {
  assert.equal(regexError('\\d{3}-\\d{4}'), null);
  assert.notEqual(regexError('('), null);
});
