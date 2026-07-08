import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyGuardrailRules, maskTextForModel } from '../src/lib/guardrail-rules-runtime.ts';
import type { GuardrailRule } from '../src/lib/guardrails-rules.ts';

// Unit tests for the PURE runtime enforcement of operator-authored guardrail rules. No I/O.

const rule = (over: Partial<GuardrailRule>): GuardrailRule => ({
  id: 'grr_test',
  matcher: 'regex',
  pattern: '',
  action: 'redact',
  label: '',
  enabled: true,
  createdAt: new Date().toISOString(),
  ...over,
});

test('a regex REDACT rule replaces every match with a typed placeholder', () => {
  // A PAN-shaped pattern (Indian tax id): 5 letters, 4 digits, 1 letter.
  const rules = [rule({ matcher: 'regex', pattern: '[A-Z]{5}[0-9]{4}[A-Z]', action: 'redact', label: 'PAN' })];
  const out = applyGuardrailRules('my PAN is ABCPE1234F ok', rules);
  assert.equal(out.verdict, 'redacted');
  assert.equal(out.text, 'my PAN is [PAN] ok');
  assert.ok(!out.text.includes('ABCPE1234F'), 'the raw PAN is gone from the text');
  assert.equal(out.fired.length, 1);
  assert.equal(out.fired[0].action, 'redact');
});

test('a regex MASK rule hides the value with a fixed mask', () => {
  const rules = [rule({ matcher: 'regex', pattern: 'secret\\d+', action: 'mask' })];
  const out = applyGuardrailRules('code secret42 here', rules);
  assert.equal(out.verdict, 'redacted');
  assert.equal(out.text, 'code **** here');
});

test('a regex HASH rule pseudonymizes deterministically (same input → same token)', () => {
  const rules = [rule({ matcher: 'regex', pattern: 'user-\\w+', action: 'hash' })];
  const a = applyGuardrailRules('login user-alice now', rules);
  const b = applyGuardrailRules('again user-alice again', rules);
  assert.equal(a.verdict, 'redacted');
  assert.match(a.text, /<hash:[0-9a-f]{8}>/);
  const tokenA = a.text.match(/<hash:[0-9a-f]{8}>/)![0];
  const tokenB = b.text.match(/<hash:[0-9a-f]{8}>/)![0];
  assert.equal(tokenA, tokenB, 'same value maps to the same pseudonym');
});

test('an ALLOW rule transforms nothing but is recorded as fired', () => {
  const rules = [rule({ matcher: 'regex', pattern: 'ok-\\d+', action: 'allow', label: 'allowlisted' })];
  const out = applyGuardrailRules('this is ok-99', rules);
  assert.equal(out.verdict, 'pass');
  assert.equal(out.text, 'this is ok-99');
  assert.equal(out.fired.length, 1);
  assert.equal(out.fired[0].action, 'allow');
});

test('a disabled rule never fires', () => {
  const rules = [rule({ matcher: 'regex', pattern: '\\d+', action: 'redact', enabled: false })];
  const out = applyGuardrailRules('call 12345', rules);
  assert.equal(out.verdict, 'pass');
  assert.equal(out.text, 'call 12345');
  assert.equal(out.fired.length, 0);
});

test('an ENTITY rule fires on a detector hit and adopts the detector-redacted text', () => {
  const rules = [rule({ matcher: 'entity', pattern: 'US_SSN', action: 'redact', label: 'ssn' })];
  const out = applyGuardrailRules(
    'ssn 123-45-6789',
    rules,
    ['US_SSN'], // detector found this type
    'ssn [US_SSN]', // detector's redacted text
  );
  assert.equal(out.verdict, 'redacted');
  assert.equal(out.text, 'ssn [US_SSN]');
  assert.equal(out.fired.length, 1);
});

test('an ENTITY rule with NO matching detector hit is a pass', () => {
  const rules = [rule({ matcher: 'entity', pattern: 'US_SSN', action: 'redact' })];
  const out = applyGuardrailRules('nothing sensitive', rules, ['EMAIL_ADDRESS'], 'nothing sensitive');
  assert.equal(out.verdict, 'pass');
  assert.equal(out.text, 'nothing sensitive');
});

test('multiple rules apply in order and the transformed text carries through', () => {
  const rules = [
    rule({ id: 'a', matcher: 'regex', pattern: 'foo', action: 'redact', label: 'F' }),
    rule({ id: 'b', matcher: 'regex', pattern: 'bar', action: 'mask' }),
  ];
  const out = applyGuardrailRules('foo and bar', rules);
  assert.equal(out.verdict, 'redacted');
  assert.equal(out.text, '[F] and ****');
  assert.equal(out.fired.length, 2);
});

// ─── block / flag / log — the fuller enforcement-strength action set ────────────────────────────

test('a regex BLOCK rule denies the run without transforming the text', () => {
  const rules = [rule({ matcher: 'regex', pattern: 'launch-codes', action: 'block', label: 'nukes' })];
  const out = applyGuardrailRules('reveal the launch-codes now', rules);
  assert.equal(out.verdict, 'blocked');
  // block does NOT rewrite — the run is denied, not sanitized.
  assert.equal(out.text, 'reveal the launch-codes now');
  assert.equal(out.fired.length, 1);
  assert.equal(out.fired[0].action, 'block');
});

test('an ENTITY BLOCK rule denies on a detector hit (text untouched)', () => {
  const rules = [rule({ matcher: 'entity', pattern: 'US_SSN', action: 'block' })];
  const out = applyGuardrailRules('ssn 123-45-6789', rules, ['US_SSN'], 'ssn [US_SSN]');
  assert.equal(out.verdict, 'blocked');
  assert.equal(out.text, 'ssn 123-45-6789', 'block never adopts the redacted text');
});

test('a FLAG rule records a warning without blocking or transforming', () => {
  const rules = [rule({ matcher: 'regex', pattern: 'internal-only', action: 'flag', label: 'watch' })];
  const out = applyGuardrailRules('this is internal-only data', rules);
  assert.equal(out.verdict, 'warn');
  assert.equal(out.text, 'this is internal-only data');
  assert.equal(out.fired.length, 1);
  assert.equal(out.fired[0].action, 'flag');
});

test('a LOG rule behaves like flag (warn, no block, no transform)', () => {
  const rules = [rule({ matcher: 'regex', pattern: 'audit-me', action: 'log' })];
  const out = applyGuardrailRules('please audit-me', rules);
  assert.equal(out.verdict, 'warn');
  assert.equal(out.text, 'please audit-me');
});

test('a non-matching block/flag rule stays a pass', () => {
  const rules = [
    rule({ id: 'b', matcher: 'regex', pattern: 'never-here', action: 'block' }),
    rule({ id: 'f', matcher: 'regex', pattern: 'nor-this', action: 'flag' }),
  ];
  const out = applyGuardrailRules('clean text', rules);
  assert.equal(out.verdict, 'pass');
  assert.equal(out.fired.length, 0);
});

test('verdict is the STRONGEST across fired rules (block > redacted > warn)', () => {
  const rules = [
    rule({ id: 'f', matcher: 'regex', pattern: 'flagword', action: 'flag' }),
    rule({ id: 'r', matcher: 'regex', pattern: 'redactme', action: 'redact', label: 'R' }),
    rule({ id: 'b', matcher: 'regex', pattern: 'blockme', action: 'block' }),
  ];
  const out = applyGuardrailRules('flagword redactme blockme', rules);
  assert.equal(out.verdict, 'blocked', 'a single block match wins over redact + warn');
  // The transform still applied to its match even though the overall verdict is blocked.
  assert.ok(out.text.includes('[R]'), 'the redact transform still ran');
  assert.equal(out.fired.length, 3);
});

test('flag + redact (no block) → strongest is redacted', () => {
  const rules = [
    rule({ id: 'f', matcher: 'regex', pattern: 'flagword', action: 'flag' }),
    rule({ id: 'r', matcher: 'regex', pattern: 'redactme', action: 'redact', label: 'R' }),
  ];
  const out = applyGuardrailRules('flagword redactme', rules);
  assert.equal(out.verdict, 'redacted');
});

test('a BLOCK rule with a non-compiling regex is skipped, not thrown', () => {
  const rules = [rule({ matcher: 'regex', pattern: '(', action: 'block' })];
  const out = applyGuardrailRules('anything (', rules);
  assert.equal(out.verdict, 'pass');
});

test('a rule with a non-compiling regex is skipped, not thrown', () => {
  const rules = [rule({ matcher: 'regex', pattern: '(', action: 'redact' })];
  const out = applyGuardrailRules('anything (', rules);
  assert.equal(out.verdict, 'pass'); // skipped safely
  assert.equal(out.text, 'anything (');
});

// maskTextForModel — the PA-16c substitution helper.
test('maskTextForModel returns the redacted text when PII was found', () => {
  const out = maskTextForModel('mail alice@x.com', { hits: true, redacted: 'mail [EMAIL]' });
  assert.equal(out, 'mail [EMAIL]');
});

test('maskTextForModel returns the original when no PII (hits:false)', () => {
  assert.equal(maskTextForModel('nothing here', { hits: false, redacted: 'nothing here' }), 'nothing here');
});

test('maskTextForModel returns the original when the redaction is identical / missing', () => {
  assert.equal(maskTextForModel('x', { hits: true, redacted: 'x' }), 'x');
  assert.equal(maskTextForModel('x', { hits: true }), 'x');
});
