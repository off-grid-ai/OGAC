import { computeInvestmentCase } from '@/lib/roi';

export type OutcomeDirection = 'increase' | 'decrease';

export interface KpiReading {
  value: number;
  label: string;
}

export interface RoiHypothesis {
  currency: string;
  annualBenefit: number;
  implementationCost: number;
  annualOperatingCost: number;
  rationale: string;
}

export interface OutcomeContract {
  metricName: string;
  metricUnit: string;
  direction: OutcomeDirection;
  measurementWindow: string;
  baseline: KpiReading;
  target: KpiReading;
  measured?: KpiReading | null;
  roi: RoiHypothesis;
}

export interface OutcomeSummary {
  targetChangePct: number | null;
  measuredProgressPct: number | null;
  firstYearNetValue: number;
  benefitCostMultiple: number | null;
  paybackMonths: number | null;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Render an outcome amount with its ISO-4217 currency. Keeping this pure formatter beside the
 * contract prevents pages from guessing symbols (for example, treating every tenant as USD).
 */
export function formatOutcomeCurrency(value: number, currency: string, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(value);
}

function isIsoCurrency(currency: string): boolean {
  if (!/^[A-Za-z]{3}$/.test(currency)) return false;
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency });
    return true;
  } catch {
    return false;
  }
}

export function validateOutcomeContract(contract: OutcomeContract): string[] {
  const errors: string[] = [];
  if (contract.direction !== 'increase' && contract.direction !== 'decrease') {
    errors.push('direction must be increase or decrease');
  }
  if (!contract.metricName.trim()) errors.push('metric name is required');
  if (!contract.metricUnit.trim()) errors.push('metric unit is required');
  if (!contract.measurementWindow.trim()) errors.push('measurement window is required');
  if (!contract.baseline.label.trim()) errors.push('baseline label is required');
  if (!contract.target.label.trim()) errors.push('target label is required');
  if (contract.measured && !contract.measured.label.trim())
    errors.push('measured label is required');

  const readings = [
    contract.baseline.value,
    contract.target.value,
    contract.measured?.value,
  ].filter((value): value is number => value !== undefined);
  if (readings.some((value) => !Number.isFinite(value))) errors.push('KPI values must be finite');

  const money = [
    contract.roi.annualBenefit,
    contract.roi.implementationCost,
    contract.roi.annualOperatingCost,
  ];
  if (money.some((value) => !Number.isFinite(value) || value < 0)) {
    errors.push('ROI amounts must be finite and non-negative');
  }
  if (!contract.roi.currency.trim()) errors.push('ROI currency is required');
  else if (!isIsoCurrency(contract.roi.currency)) errors.push('ROI currency must be an ISO code');
  if (!contract.roi.rationale.trim()) errors.push('ROI rationale is required');
  if (contract.direction === 'increase' && contract.target.value <= contract.baseline.value) {
    errors.push('an increase target must exceed its baseline');
  }
  if (contract.direction === 'decrease' && contract.target.value >= contract.baseline.value) {
    errors.push('a decrease target must be below its baseline');
  }
  return errors;
}

export function summarizeOutcome(contract: OutcomeContract): OutcomeSummary {
  const desiredDelta =
    contract.direction === 'increase'
      ? contract.target.value - contract.baseline.value
      : contract.baseline.value - contract.target.value;
  const targetChangePct =
    contract.baseline.value === 0
      ? null
      : round2((desiredDelta / Math.abs(contract.baseline.value)) * 100);

  let measuredProgressPct: number | null = null;
  if (contract.measured && desiredDelta !== 0) {
    const measuredDelta =
      contract.direction === 'increase'
        ? contract.measured.value - contract.baseline.value
        : contract.baseline.value - contract.measured.value;
    measuredProgressPct = round2((measuredDelta / desiredDelta) * 100);
  }

  const investment = computeInvestmentCase(contract.roi);
  return { targetChangePct, measuredProgressPct, ...investment };
}
