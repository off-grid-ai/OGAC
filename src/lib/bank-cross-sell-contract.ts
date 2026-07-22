import type { ActionReceipt } from '@/lib/action-contract';

/**
 * Shared product boundary for the Bank RM Cross-sell reference solution.
 *
 * This is a projection over the existing App, Governed Action, Outcome Observation, enterprise
 * context, and Solution Deployment planes. It is deliberately not another runtime or persistence
 * model. Adapters assemble this view from those canonical owners; the RM experience only renders it
 * and sends intent back through their existing routes.
 */
export type CrossSellJourneyPhase =
  | 'needs-context'
  | 'needs-recommendation'
  | 'needs-rm-decision'
  | 'needs-writeback'
  | 'needs-outcome'
  | 'measured';

export type RmDecisionStatus = 'pending' | 'accepted' | 'rejected';

export interface CrossSellCitation {
  source: string;
  record: string;
  label: string;
}

export interface CrossSellRecommendation {
  product: string;
  rationale: string;
  confidence: number;
  eligible: boolean;
  constraints: string[];
  citations: CrossSellCitation[];
}

export interface CrossSellRmDecision {
  status: RmDecisionStatus;
  reason: string | null;
  reviewer: string | null;
  decidedAt: string | null;
}

export interface CrossSellObservedResult {
  status: 'accepted' | 'rejected' | 'converted' | 'withdrawn';
  observedAt: string;
  value: number | null;
  currency: string | null;
  evidenceHref: string;
}

export interface CrossSellOpportunityView {
  opportunityId: string;
  customerId: string;
  customerName: string;
  relationshipManager: string;
  segment: string;
  region: string;
  currentProducts: string[];
  opportunityValueInr: number;
  /** Only live, tenant-scoped connector evidence may populate the reference solution. */
  source: {
    kind: 'live';
    customerDomain: string;
    eligibilityDomain: string;
    readAt: string;
  };
  recommendation: CrossSellRecommendation | null;
  runId: string | null;
  rmDecision: CrossSellRmDecision;
  actionReceipt: ActionReceipt | null;
  outcomes: CrossSellObservedResult[];
}

export interface CrossSellEvidenceState {
  phase: CrossSellJourneyPhase;
  complete: boolean;
  missing: string[];
}

function present(value: string): boolean {
  return value.trim().length > 0;
}

function validDate(value: string): boolean {
  return present(value) && Number.isFinite(new Date(value).valueOf());
}

export function validateCrossSellOpportunity(view: CrossSellOpportunityView): string[] {
  const errors: string[] = [];
  for (const [label, value] of [
    ['opportunity id', view.opportunityId],
    ['customer id', view.customerId],
    ['customer name', view.customerName],
    ['relationship manager', view.relationshipManager],
    ['segment', view.segment],
    ['region', view.region],
    ['customer domain', view.source.customerDomain],
    ['eligibility domain', view.source.eligibilityDomain],
  ] as const) {
    if (!present(value)) errors.push(`${label} is required`);
  }
  if (!Number.isFinite(view.opportunityValueInr) || view.opportunityValueInr < 0) {
    errors.push('opportunity value must be finite and non-negative');
  }
  if (!validDate(view.source.readAt)) errors.push('source read time must be a valid date');
  if (view.recommendation) {
    if (!present(view.recommendation.product)) errors.push('recommended product is required');
    if (!present(view.recommendation.rationale))
      errors.push('recommendation rationale is required');
    if (
      !Number.isFinite(view.recommendation.confidence) ||
      view.recommendation.confidence < 0 ||
      view.recommendation.confidence > 1
    ) {
      errors.push('recommendation confidence must be between 0 and 1');
    }
    if (view.recommendation.citations.length === 0) {
      errors.push('recommendation requires source citations');
    }
    for (const citation of view.recommendation.citations) {
      if (!present(citation.source) || !present(citation.record) || !present(citation.label)) {
        errors.push('recommendation citations require source, record, and label');
        break;
      }
    }
    if (view.recommendation.eligible && view.recommendation.constraints.length > 0) {
      errors.push('an eligible recommendation cannot retain blocking constraints');
    }
  }
  const decision = view.rmDecision;
  if (decision.status === 'pending') {
    if (decision.reason || decision.reviewer || decision.decidedAt) {
      errors.push('a pending RM decision cannot contain decision evidence');
    }
  } else {
    if (!present(decision.reason ?? '')) errors.push('RM decision reason is required');
    if (!present(decision.reviewer ?? '')) errors.push('RM decision reviewer is required');
    if (!validDate(decision.decidedAt ?? '')) errors.push('RM decision time must be a valid date');
  }
  if (view.actionReceipt && decision.status !== 'accepted') {
    errors.push('CRM write-back requires an accepted RM decision');
  }
  if (view.outcomes.length > 0 && !view.actionReceipt) {
    errors.push('business outcomes require a governed action receipt');
  }
  for (const outcome of view.outcomes) {
    if (!validDate(outcome.observedAt)) errors.push('outcome time must be a valid date');
    if (!present(outcome.evidenceHref)) errors.push('outcome evidence link is required');
    if (outcome.value !== null && (!Number.isFinite(outcome.value) || outcome.value < 0)) {
      errors.push('outcome value must be finite and non-negative');
    }
    if ((outcome.value === null) !== (outcome.currency === null)) {
      errors.push('outcome value and currency must be supplied together');
    }
  }
  return errors;
}

/** One ordered journey used by API, UI, verification, and capability evidence. */
export function crossSellEvidenceState(view: CrossSellOpportunityView): CrossSellEvidenceState {
  const missing: string[] = [];
  if (!view.source.customerDomain || !view.source.eligibilityDomain) {
    missing.push('live customer and eligibility context');
  }
  if (!view.recommendation || !view.runId) missing.push('cited governed recommendation');
  if (view.rmDecision.status === 'pending') missing.push('relationship manager decision');
  if (view.rmDecision.status === 'accepted' && !view.actionReceipt) {
    missing.push('governed CRM write-back receipt');
  }
  if (view.rmDecision.status === 'accepted' && view.actionReceipt && view.outcomes.length === 0) {
    missing.push('receipt-correlated customer outcome');
  }

  const phase: CrossSellJourneyPhase =
    !view.source.customerDomain || !view.source.eligibilityDomain
      ? 'needs-context'
      : !view.recommendation || !view.runId
        ? 'needs-recommendation'
        : view.rmDecision.status === 'pending'
          ? 'needs-rm-decision'
          : view.rmDecision.status === 'accepted' && !view.actionReceipt
            ? 'needs-writeback'
            : view.rmDecision.status === 'accepted' && view.outcomes.length === 0
              ? 'needs-outcome'
              : 'measured';
  return { phase, complete: missing.length === 0, missing };
}

export function canAcceptCrossSellRecommendation(view: CrossSellOpportunityView): boolean {
  return Boolean(
    view.runId &&
    view.recommendation?.eligible &&
    view.recommendation.citations.length > 0 &&
    view.recommendation.constraints.length === 0 &&
    view.rmDecision.status === 'pending',
  );
}
