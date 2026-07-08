import assert from 'node:assert/strict';
import { test } from 'node:test';
import { regexScan } from '../src/lib/adapters/pii-regex.ts';

// The always-on regex PII floor (pure rule, no mocks). The regression guarded here: EMAIL/PHONE
// are shared module-level `/g` regexes, and the old code used `.test()` — which advances
// `lastIndex` on a global regex and persists it, so every OTHER scan started mid-string and
// silently missed PII. regexScan now detects via `replace`, which is stateless across calls.

test('regexScan: detects and redacts an email', () => {
  const r = regexScan('reach me at jane.doe@example.com please');
  assert.equal(r.hits, true);
  assert.deepEqual(r.entities, ['EMAIL_ADDRESS']);
  assert.match(r.redacted ?? '', /\[EMAIL\]/);
  assert.doesNotMatch(r.redacted ?? '', /example\.com/);
});

test('regexScan: detects a phone number', () => {
  const r = regexScan('call +1 (555) 123-4567 now');
  assert.equal(r.hits, true);
  assert.ok(r.entities.includes('PHONE_NUMBER'));
});

test('regexScan: stateless across repeated calls (the /g lastIndex bug)', () => {
  const text = 'mail: bob@corp.io';
  // A stateful global regex would miss on alternating calls; this must hold every time.
  for (let i = 0; i < 6; i++) {
    const r = regexScan(text);
    assert.equal(r.hits, true, `scan #${i} should still detect the email`);
    assert.deepEqual(r.entities, ['EMAIL_ADDRESS'], `scan #${i}`);
  }
});

test('regexScan: clean text has no hits and is unchanged', () => {
  const r = regexScan('nothing sensitive here');
  assert.equal(r.hits, false);
  assert.deepEqual(r.entities, []);
  assert.equal(r.redacted, 'nothing sensitive here');
});

// ── Indian BFSI floor (G-F2): the interactive-chat / Presidio-down path MUST catch PAN, Aadhaar,
// IFSC and UPI, since the bharatunion tenant's entire seed is Indian financial data. These prove
// detect + redact on valid samples, and keep false positives off obvious non-PII.

test('regexScan: detects and redacts a PAN', () => {
  const r = regexScan('customer PAN is ABCDE1234F on file');
  assert.equal(r.hits, true);
  assert.ok(r.entities.includes('IN_PAN'));
  assert.match(r.redacted ?? '', /\[PAN\]/);
  assert.doesNotMatch(r.redacted ?? '', /ABCDE1234F/);
});

test('regexScan: detects and redacts an IFSC code', () => {
  const r = regexScan('transfer to HDFC0001234 branch');
  assert.equal(r.hits, true);
  assert.ok(r.entities.includes('IN_IFSC'));
  assert.match(r.redacted ?? '', /\[IFSC\]/);
  assert.doesNotMatch(r.redacted ?? '', /HDFC0001234/);
});

test('regexScan: detects and redacts a UPI VPA', () => {
  const r = regexScan('pay ramesh@okhdfc for the invoice');
  assert.equal(r.hits, true);
  assert.ok(r.entities.includes('UPI_ID'));
  assert.match(r.redacted ?? '', /\[UPI\]/);
  assert.doesNotMatch(r.redacted ?? '', /ramesh@okhdfc/);
});

test('regexScan: detects and redacts an Aadhaar (4-4-4 spaced)', () => {
  const r = regexScan('Aadhaar 2345 6789 0123 verified');
  assert.equal(r.hits, true);
  assert.ok(r.entities.includes('IN_AADHAAR'));
  assert.match(r.redacted ?? '', /\[AADHAAR\]/);
  assert.doesNotMatch(r.redacted ?? '', /2345 6789 0123/);
});

test('regexScan: detects a bare 12-digit Aadhaar', () => {
  const r = regexScan('uid 234567890123 on record');
  assert.equal(r.hits, true);
  assert.ok(r.entities.includes('IN_AADHAAR'));
});

test('regexScan: a real email is labelled EMAIL, never UPI', () => {
  const r = regexScan('write to jane.doe@example.com');
  assert.ok(r.entities.includes('EMAIL_ADDRESS'));
  assert.ok(!r.entities.includes('UPI_ID'), 'a dotted-TLD email must not be flagged UPI');
  assert.match(r.redacted ?? '', /\[EMAIL\]/);
});

test('regexScan: precision — a 16-digit card / long order id does NOT trip Aadhaar', () => {
  // 16-digit run (a card number) — longer than 12, so the anchored Aadhaar rule won't match it.
  const card = regexScan('order 4111111111111111 shipped');
  assert.ok(!card.entities.includes('IN_AADHAAR'), '16-digit run is not Aadhaar');
  // A 12-digit id that starts with 1 (UIDAI never issues leading 0/1) is not treated as Aadhaar.
  const orderId = regexScan('ref 123456789012 pending');
  assert.ok(!orderId.entities.includes('IN_AADHAAR'), 'leading-1 12-digit id is not Aadhaar');
});

test('regexScan: precision — an ordinary uppercase word is not a PAN', () => {
  const r = regexScan('the QUARTERLY report is ready');
  assert.ok(!r.entities.includes('IN_PAN'));
});
