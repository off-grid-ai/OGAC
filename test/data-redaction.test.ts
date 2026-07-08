import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  actionForSensitivity,
  applyAction,
  applyColumnRules,
  fnv1a,
  hashValue,
  maskValue,
  policyFromClassifications,
  redactBatch,
  tokenizeValue,
  type RedactionPolicy,
} from '../src/lib/data-redaction.ts';
import { regexPii } from '../src/lib/adapters/pii.ts';

// ── pure value transforms ─────────────────────────────────────────────────────
test('maskValue reveals only the trailing chars', () => {
  assert.equal(maskValue('50100123456789', 4), '••••••••••6789');
  assert.equal(maskValue('ab', 4), '••'); // shorter than keepLast → all masked
  assert.equal(maskValue(null), '');
});

test('fnv1a is deterministic + stable, hash/tokenize are join-safe', () => {
  assert.equal(fnv1a('ABCDE1234F'), fnv1a('ABCDE1234F')); // same input → same digest
  assert.notEqual(fnv1a('ABCDE1234F'), fnv1a('ABCDE1234G'));
  assert.equal(hashValue('x'), hashValue('x')); // stable pseudonym for joins
  assert.match(hashValue('x'), /^h:[0-9a-f]{8}$/);
  assert.match(tokenizeValue('x'), /^tok_[0-9a-f]{8}$/);
  assert.notEqual(hashValue('x'), tokenizeValue('x')); // different namespaces
});

test('applyAction per action', () => {
  assert.deepEqual(applyAction('v', 'keep'), { value: 'v', changed: false });
  assert.deepEqual(applyAction('v', 'drop'), { value: null, changed: true });
  assert.equal(applyAction('v', 'detect').changed, false); // deferred to async path
  assert.equal(applyAction('4111111111111234', 'mask', 4).value, '••••••••••••1234');
});

test('applyColumnRules changes only ruled columns + reports accurate counts', () => {
  const rows = [
    { pan: 'ABCDE1234F', name: 'Neha', balance: 1000 },
    { pan: 'ZYXWV9876Q', name: 'Arjun', balance: 2000 },
  ];
  const policy: RedactionPolicy = [
    { column: 'pan', action: 'hash' },
    { column: 'balance', action: 'keep' },
    { column: 'missing', action: 'drop' }, // not present in rows → no change
  ];
  const res = applyColumnRules(rows, policy);
  assert.match(String(res.rows[0].pan), /^h:/);
  assert.equal(res.rows[0].balance, 1000); // keep untouched
  assert.equal(res.rows[0].name, 'Neha'); // unruled column passed through
  const panEntry = res.report.find((r) => r.column === 'pan');
  assert.equal(panEntry?.changed, 2);
  assert.equal(res.report.find((r) => r.column === 'missing'), undefined);
  assert.equal(res.totalRedacted, 2);
});

test('actionForSensitivity maps labels; unknown fails toward caution (detect)', () => {
  assert.equal(actionForSensitivity('public'), 'keep');
  assert.equal(actionForSensitivity('confidential'), 'mask');
  assert.equal(actionForSensitivity('restricted'), 'drop');
  assert.equal(actionForSensitivity('PII'), 'detect');
  assert.equal(actionForSensitivity(undefined), 'detect'); // never silently 'keep'
  assert.equal(actionForSensitivity('weird-label'), 'detect');
});

test('policyFromClassifications builds rules from M4 sensitivity labels', () => {
  const policy = policyFromClassifications([
    { column: 'email', sensitivity: 'pii' },
    { column: 'city', sensitivity: 'public' },
  ]);
  assert.deepEqual(policy, [
    { column: 'email', action: 'detect' },
    { column: 'city', action: 'keep' },
  ]);
});

// ── redactBatch with the REAL always-on regex PII port (no network) ───────────
test('redactBatch runs PII detection on detect columns via the real regex port', async () => {
  const rows = [
    { note: 'contact neha@bank.example about loan', acct: '50100123456789', city: 'Pune' },
    { note: 'no pii here', acct: '50100987654321', city: 'Chennai' },
  ];
  const policy: RedactionPolicy = [
    { column: 'note', action: 'detect' }, // free-text → PII scan
    { column: 'acct', action: 'mask', keepLast: 4 },
    { column: 'city', action: 'keep' },
  ];
  const res = await redactBatch(rows, policy, regexPii);
  // the email in row 0's note is detected + redacted; row 1 has no PII so is untouched
  assert.ok(!String(res.rows[0].note).includes('neha@bank.example'));
  assert.match(String(res.rows[0].note), /\[EMAIL\]/);
  assert.equal(res.rows[1].note, 'no pii here');
  // mask applied to both account numbers
  assert.equal(res.rows[0].acct, '••••••••••6789');
  assert.equal(res.rows[1].city, 'Chennai'); // keep
  const noteEntry = res.report.find((r) => r.column === 'note');
  assert.equal(noteEntry?.changed, 1); // only row 0 had a hit
  assert.ok(res.totalRedacted >= 3); // 1 note + 2 accts
});

test('redactBatch with no PII port applies only the pure rules', async () => {
  const rows = [{ note: 'neha@bank.example', acct: '50100123456789' }];
  const policy: RedactionPolicy = [
    { column: 'note', action: 'detect' },
    { column: 'acct', action: 'hash' },
  ];
  const res = await redactBatch(rows, policy); // no port → detect is a no-op
  assert.equal(res.rows[0].note, 'neha@bank.example'); // untouched (couldn't scan)
  assert.match(String(res.rows[0].acct), /^h:/); // pure rule still applied
});
