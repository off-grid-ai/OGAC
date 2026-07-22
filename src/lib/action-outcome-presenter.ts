import {
  effectiveActionOutcomes,
  type ActionOutcomeCode,
  type ActionOutcomeRecord,
} from '@/lib/action-outcome-contract';

export interface ActionOutcomeCopy {
  label: string;
  detail: string;
}

export interface PresentedActionOutcome {
  record: ActionOutcomeRecord;
  label: string;
  detail: string;
  stateLabel: 'Current' | 'Corrected' | 'Withdrawn';
  canCorrect: boolean;
  canWithdraw: boolean;
}

export interface ActionOutcomePresentation {
  current: ActionOutcomeRecord | null;
  currentCopy: ActionOutcomeCopy | null;
  history: PresentedActionOutcome[];
  nextAction:
    | { kind: 'record-result'; label: 'Record customer result' }
    | { kind: 'record-conversion'; label: 'Record conversion' }
    | null;
}

const OUTCOME_COPY: Record<ActionOutcomeCode, ActionOutcomeCopy> = {
  accepted: {
    label: 'Customer accepted',
    detail: 'Customer accepted the recommendation. Conversion has not been confirmed.',
  },
  rejected: {
    label: 'Customer declined',
    detail: 'Customer declined the recommendation.',
  },
  converted: {
    label: 'Customer converted',
    detail: 'Customer converted. This is the confirmed business result.',
  },
  cured: {
    label: 'Account cured',
    detail: 'The account returned to the agreed repayment position.',
  },
  settled: {
    label: 'Claim settled',
    detail: 'The claim reached a recorded settlement.',
  },
};

export function actionOutcomeCopy(code: ActionOutcomeCode): ActionOutcomeCopy {
  return OUTCOME_COPY[code];
}

function newest(records: ActionOutcomeRecord[]): ActionOutcomeRecord | null {
  return (
    [...records].sort((a, b) => {
      const observed = Date.parse(b.observedAt) - Date.parse(a.observedAt);
      return observed || Date.parse(b.recordedAt) - Date.parse(a.recordedAt);
    })[0] ?? null
  );
}

export function presentActionOutcomes(records: ActionOutcomeRecord[]): ActionOutcomePresentation {
  const effective = effectiveActionOutcomes(records);
  const current = newest(effective);
  const supersededIds = new Set(
    records.map((record) => record.supersedesId).filter((id): id is string => Boolean(id)),
  );
  const history = [...records]
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))
    .map((record): PresentedActionOutcome => {
      const withdrawn = record.kind === 'withdrawn';
      const superseded = supersededIds.has(record.id);
      const active = !withdrawn && !superseded;
      const copy = record.outcomeCode ? actionOutcomeCopy(record.outcomeCode) : null;
      return {
        record,
        label: withdrawn ? 'Record withdrawn' : (copy?.label ?? 'Business result'),
        detail: withdrawn ? record.note : (copy?.detail ?? record.note),
        stateLabel: withdrawn ? 'Withdrawn' : superseded ? 'Corrected' : 'Current',
        canCorrect: active,
        canWithdraw: active,
      };
    });
  let nextAction: ActionOutcomePresentation['nextAction'] = null;
  if (!current) nextAction = { kind: 'record-result', label: 'Record customer result' };
  else if (
    current.outcomeCode === 'accepted' &&
    !effective.some((record) => record.outcomeCode === 'converted')
  ) {
    nextAction = { kind: 'record-conversion', label: 'Record conversion' };
  }
  return {
    current,
    currentCopy: current?.outcomeCode ? actionOutcomeCopy(current.outcomeCode) : null,
    history,
    nextAction,
  };
}

