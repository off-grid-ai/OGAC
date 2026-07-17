// CONDITION-COVERAGE tests for data-redaction.ts — every applyAction arm (incl. tokenize + the
// unreachable default), the null/empty guards on each transform, the classification→action map's
// every case, applyColumnRules' detect-skip + unknown-column arms, and redactBatch's short-circuits
// (no port / no detect columns / null-cell / hits vs no-hits) using the REAL regex PII floor.
// Additive; imports existing exports only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type RedactionAction,
  actionForSensitivity,
  activePiiPort,
  applyAction,
  applyColumnRules,
  fnv1a,
  hashValue,
  maskValue,
  policyFromClassifications,
  redactBatch,
  tokenizeValue,
} from '@/lib/data-redaction';

// ─── pure value transforms — null/empty vs value arms ──────────────────────────────────────────────

test('maskValue: reveals only the last N chars', () => {
  assert.equal(maskValue('4111111111111234', 4), '••••••••••••1234');
});

test('maskValue: a value shorter than keepLast is fully masked (<= keepLast arm)', () => {
  assert.equal(maskValue('ab', 4), '••');
});

test('maskValue: null → empty-length mask (value == null arm)', () => {
  assert.equal(maskValue(null), '');
});

test('fnv1a is deterministic + padded to 8 hex chars', () => {
  assert.equal(fnv1a('x'), fnv1a('x'));
  assert.equal(fnv1a('').length, 8); // 0x811c9dc5 hashed over empty → still 8 chars padded
});

test('hashValue: null → empty (null arm); value → h: prefix', () => {
  assert.equal(hashValue(null), '');
  assert.match(hashValue('acct'), /^h:[0-9a-f]{8}$/);
});

test('tokenizeValue: null → empty (null arm); value → tok_ prefix', () => {
  assert.equal(tokenizeValue(undefined), '');
  assert.match(tokenizeValue('acct'), /^tok_[0-9a-f]{8}$/);
});

// ─── applyAction — EVERY switch arm + the changed-flag guards ──────────────────────────────────────

test('applyAction keep: passes value through, changed false', () => {
  assert.deepEqual(applyAction('v', 'keep'), { value: 'v', changed: false });
});

test('applyAction drop: nulls a present value (changed true) vs already-null (changed false)', () => {
  assert.deepEqual(applyAction('v', 'drop'), { value: null, changed: true });
  assert.deepEqual(applyAction(null, 'drop'), { value: null, changed: false });
});

test('applyAction mask: changed true for non-empty, false for empty string', () => {
  assert.equal(applyAction('secret', 'mask').changed, true);
  assert.equal(applyAction('', 'mask').changed, false); // length > 0 arm false
  assert.equal(applyAction(null, 'mask').changed, false); // != null arm false
});

test('applyAction hash: changed true for value, false for null', () => {
  assert.equal(applyAction('v', 'hash').changed, true);
  assert.equal(applyAction(null, 'hash').changed, false);
});

test('applyAction tokenize: changed true for value, false for null (line-89 arm)', () => {
  const r = applyAction('acct', 'tokenize');
  assert.match(String(r.value), /^tok_/);
  assert.equal(r.changed, true);
  assert.equal(applyAction(null, 'tokenize').changed, false);
});

test('applyAction detect: no-op in the pure path (changed false)', () => {
  assert.deepEqual(applyAction('v', 'detect'), { value: 'v', changed: false });
});

test('applyAction default: an unknown action falls through to the safe no-op (default arm)', () => {
  // Force an out-of-union action at runtime to hit the `default:` branch (line 94).
  const r = applyAction('v', 'bogus' as unknown as RedactionAction);
  assert.deepEqual(r, { value: 'v', changed: false });
});

// ─── actionForSensitivity — every label case + the default (conservative) arm ──────────────────────

test('actionForSensitivity: public/internal → keep', () => {
  assert.equal(actionForSensitivity('public'), 'keep');
  assert.equal(actionForSensitivity('INTERNAL'), 'keep'); // case-fold
});

test('actionForSensitivity: confidential → mask; restricted/secret → drop', () => {
  assert.equal(actionForSensitivity('confidential'), 'mask');
  assert.equal(actionForSensitivity('restricted'), 'drop');
  assert.equal(actionForSensitivity('secret'), 'drop');
});

test('actionForSensitivity: pii/sensitive → detect', () => {
  assert.equal(actionForSensitivity('pii'), 'detect');
  assert.equal(actionForSensitivity('sensitive'), 'detect');
});

test('actionForSensitivity: unknown / undefined → detect (conservative default arm)', () => {
  assert.equal(actionForSensitivity('mystery'), 'detect');
  assert.equal(actionForSensitivity(undefined), 'detect');
});

test('policyFromClassifications maps each column through actionForSensitivity', () => {
  const policy = policyFromClassifications([
    { column: 'name', sensitivity: 'public' },
    { column: 'ssn', sensitivity: 'pii' },
    { column: 'note' }, // no sensitivity → detect
  ]);
  assert.deepEqual(policy, [
    { column: 'name', action: 'keep' },
    { column: 'ssn', action: 'detect' },
    { column: 'note', action: 'detect' },
  ]);
});

// ─── applyColumnRules — detect-skip arm, unknown-column arm, report aggregation ────────────────────

test('applyColumnRules: applies mask + hash, skips detect + unknown columns, aggregates the report', () => {
  const rows = [
    { pan: '4111111111111234', acct: '99887766', notes: 'free text', absent_here: 'x' },
    { pan: '5500000000000004', acct: '11223344', notes: 'more' },
  ];
  const res = applyColumnRules(rows, [
    { column: 'pan', action: 'mask', keepLast: 4 },
    { column: 'acct', action: 'hash' },
    { column: 'notes', action: 'detect' }, // detect skipped in the pure path
    { column: 'ghost', action: 'drop' }, // column not in any row → `col in next` false
  ]);
  assert.match(String(res.rows[0].pan), /1234$/);
  assert.match(String(res.rows[0].acct), /^h:/);
  assert.equal(res.rows[0].notes, 'free text'); // detect left untouched here
  assert.equal(res.rows[0].absent_here, 'x'); // unknown-to-policy column passed through
  const cols = res.report.map((r) => r.column).sort();
  assert.deepEqual(cols, ['acct', 'pan']);
  assert.equal(res.totalRedacted, 4); // 2 pan + 2 acct
});

test('applyColumnRules: empty-string mask does not increment the report (changed false)', () => {
  const res = applyColumnRules([{ c: '' }], [{ column: 'c', action: 'mask' }]);
  assert.equal(res.report.length, 0);
  assert.equal(res.totalRedacted, 0);
});

// ─── redactBatch — short-circuit arms + the detect path over the REAL regex floor ─────────────────

test('redactBatch: no PII port → returns the pure base result unchanged (|| short-circuit)', async () => {
  const res = await redactBatch([{ email: 'a@b.com' }], [{ column: 'email', action: 'detect' }]);
  assert.equal(res.rows[0].email, 'a@b.com'); // detect not applied without a port
});

test('redactBatch: a port but zero detect columns → base result (detectCols.length === 0 arm)', async () => {
  const port = await activePiiPort();
  const res = await redactBatch(
    [{ pan: '4111111111111234' }],
    [{ column: 'pan', action: 'mask' }],
    port,
  );
  assert.match(String(res.rows[0].pan), /1234$/);
});

test('redactBatch: detect column with an email → redacted by the regex floor (hits arm)', async () => {
  const port = await activePiiPort();
  const res = await redactBatch(
    [{ body: 'contact me at alice@example.com please' }, { body: null }, { body: '' }],
    [{ column: 'body', action: 'detect' }],
    port,
  );
  // Row 0 had a detectable email → changed; rows 1 (null) + 2 (empty) short-circuit (continue arms).
  assert.notEqual(res.rows[0].body, 'contact me at alice@example.com please');
  assert.equal(res.rows[1].body, null);
  assert.equal(res.rows[2].body, '');
  assert.ok(res.totalRedacted >= 1);
  assert.ok(res.report.some((e) => e.column === 'body' && e.action === 'detect'));
});

test('redactBatch: a detect column absent from a row is skipped (`col in row` false arm)', async () => {
  const port = await activePiiPort();
  const res = await redactBatch([{ other: 'x' }], [{ column: 'body', action: 'detect' }], port);
  assert.equal(res.rows[0].other, 'x');
  assert.equal(res.totalRedacted, 0);
});

test('redactBatch: clean detect text with NO PII produces no change (no-hits arm)', async () => {
  const port = await activePiiPort();
  const res = await redactBatch(
    [{ body: 'the quarterly figures look healthy' }],
    [{ column: 'body', action: 'detect' }],
    port,
  );
  assert.equal(res.rows[0].body, 'the quarterly figures look healthy');
  assert.equal(res.totalRedacted, 0);
});

// ─── activePiiPort — env-gated selection (both arms) ───────────────────────────────────────────────

test('activePiiPort: no OFFGRID_PRESIDIO_URL → the regex floor port', async () => {
  const prev = process.env.OFFGRID_PRESIDIO_URL;
  delete process.env.OFFGRID_PRESIDIO_URL;
  try {
    const port = await activePiiPort();
    const scan = await port.scan('reach me at bob@example.com');
    assert.equal(scan.hits, true); // the regex floor detects an email
  } finally {
    if (prev !== undefined) process.env.OFFGRID_PRESIDIO_URL = prev;
  }
});

test('activePiiPort: OFFGRID_PRESIDIO_URL set → selects the presidio port (ternary true arm)', async () => {
  const prev = process.env.OFFGRID_PRESIDIO_URL;
  process.env.OFFGRID_PRESIDIO_URL = 'http://presidio.invalid:5001';
  try {
    const port = await activePiiPort();
    assert.equal(port.meta.id, 'presidio');
    // We don't call the network here; the boundary integration test exercises analyzer+anonymizer.
    assert.equal(typeof port.scan, 'function');
    assert.equal(typeof port.health, 'function');
  } finally {
    if (prev === undefined) delete process.env.OFFGRID_PRESIDIO_URL;
    else process.env.OFFGRID_PRESIDIO_URL = prev;
  }
});
