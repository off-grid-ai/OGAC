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
