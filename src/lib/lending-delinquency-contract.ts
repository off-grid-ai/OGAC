import type { ActionReceipt } from '@/lib/action-contract';

export type DelinquencyJourneyPhase =
  | 'needs-context'
  | 'needs-intervention'
  | 'needs-collector-decision'
  | 'needs-writeback'
  | 'needs-outcome'
  | 'measured';

export interface DelinquencyCitation {
  source: string;
  record: string;
  label: string;
}

export interface DelinquencyRecommendation {
  treatment: 'payment-reminder' | 'hardship-call' | 'senior-collector-call';
  summary: string;
  priorityScore: number;
  citations: DelinquencyCitation[];
}

export interface DelinquencyDecision {
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  reviewer: string | null;
  decidedAt: string | null;
}

export interface DelinquencyObservedResult {
  status: 'cured' | 'settled';
  observedAt: string;
  resultingDaysPastDue: number | null;
  evidenceHref: string;
}

export interface DelinquencyCaseView {
  loanId: string;
  borrowerId: string;
  borrowerName: string;
  product: string;
  branch: string;
  collectorOwner: string;
  principalOutstandingInr: number;
  installmentDueInr: number;
  daysPastDue: number;
  repaymentEvidenceCount: number;
  arrearsInr: number;
  source: {
    kind: 'live';
    loanDomain: string;
    repaymentDomain: string;
    readAt: string;
  };
  recommendation: DelinquencyRecommendation;
  runId: string | null;
  collectorDecision: DelinquencyDecision;
  actionReceipt: ActionReceipt | null;
  outcomes: DelinquencyObservedResult[];
}

export interface DelinquencyEvidenceState {
  phase: DelinquencyJourneyPhase;
  complete: boolean;
  missing: string[];
}

function validDate(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

/** The fail-closed view contract shared by the queue, detail page and release evidence. */
export function validateDelinquencyCase(view: DelinquencyCaseView): string[] {
  const errors: string[] = [];
  for (const [label, value] of [
    ['loan id', view.loanId],
    ['borrower id', view.borrowerId],
    ['borrower name', view.borrowerName],
    ['product', view.product],
    ['branch', view.branch],
    ['collector owner', view.collectorOwner],
    ['loan domain', view.source.loanDomain],
    ['repayment domain', view.source.repaymentDomain],
  ] as const) {
    if (!value.trim()) errors.push(`${label} is required`);
  }
  if (!Number.isInteger(view.daysPastDue) || view.daysPastDue < 1 || view.daysPastDue > 89) {
    errors.push('days past due must be an integer from 1 to 89');
  }
  for (const [label, value] of [
    ['principal outstanding', view.principalOutstandingInr],
    ['installment due', view.installmentDueInr],
    ['arrears', view.arrearsInr],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) errors.push(`${label} must be non-negative`);
  }
  if (!Number.isInteger(view.repaymentEvidenceCount) || view.repaymentEvidenceCount < 1) {
    errors.push('at least one repayment evidence row is required');
  }
  if (!validDate(view.source.readAt)) errors.push('source read time must be valid');
  if (!Number.isFinite(view.recommendation.priorityScore)) {
    errors.push('priority score must be finite');
  }
  if (view.recommendation.citations.length < 2) {
    errors.push('loan and repayment citations are required');
  }
  if (view.collectorDecision.status === 'pending') {
    if (
      view.collectorDecision.reason ||
      view.collectorDecision.reviewer ||
      view.collectorDecision.decidedAt
    ) {
      errors.push('a pending collector decision cannot contain decision evidence');
    }
  } else if (
    !view.collectorDecision.reason?.trim() ||
    !view.collectorDecision.reviewer?.trim() ||
    !validDate(view.collectorDecision.decidedAt ?? '')
  ) {
    errors.push('a collector decision requires reason, reviewer and time');
  }
  if (view.actionReceipt && view.collectorDecision.status !== 'approved') {
    errors.push('CRM follow-up requires an approved collector decision');
  }
  if (view.outcomes.length && !view.actionReceipt) {
    errors.push('cure or settlement requires a governed action receipt');
  }
  return errors;
}

export function delinquencyEvidenceState(view: DelinquencyCaseView): DelinquencyEvidenceState {
  const missing: string[] = [];
  if (!view.source.loanDomain || !view.source.repaymentDomain) missing.push('live CoreBank evidence');
  if (!view.runId) missing.push('prepared intervention');
  if (view.collectorDecision.status === 'pending') missing.push('collector decision');
  if (view.collectorDecision.status === 'approved' && !view.actionReceipt) {
    missing.push('governed CRM follow-up receipt');
  }
  if (
    view.collectorDecision.status === 'approved' &&
    view.actionReceipt &&
    view.outcomes.length === 0
  ) {
    missing.push('receipt-correlated cure or settlement');
  }
  const phase: DelinquencyJourneyPhase =
    !view.source.loanDomain || !view.source.repaymentDomain
      ? 'needs-context'
      : !view.runId
        ? 'needs-intervention'
        : view.collectorDecision.status === 'pending'
          ? 'needs-collector-decision'
          : view.collectorDecision.status === 'approved' && !view.actionReceipt
            ? 'needs-writeback'
            : view.collectorDecision.status === 'approved' && view.outcomes.length === 0
              ? 'needs-outcome'
              : 'measured';
  return { phase, complete: missing.length === 0, missing };
}

