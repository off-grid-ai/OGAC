import assert from 'node:assert/strict';
import test from 'node:test';
import { delinquencyEvidenceState, validateDelinquencyCase } from '../src/lib/lending-delinquency-contract.ts';
import {
  assembleLendingDelinquencyCases,
  type LendingDelinquencySourceSnapshot,
} from '../src/lib/lending-delinquency-opportunity.ts';

function snapshot(): LendingDelinquencySourceSnapshot {
  return {
    loanDomain: 'loan accounts',
    repaymentDomain: 'repayment history',
    loanResource: 'loan_accounts',
    repaymentResource: 'repayment_history',
    readAt: '2026-07-23T00:00:00.000Z',
    loanRows: [
      {
        loan_id: 'loan_early', borrower_id: 'borrower_1', borrower_name: 'Asha Rao',
        product: 'Personal loan', principal_outstanding_inr: 180000, installment_due_inr: 12500,
        days_past_due: 12, collector_owner: 'North collections', branch: 'Delhi', status: 'active',
      },
      {
        loan_id: 'loan_late', borrower_id: 'borrower_2', borrower_name: 'Kabir Shah',
        product: 'Auto loan', principal_outstanding_inr: 620000, installment_due_inr: 24000,
        days_past_due: 67, collector_owner: 'West collections', branch: 'Mumbai', status: 'delinquent',
      },
    ],
    repaymentRows: [
      { payment_id: 'pay_1', loan_id: 'loan_early', amount_due_inr: 12500, amount_paid_inr: 5000 },
      { payment_id: 'pay_2', loan_id: 'loan_late', amount_due_inr: 24000, amount_paid_inr: 0 },
      { payment_id: 'pay_3', loan_id: 'loan_late', amount_due_inr: 24000, amount_paid_inr: 8000 },
    ],
  };
}

test('live CoreBank rows become a priority-ordered, cited early-delinquency queue', () => {
  const cases = assembleLendingDelinquencyCases(snapshot());
  assert.deepEqual(cases.map((item) => item.loanId), ['loan_late', 'loan_early']);
  assert.equal(cases[0].recommendation.treatment, 'senior-collector-call');
  assert.equal(cases[0].arrearsInr, 40_000);
  assert.equal(cases[0].repaymentEvidenceCount, 2);
  assert.deepEqual(cases[0].recommendation.citations.map((item) => item.source), [
    'loan accounts', 'repayment history',
  ]);
  assert.deepEqual(validateDelinquencyCase(cases[0]), []);
  assert.deepEqual(delinquencyEvidenceState(cases[0]), {
    phase: 'needs-intervention',
    complete: false,
    missing: ['prepared intervention', 'collector decision'],
  });
});

test('missing, inferred, out-of-band or repayment-free DPD is never promoted into a case', () => {
  const input = snapshot();
  input.loanRows = [
    { ...input.loanRows[0], loan_id: 'missing', days_past_due: undefined, status: 'delinquent' },
    { ...input.loanRows[0], loan_id: 'current', days_past_due: 0 },
    { ...input.loanRows[0], loan_id: 'npa', days_past_due: 90 },
    { ...input.loanRows[0], loan_id: 'fraction', days_past_due: 12.5 },
    { ...input.loanRows[0], loan_id: 'closed', status: 'closed' },
    { ...input.loanRows[0], loan_id: 'no_history' },
  ];
  input.repaymentRows = [
    { payment_id: 'pay_missing', loan_id: 'missing', amount_due_inr: 10, amount_paid_inr: 0 },
    { payment_id: 'pay_current', loan_id: 'current', amount_due_inr: 10, amount_paid_inr: 0 },
    { payment_id: 'pay_npa', loan_id: 'npa', amount_due_inr: 10, amount_paid_inr: 0 },
    { payment_id: 'pay_fraction', loan_id: 'fraction', amount_due_inr: 10, amount_paid_inr: 0 },
    { payment_id: 'pay_closed', loan_id: 'closed', amount_due_inr: 10, amount_paid_inr: 0 },
  ];
  assert.deepEqual(assembleLendingDelinquencyCases(input), []);
});
