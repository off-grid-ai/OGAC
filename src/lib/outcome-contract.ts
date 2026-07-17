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
  annualNetBenefit: number;
  roiMultiple: number | null;
  paybackMonths: number | null;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function validateOutcomeContract(contract: OutcomeContract): string[] {
  const errors: string[] = [];
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

  const annualNetBenefit = round2(contract.roi.annualBenefit - contract.roi.annualOperatingCost);
  const firstYearCost = contract.roi.implementationCost + contract.roi.annualOperatingCost;
  const roiMultiple = firstYearCost > 0 ? round2(contract.roi.annualBenefit / firstYearCost) : null;
  const monthlyNetBenefit = annualNetBenefit / 12;
  const paybackMonths =
    contract.roi.implementationCost > 0 && monthlyNetBenefit > 0
      ? round2(contract.roi.implementationCost / monthlyNetBenefit)
      : contract.roi.implementationCost === 0 && annualNetBenefit > 0
        ? 0
        : null;

  return { targetChangePct, measuredProgressPct, annualNetBenefit, roiMultiple, paybackMonths };
}
