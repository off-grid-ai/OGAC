import { effectiveActionOutcomes, type ActionOutcomeRecord } from '@/lib/action-outcome-contract';
import type { AppSpec, AppStep } from '@/lib/app-model';
import type { AppRunView } from '@/lib/app-runs-view';
import {
  crossSellEvidenceState,
  type CrossSellEvidenceState,
  type CrossSellObservedResult,
  type CrossSellOpportunityView,
} from '@/lib/bank-cross-sell-contract';

export interface BankCrossSellOpportunityEvidence {
  opportunity: CrossSellOpportunityView;
  evidence: CrossSellEvidenceState;
}

function actionStepFor(
  opportunity: CrossSellOpportunityView,
  connectorId: string,
  approvalStepId: string,
): AppStep {
  return {
    id: 'cross-sell-writeback',
    label: 'Create the approved CRM follow-up',
    kind: 'action',
    actionId: 'crm.create-task',
    connectorId,
    approvalStepId,
    command: {
      operation: 'create-task',
      subject: `Discuss the approved ${opportunity.recommendation?.product ?? 'next-best offer'}`,
      useCase: 'bank-cross-sell',
      kind: 'call',
      accountId: opportunity.customerId,
      ...(opportunity.relationshipManager !== 'Unassigned'
        ? { assignee: opportunity.relationshipManager }
        : {}),
    },
  };
}

/** Add the bounded CRM task to this run only; App/run/action stores remain the canonical owners. */
export function buildBankCrossSellRuntimeSpec(
  app: AppSpec,
  opportunity: CrossSellOpportunityView,
  connectorId: string,
): AppSpec {
  const recommendation = opportunity.recommendation;
  if (
    !recommendation?.eligible ||
    recommendation.constraints.length > 0 ||
    recommendation.citations.length === 0
  ) {
    throw new Error('Cross-sell recommendation is not eligible for governed action');
  }
  const approvals = app.steps.filter((step) => step.kind === 'human');
  if (approvals.length !== 1) {
    throw new Error('Cross-sell App requires exactly one relationship-manager review');
  }
  const approval = approvals[0];
  const action = actionStepFor(opportunity, connectorId, approval.id);
  const existingIndex = app.steps.findIndex((step) => step.id === action.id);
  if (existingIndex >= 0) {
    const incoming = app.edges.filter((edge) => edge.to === action.id);
    if (incoming.length !== 1 || incoming[0].from !== approval.id) {
      throw new Error('Cross-sell action is not attached to the approved review seam');
    }
    return {
      ...app,
      steps: app.steps.map((step, index) => (index === existingIndex ? action : step)),
      edges: app.edges.map((edge) => ({ ...edge })),
    };
  }
  const outgoing = app.edges.filter((edge) => edge.from === approval.id);
  if (outgoing.length !== 1) {
    throw new Error('Cross-sell review must have one supported successor');
  }
  const successor = outgoing[0].to;
  const approvalIndex = app.steps.findIndex((step) => step.id === approval.id);
  const steps = [
    ...app.steps.slice(0, approvalIndex + 1),
    action,
    ...app.steps.slice(approvalIndex + 1),
  ];
  const edges = app.edges.flatMap((edge) =>
    edge === outgoing[0]
      ? [
          { ...edge, to: action.id },
          { from: action.id, to: successor },
        ]
      : [{ ...edge }],
  );
  return {
    ...app,
    steps,
    edges,
  };
}

function resultFrom(record: ActionOutcomeRecord): CrossSellObservedResult | null {
  const status = record.outcomeCode;
  if (status !== 'accepted' && status !== 'rejected' && status !== 'converted') return null;
  const unit = record.measurement?.metricUnit.trim().toUpperCase() ?? '';
  const monetary = /^[A-Z]{3}$/.test(unit);
  return {
    status,
    observedAt: record.observedAt,
    value: monetary ? (record.measurement?.resultValue ?? null) : null,
    currency: monetary ? unit : null,
    evidenceHref: record.evidenceLinks[0] ?? '',
  };
}

/** Project canonical run, decision, receipt, and outcome records onto the frozen reference view. */
export function projectBankCrossSellEvidence(
  opportunity: CrossSellOpportunityView,
  run: AppRunView | null,
  outcomes: ActionOutcomeRecord[] = [],
): BankCrossSellOpportunityEvidence {
  if (!run) {
    const view = { ...opportunity, runId: null };
    return { opportunity: view, evidence: crossSellEvidenceState(view) };
  }
  const human = run.steps.find((step) => step.kind === 'human');
  const action = run.steps.find((step) => step.kind === 'action' && step.actionReceipt);
  const rejected = human?.status === 'error' || /\brejected\b/i.test(human?.detail ?? '');
  const accepted = human?.status === 'done' && /\bapproved\b/i.test(human.detail ?? '');
  const rmDecision = rejected
    ? {
        status: 'rejected' as const,
        reason: human?.detail ?? 'Rejected by the relationship manager.',
        reviewer: human?.reviewer ?? 'Recorded reviewer',
        decidedAt: human?.finishedAt ?? run.finishedAt ?? run.startedAt,
      }
    : accepted
      ? {
          status: 'accepted' as const,
          reason: human?.detail ?? 'Approved by the relationship manager.',
          reviewer: human?.reviewer ?? 'Recorded reviewer',
          decidedAt: human?.finishedAt ?? run.finishedAt ?? run.startedAt,
        }
      : { status: 'pending' as const, reason: null, reviewer: null, decidedAt: null };
  const observed = effectiveActionOutcomes(outcomes)
    .map(resultFrom)
    .filter((value): value is CrossSellObservedResult => Boolean(value));
  const view: CrossSellOpportunityView = {
    ...opportunity,
    runId: run.id,
    rmDecision,
    actionReceipt: action?.actionReceipt ?? null,
    outcomes: observed,
  };
  return { opportunity: view, evidence: crossSellEvidenceState(view) };
}
