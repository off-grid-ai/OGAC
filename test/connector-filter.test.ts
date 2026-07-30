import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildEqualityFilter,
  caseRecordFrom,
  filterRows,
  resolveStepParams,
  runInputWithCase,
  unresolvedFilterMessage,
} from '../src/lib/connector-filter.ts';

// ── Scoping a data read to ONE case ────────────────────────────────────────────────────────────────
//
// This module is the centre of the B3.1 story and had no tests, which is how two separate defects hid
// in it. A step declares `params: { employee_id: '{{case.employee_id}}' }`; these rules decide what
// that binds to, and the governing property is that an UNSATISFIABLE filter is an ERROR. Reading
// unfiltered under a step labelled "check THIS employee's quota" returns other people's records, and
// the agent downstream cannot tell the difference.

const CLAIM = {
  id: 1,
  claim_no: 'EXP-2025-00001',
  employee_id: 2,
  employee_name: 'Meera Malhotra',
  amount: '41346.44',
  status: 'submitted',
};

describe('caseRecordFrom', () => {
  test('takes the record from the canonical `case` envelope', () => {
    assert.deepEqual(caseRecordFrom({ input: 'a label', case: CLAIM }), CLAIM);
  });

  test('parses `case` or `case_record` when a sender posts JSON as a string', () => {
    // AppInputForm posts case_record: JSON.stringify(record) — the string form must not be opaque.
    assert.deepEqual(caseRecordFrom({ case_record: JSON.stringify(CLAIM) }), CLAIM);
    assert.deepEqual(caseRecordFrom({ case: JSON.stringify(CLAIM) }), CLAIM);
  });

  test('digs through a nested `body` / `input` envelope', () => {
    assert.deepEqual(caseRecordFrom({ body: { case: CLAIM } }), CLAIM);
    assert.deepEqual(caseRecordFrom({ input: { input: { case: CLAIM } } }), CLAIM);
  });

  test('a webhook that posts the row itself IS the record', () => {
    assert.deepEqual(caseRecordFrom(CLAIM), CLAIM);
  });

  test('no input yields an empty record rather than throwing', () => {
    assert.deepEqual(caseRecordFrom(undefined), {});
    assert.deepEqual(caseRecordFrom({}), {});
  });

  test('stops recursing rather than looping on a self-referential envelope', () => {
    const loop: Record<string, unknown> = {};
    loop.input = loop;
    assert.doesNotThrow(() => caseRecordFrom(loop));
  });
});

// ── The request boundary that silently dropped the case record ──────────────────────────────────────
//
// LIVE FINDING (apprun_8b371023). The run route read only `body.input`, so the picked record — posted as
// its SIBLING — never reached the run. The stored input was the display string "Meera Malhotra ·
// submitted · 41,346.44", and with no record to bind, every case filter read its table unfiltered.
describe('runInputWithCase', () => {
  test('carries the record through so the case can actually be bound', () => {
    const input = runInputWithCase({ input: { input: 'Meera Malhotra · submitted' }, case: CLAIM });
    // The end-to-end property that was broken: what the route produces must yield the record back.
    assert.deepEqual(caseRecordFrom(input), CLAIM);
  });

  test('accepts the older sender spelling, a JSON string under case_record', () => {
    const input = runInputWithCase({ input: {}, case_record: JSON.stringify(CLAIM) });
    assert.deepEqual(caseRecordFrom(input), CLAIM);
  });

  test('keeps the rest of the input intact', () => {
    const input = runInputWithCase({ input: { input: 'label', note: 'urgent' }, case: CLAIM });
    assert.equal(input.input, 'label');
    assert.equal(input.note, 'urgent');
  });

  test('no record posted leaves the input exactly as it was', () => {
    assert.deepEqual(runInputWithCase({ input: { input: 'typed by hand' } }), { input: 'typed by hand' });
    assert.deepEqual(runInputWithCase({}), {});
    // An explicit null must not become a `case: null` that shadows the fallback resolution.
    assert.deepEqual(runInputWithCase({ input: { a: 1 }, case: null }), { a: 1 });
  });

  test('a non-object input is discarded rather than spread into nonsense', () => {
    assert.deepEqual(runInputWithCase({ input: 'a string' }), {});
    assert.deepEqual(runInputWithCase({ input: [1, 2] }), {});
  });
});

describe('resolveStepParams', () => {
  test('binds a {{case.field}} placeholder to the picked record', () => {
    const r = resolveStepParams({ employee_id: '{{case.employee_id}}' }, { case: CLAIM });
    assert.deepEqual(r.filters, { employee_id: 2 });
    assert.deepEqual(r.unresolved, []);
  });

  test('THE governing property: a filter the case cannot satisfy is unresolved, never dropped', () => {
    // Dropping it would read the table unfiltered — the exact defect that made a refused read look
    // like "this employee has no quota" and declined the claim.
    const r = resolveStepParams({ policy_no: '{{case.policy_no}}' }, { case: CLAIM });
    assert.deepEqual(r.filters, {});
    assert.equal(r.unresolved.length, 1);
    assert.match(r.unresolved[0], /policy_no/);
  });

  test('falls back to the envelope\'s own fields, so an email trigger still binds', () => {
    const r = resolveStepParams({ subject: '{{input.subject}}' }, { subject: 'Claim EXP-1' });
    assert.deepEqual(r.filters, { subject: 'Claim EXP-1' });
  });

  test('the case record wins over a same-named envelope field', () => {
    const r = resolveStepParams({ employee_id: '{{case.employee_id}}' }, { employee_id: 999, case: CLAIM });
    assert.deepEqual(r.filters, { employee_id: 2 });
  });

  test('passes a literal value straight through', () => {
    const r = resolveStepParams({ status: 'submitted', fy: 2025, active: true }, {});
    assert.deepEqual(r.filters, { status: 'submitted', fy: 2025, active: true });
  });

  test('rejects a column name that is not a plain identifier — no SQL smuggled in', () => {
    const r = resolveStepParams({ 'id; DROP TABLE claims': 1, 'a b': 2, "x'": 3 }, {});
    assert.deepEqual(r.filters, {});
    assert.equal(r.rejected.length, 3);
  });

  test('rejects a non-scalar value rather than binding an object', () => {
    const r = resolveStepParams({ employee_id: { $ne: null }, other: [1] }, {});
    assert.deepEqual(r.filters, {});
    assert.deepEqual(r.rejected.sort(), ['employee_id', 'other']);
  });

  test('no params is an empty, unfiltered result — not an error', () => {
    const r = resolveStepParams(undefined, { case: CLAIM });
    assert.deepEqual(r, { filters: {}, unresolved: [], rejected: [] });
  });

  test('caps the number of filters instead of building an unbounded predicate', () => {
    const params: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) params[`col_${i}`] = i;
    const r = resolveStepParams(params, {});
    assert.ok(Object.keys(r.filters).length < 40, `capped, got ${Object.keys(r.filters).length}`);
    assert.ok(r.rejected.length > 0);
  });
});

describe('buildEqualityFilter', () => {
  test('emits each dialect\'s own placeholder syntax with bound values', () => {
    const f = { employee_id: 2, status: 'submitted' } as const;
    assert.equal(buildEqualityFilter(f, 'postgres').where, ' WHERE "employee_id" = $1 AND "status" = $2');
    assert.equal(buildEqualityFilter(f, 'mysql').where, ' WHERE `employee_id` = ? AND `status` = ?');
    assert.equal(buildEqualityFilter(f, 'mssql').where, ' WHERE "employee_id" = @p1 AND "status" = @p2');
    // Values are always BOUND, never interpolated — that is what makes the filter injection-proof.
    assert.deepEqual(buildEqualityFilter(f, 'postgres').values, [2, 'submitted']);
  });

  test('no filters means no WHERE clause at all', () => {
    assert.deepEqual(buildEqualityFilter({}, 'postgres'), { where: '', values: [], applied: [] });
  });

  test('an unsafe column never reaches the statement', () => {
    const f = buildEqualityFilter({ 'x; DROP TABLE t': 1 } as Record<string, string | number | boolean>, 'postgres');
    assert.equal(f.where, '');
    assert.deepEqual(f.applied, []);
  });
});

describe('filterRows', () => {
  const ROWS = [
    { employee_id: 2, category: 'Training', remaining: 8000 },
    { employee_id: 4, category: 'Relocation', remaining: 12000 },
    { employee_id: null, category: 'Training', remaining: 0 },
  ];

  test('keeps only the matching rows, for sources we cannot push a predicate into', () => {
    assert.deepEqual(filterRows(ROWS, { employee_id: 2 }), [ROWS[0]]);
  });

  test('matches across representations of the same identifier', () => {
    // `2` from a case record vs `"2"` from a JSON body is not a reason to drop the case.
    assert.deepEqual(filterRows(ROWS, { employee_id: '2' }), [ROWS[0]]);
  });

  test('a null column never matches — absent is not equal', () => {
    assert.deepEqual(filterRows(ROWS, { employee_id: '' }), []);
  });

  test('requires every filter to match, not any', () => {
    assert.deepEqual(filterRows(ROWS, { employee_id: 2, category: 'Relocation' }), []);
    assert.deepEqual(filterRows(ROWS, { employee_id: 2, category: 'Training' }), [ROWS[0]]);
  });

  test('no filters returns every row', () => {
    assert.deepEqual(filterRows(ROWS, {}), ROWS);
  });
});

describe('unresolvedFilterMessage', () => {
  test('names the column and says plainly that nothing was read', () => {
    const m = unresolvedFilterMessage('reimbursement quota', ['employee_id ← case.employee_id']);
    assert.match(m, /reimbursement quota/);
    assert.match(m, /employee_id/);
    // The reader must not be able to mistake this for an empty table.
    assert.match(m, /nothing was read/);
    assert.ok(!m.includes('←'), 'the internal binding arrow is not for a reader');
  });
});
