import type {
  DelinquencyCaseView,
  DelinquencyRecommendation,
} from '@/lib/lending-delinquency-contract';

export interface LendingDelinquencySourceSnapshot {
  loanDomain: string;
  repaymentDomain: string;
  loanResource: string;
  repaymentResource: string;
  readAt: string;
  loanRows: Record<string, unknown>[];
  repaymentRows: Record<string, unknown>[];
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function money(row: Record<string, unknown>, key: string): number | null {
  const value = Number(row[key]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function exactDpd(row: Record<string, unknown>): number | null {
  const value = Number(row.days_past_due);
  return Number.isInteger(value) && value >= 1 && value <= 89 ? value : null;
}

function repaymentArrears(rows: Record<string, unknown>[]): number {
  return rows.reduce((total, row) => {
    const due = money(row, 'amount_due_inr') ?? 0;
    const paid = money(row, 'amount_paid_inr') ?? 0;
    return total + Math.max(0, due - paid);
  }, 0);
}

function treatmentFor(daysPastDue: number): DelinquencyRecommendation['treatment'] {
  if (daysPastDue <= 29) return 'payment-reminder';
  if (daysPastDue <= 59) return 'hardship-call';
  return 'senior-collector-call';
}

function treatmentLabel(treatment: DelinquencyRecommendation['treatment']): string {
  if (treatment === 'payment-reminder') return 'confirm payment timing and send a reminder';
  if (treatment === 'hardship-call') return 'make a hardship-assessment call';
  return 'route a senior-collector call before the account reaches 90 DPD';
}

/**
 * Produce only evidence-complete early-delinquency cases. DPD is read exclusively from the
 * persisted `days_past_due` field; missing or out-of-band values are never inferred from status,
 * balance, dates or repayment amounts.
 */
export function assembleLendingDelinquencyCases(
  snapshot: LendingDelinquencySourceSnapshot,
): DelinquencyCaseView[] {
  const repaymentsByLoan = new Map<string, Record<string, unknown>[]>();
  for (const row of snapshot.repaymentRows) {
    const loanId = text(row, 'loan_id');
    if (!loanId) continue;
    repaymentsByLoan.set(loanId, [...(repaymentsByLoan.get(loanId) ?? []), row]);
  }

  return snapshot.loanRows
    .flatMap((row): DelinquencyCaseView[] => {
      const loanId = text(row, 'loan_id');
      const borrowerId = text(row, 'borrower_id');
      const borrowerName = text(row, 'borrower_name');
      const daysPastDue = exactDpd(row);
      const principal = money(row, 'principal_outstanding_inr');
      const installment = money(row, 'installment_due_inr');
      const status = text(row, 'status').toLowerCase();
      const repayments = repaymentsByLoan.get(loanId) ?? [];
      if (
        !loanId ||
        !borrowerId ||
        !borrowerName ||
        daysPastDue === null ||
        principal === null ||
        principal <= 0 ||
        installment === null ||
        repayments.length === 0 ||
        ['closed', 'cured', 'settled'].includes(status)
      ) {
        return [];
      }
      const treatment = treatmentFor(daysPastDue);
      const arrearsInr = repaymentArrears(repayments);
      const latestRepaymentId =
        repayments.map((payment) => text(payment, 'payment_id')).filter(Boolean).at(-1) ?? loanId;
      return [
        {
          loanId,
          borrowerId,
          borrowerName,
          product: text(row, 'product') || 'Loan product not recorded',
          branch: text(row, 'branch') || 'Branch not recorded',
          collectorOwner: text(row, 'collector_owner') || 'Unassigned',
          principalOutstandingInr: principal,
          installmentDueInr: installment,
          daysPastDue,
          repaymentEvidenceCount: repayments.length,
          arrearsInr,
          source: {
            kind: 'live',
            loanDomain: snapshot.loanDomain,
            repaymentDomain: snapshot.repaymentDomain,
            readAt: snapshot.readAt,
          },
          recommendation: {
            treatment,
            summary: `${daysPastDue} DPD is recorded in CoreBank with INR ${arrearsInr.toLocaleString('en-IN')} unpaid across ${repayments.length} repayment record${repayments.length === 1 ? '' : 's'}. ${treatmentLabel(treatment)}.`,
            priorityScore: daysPastDue * 1_000_000 + Math.min(principal, 999_999),
            citations: [
              {
                source: snapshot.loanDomain,
                record: `${snapshot.loanResource}/${loanId}`,
                label: 'Live loan account and exact DPD',
              },
              {
                source: snapshot.repaymentDomain,
                record: `${snapshot.repaymentResource}/${latestRepaymentId}`,
                label: 'Live repayment evidence',
              },
            ],
          },
          runId: null,
          collectorDecision: { status: 'pending', reason: null, reviewer: null, decidedAt: null },
          actionReceipt: null,
          outcomes: [],
        },
      ];
    })
    .sort(
      (left, right) =>
        right.recommendation.priorityScore - left.recommendation.priorityScore ||
        left.loanId.localeCompare(right.loanId),
    );
}

