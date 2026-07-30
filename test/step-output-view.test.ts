import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { displayCell, humanizeColumn, parseRowsOutput } from '../src/lib/step-output-view.ts';

// ── Flow 6: "the reviewer understands the action and evidence" ───────────────────────────────────────
//
// The evidence a reviewer saw was raw positional JSON. A person approving a ₹41,346 claim cannot check a
// decision against that, which makes the approval a rubber stamp. These are the real step outputs from
// live runs apprun_76864dd2 (labelled) and apprun_3f045e0b (the older columnar form).

const LABELLED =
  'reimbursement quota (employee_quota): 6 row(s).\n' +
  '[{"id":7,"employee_id":2,"employee_name":"Meera Malhotra","category":"Travel","annual_quota":"150000.00","used":"76658.39","remaining":"73341.61"},' +
  '{"id":11,"employee_id":2,"employee_name":"Meera Malhotra","category":"Training","annual_quota":"200000.00","used":"62545.88","remaining":"137454.12"}]';

const COLUMNAR =
  'reimbursement quota (employee_quota): 2 row(s).\n' +
  '{"columns":["id","employee_id","category"],"rows":[[7,2,"Travel"],[11,2,"Training"]]}';

describe('parseRowsOutput', () => {
  test('parses labelled rows into a table, preserving the source field order', () => {
    const v = parseRowsOutput(LABELLED)!;
    assert.ok(v);
    assert.equal(v.rows.length, 2);
    assert.deepEqual(v.columns.slice(0, 4), ['id', 'employee_id', 'employee_name', 'category']);
    assert.equal(v.head, 'reimbursement quota (employee_quota): 6 row(s).');
    // The Training row is the one that decides the claim — it must survive intact.
    assert.equal(v.rows[1].remaining, '137454.12');
  });

  test('parses the OLDER columnar form, so historical runs still render as a table', () => {
    const v = parseRowsOutput(COLUMNAR)!;
    assert.ok(v);
    assert.deepEqual(v.columns, ['id', 'employee_id', 'category']);
    assert.deepEqual(v.rows[1], { id: 11, employee_id: 2, category: 'Training' });
  });

  test('splits the coverage sentence out so the UI can place it', () => {
    const v = parseRowsOutput('claims (c): 21 row(s). Showing 20 of 21.\n[{"a":1}]')!;
    assert.equal(v.coverage, 'Showing 20 of 21.');
    assert.ok(!v.head.includes('Showing'), v.head);
  });

  test('takes the union of keys — a later row may carry a field the first lacks', () => {
    const v = parseRowsOutput('x (y): 2 row(s).\n[{"a":1},{"a":2,"b":3}]')!;
    assert.deepEqual(v.columns, ['a', 'b']);
  });

  // ── Falls back rather than guessing: raw text is never worse than today. ──
  test('returns null for a legible sentence, which must be shown as written', () => {
    assert.equal(
      parseRowsOutput('Could not read reimbursement quota (employee_quota) — the credential was refused.'),
      null,
    );
    assert.equal(parseRowsOutput('The claim is within the remaining Training quota.'), null);
  });

  test('returns null for an empty read rather than rendering an empty table', () => {
    assert.equal(parseRowsOutput('quota (employee_quota): 0 row(s).\n[]'), null);
  });

  test('returns null on malformed or mixed payloads instead of guessing', () => {
    assert.equal(parseRowsOutput('x (y): 1 row(s).\n[{"a":1'), null);
    assert.equal(parseRowsOutput('x (y): 2 row(s).\n[{"a":1},"loose string"]'), null);
    assert.equal(parseRowsOutput('x (y): 1 row(s).\n{"columns":["a"],"rows":"nope"}'), null);
    assert.equal(parseRowsOutput('x (y): 1 row(s).\n{"columns":["a"],"rows":[{"a":1}]}'), null);
  });

  test('tolerates absent output', () => {
    assert.equal(parseRowsOutput(undefined), null);
    assert.equal(parseRowsOutput(null), null);
    assert.equal(parseRowsOutput(''), null);
  });
});

describe('humanizeColumn', () => {
  test('reads a column name the way a person would', () => {
    assert.equal(humanizeColumn('annual_quota'), 'Annual quota');
    assert.equal(humanizeColumn('employee_id'), 'Employee id');
    assert.equal(humanizeColumn('claimNo'), 'Claim no');
    assert.equal(humanizeColumn('remaining'), 'Remaining');
  });

  test('never returns empty, whatever it is handed', () => {
    assert.equal(humanizeColumn(''), '');
    assert.equal(humanizeColumn('   '), '   ');
    assert.equal(humanizeColumn('_'), '_');
  });
});

describe('displayCell', () => {
  test('shows values exactly as the source states them — no rounding, no invented symbol', () => {
    // The currency rule from G-UX5 applies here too: the record says 150000.00, so that is what shows.
    assert.equal(displayCell('150000.00'), '150000.00');
    assert.equal(displayCell(41346.44), '41346.44');
    assert.equal(displayCell(0), '0');
    assert.equal(displayCell(false), 'false');
  });

  test('an absent value reads as absent, not as zero or blank', () => {
    assert.equal(displayCell(null), '—');
    assert.equal(displayCell(undefined), '—');
  });
});
