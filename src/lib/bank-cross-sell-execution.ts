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
  const approvalIndex = app.steps.findIndex((step) => step.kind === 'human');
  if (approvalIndex < 0) throw new Error('Cross-sell App requires a relationship-manager review');
  const withoutPriorAction = app.steps.filter(
    (step) => step.id !== 'cross-sell-writeback' && step.kind !== 'action',
  );
  const humanIndex = withoutPriorAction.findIndex((step) => step.kind === 'human');
  const approval = withoutPriorAction[humanIndex];
  const steps = [
    ...withoutPriorAction.slice(0, humanIndex + 1),
    actionStepFor(opportunity, connectorId, approval.id),
    ...withoutPriorAction.slice(humanIndex + 1),
  ];
  return {
    ...app,
    steps,
    edges: steps.slice(1).map((step, index) => ({ from: steps[index].id, to: step.id })),
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
