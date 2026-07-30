import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  columnsOfRow,
  inferCaseScope,
  isQualifiedIdentifier,
  scopeDetail,
} from '../src/lib/case-scope.ts';

// ── B3.1 — the compiler-inserted read must be scoped to the case ───────────────────────────────────
//
// LIVE FINDING (run apprun_0c63589e). The inserted quota read had no filters, returned 20 arbitrary
// rows, and the agent answered: "no reimbursement quota data is provided in the sources for Meera
// Malhotra" — on a table that held her quota. These are the real column sets from that run.

const CLAIM_CASE = {
  id: 'clm_88213',
  employee_id: 'EMP-2041',
  employee_name: 'Meera Malhotra',
  category: 'Training',
  amount: 41346.44,
  status: 'submitted',
};
const QUOTA_COLUMNS = ['id', 'employee_id', 'category', 'annual_limit', 'consumed', 'remaining'];

describe('B3.1 — inferCaseScope', () => {
  test('scopes the quota read to the employee on the claim', () => {
    const scope = inferCaseScope(QUOTA_COLUMNS, CLAIM_CASE);
    assert.deepEqual(scope.filters, { employee_id: 'EMP-2041' });
    assert.deepEqual(scope.keys, ['employee_id']);
  });

  // ── The hazard this module exists to avoid, pinned. ──
  test('NEVER matches a bare `id` — the two tables mean different things by it', () => {
    // employee_quota.id = 'clm_88213' would return a confident row about the WRONG entity, and nothing
    // downstream could tell. That is strictly worse than the unscoped read it would replace.
    const scope = inferCaseScope(QUOTA_COLUMNS, CLAIM_CASE);
    assert.ok(!('id' in scope.filters), JSON.stringify(scope.filters));
  });

  test('does not filter on shared ATTRIBUTES, only identifiers', () => {
    // `category` is shared and would even be more precise here — but over-filtering on an attribute
    // turns "her quota" into zero rows the moment a label differs by a word, and an empty result reads
    // as an empty table. Narrowing must be safe in general, not clever in one case.
    const scope = inferCaseScope(QUOTA_COLUMNS, CLAIM_CASE);
    assert.deepEqual(Object.keys(scope.filters), ['employee_id']);
  });

  test('matches across driver casing differences', () => {
    const scope = inferCaseScope(['EMPLOYEE_ID', 'REMAINING'], { Employee_Id: 'EMP-7' });
    // Emitted under the RESOURCE's spelling, because that is what goes into the statement.
    assert.deepEqual(scope.filters, { EMPLOYEE_ID: 'EMP-7' });
  });

  test('takes every shared qualified identifier, not just the first', () => {
    const scope = inferCaseScope(['policy_no', 'customer_id', 'premium'], {
      policy_no: 'POL-9',
      customer_id: 4412,
      premium: 1200,
    });
    assert.deepEqual(scope.filters, { policy_no: 'POL-9', customer_id: 4412 });
  });

  test('skips blank and non-scalar values — a filter on empty is a guess, not a narrowing', () => {
    const scope = inferCaseScope(['employee_id', 'branch_code', 'manager_id', 'audit_ref'], {
      employee_id: '   ',
      branch_code: null,
      manager_id: { nested: true },
      audit_ref: ['a'],
    });
    assert.deepEqual(scope.filters, {});
  });

  test('keeps 0 and false — falsy is a real value, and dropping it silently widens the read', () => {
    const scope = inferCaseScope(['branch_id', 'is_flagged_no'], { branch_id: 0, is_flagged_no: false });
    assert.deepEqual(scope.filters, { branch_id: 0, is_flagged_no: false });
  });

  test('no case record, or no overlap, yields no filters rather than an invented one', () => {
    assert.deepEqual(inferCaseScope(QUOTA_COLUMNS, null).filters, {});
    assert.deepEqual(inferCaseScope(QUOTA_COLUMNS, undefined).filters, {});
    assert.deepEqual(inferCaseScope(['policy_no'], CLAIM_CASE).filters, {});
    assert.deepEqual(inferCaseScope([], CLAIM_CASE).filters, {});
  });
});

describe('B3.1 — isQualifiedIdentifier', () => {
  test('accepts a prefixed identifier', () => {
    for (const c of ['employee_id', 'policy_no', 'customer_code', 'gl_account_number', 'audit_ref']) {
      assert.ok(isQualifiedIdentifier(c), c);
    }
  });

  test('rejects the bare and unprefixed forms', () => {
    for (const c of ['id', 'code', 'no', 'number', 'ref', '_id', 'ID']) {
      assert.ok(!isQualifiedIdentifier(c), c);
    }
  });

  test('rejects attributes that merely end in a word', () => {
    for (const c of ['status', 'amount', 'category', 'created_at', 'employee_name']) {
      assert.ok(!isQualifiedIdentifier(c), c);
    }
  });
});

describe('B3.1 — columnsOfRow / scopeDetail', () => {
  test('reads columns off a probe row and tolerates every non-row', () => {
    assert.deepEqual(columnsOfRow({ a: 1, b: 2 }), ['a', 'b']);
    for (const v of [null, undefined, [], 'x', 7]) assert.deepEqual(columnsOfRow(v), []);
  });

  test('states the scope, and states its absence too', () => {
    assert.match(scopeDetail({ filters: { employee_id: 'E1' }, keys: ['employee_id'] }), /employee_id/);
    // "read unscoped" is the fact a reviewer needs in order to distrust the answer — never silent.
    assert.match(scopeDetail({ filters: {}, keys: [] }), /unscoped/);
  });
});
