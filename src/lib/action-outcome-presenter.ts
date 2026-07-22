import {
  effectiveActionOutcomes,
  type ActionOutcomeCode,
  type ActionOutcomeMeasurement,
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

export interface PresentedOutcomeMeasurement {
  metricName: string;
  baselineValue: string;
  resultValue: string;
  changeValue: string;
  changeDetail: string | null;
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

export function presentOutcomeMeasurement(
  measurement: ActionOutcomeMeasurement,
): PresentedOutcomeMeasurement {
  const resultValue = formatMeasurementValue(measurement.resultValue, measurement.metricUnit);
  if (measurement.baselineValue === undefined) {
    return {
      metricName: measurement.metricName,
      baselineValue: 'Not recorded',
      resultValue,
      changeValue: 'Not available',
      changeDetail: 'Add a baseline to calculate the change.',
    };
  }

  const delta = measurement.resultValue - measurement.baselineValue;
  const changeValue = formatSignedMeasurementValue(delta, measurement.metricUnit);
  if (measurement.baselineValue === 0) {
    return {
      metricName: measurement.metricName,
      baselineValue: formatMeasurementValue(0, measurement.metricUnit),
      resultValue,
      changeValue,
      changeDetail: 'Percentage change is not available from a zero baseline.',
    };
  }

  const percentage = (delta / Math.abs(measurement.baselineValue)) * 100;
  return {
    metricName: measurement.metricName,
    baselineValue: formatMeasurementValue(measurement.baselineValue, measurement.metricUnit),
    resultValue,
    changeValue,
    changeDetail: `${formatSignedNumber(percentage)}% from baseline`,
  };
}

function formatMeasurementValue(value: number, unit: string): string {
  return `${formatNumber(value)} ${unit}`;
}

function formatSignedMeasurementValue(value: number, unit: string): string {
  return `${formatSignedNumber(value)} ${unit}`;
}

function formatSignedNumber(value: number): string {
  return `${value > 0 ? '+' : ''}${formatNumber(value)}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
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
  const successorKindById = new Map(
    records
      .filter(
        (record): record is ActionOutcomeRecord & { supersedesId: string } =>
          Boolean(record.supersedesId),
      )
      .map((record) => [record.supersedesId, record.kind]),
  );
  const history = [...records]
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))
    .map((record): PresentedActionOutcome => {
      const withdrawn = record.kind === 'withdrawn';
      const successorKind = successorKindById.get(record.id);
      const active = !withdrawn && !successorKind;
      const copy = record.outcomeCode ? actionOutcomeCopy(record.outcomeCode) : null;
      return {
        record,
        label: withdrawn ? 'Record withdrawn' : (copy?.label ?? 'Business result'),
        detail: withdrawn ? record.note : (copy?.detail ?? record.note),
        stateLabel:
          withdrawn || successorKind === 'withdrawn'
            ? 'Withdrawn'
            : successorKind === 'corrected'
              ? 'Corrected'
              : 'Current',
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
