import type { SolutionBlueprintInput } from '@/lib/solution-blueprints';

export const SOLUTION_BLUEPRINT_CATALOG_VERSION = 1;

export interface SeededSolutionBlueprint {
  key: string;
  input: SolutionBlueprintInput;
}

/**
 * Starter contracts, not fabricated customer proof. These stay explicitly unverified until an
 * operator attaches auditable benchmark evidence. Dedicated template/pipeline names prevent an
 * unrelated underwriting or fraud workflow from masquerading as the advertised use case.
 */
export const SEEDED_SOLUTION_BLUEPRINTS: readonly SeededSolutionBlueprint[] = [
  {
    key: 'lending-delinquency-intervention',
    input: {
      title: 'Delinquency Intervention',
      summary:
        'Prioritise borrowers before they roll into later delinquency buckets, with governed outreach and human approval.',
      industry: 'Lending',
      process: 'Collections · early delinquency',
      businessOwner: 'Head of Collections',
      requiredDataDomains: ['loan accounts', 'repayment history'],
      requiredCapabilities: ['grounded-inference', 'human-approval', 'report-output'],
      requiredPipelineName: 'Collections intervention',
      sourceTemplateKey: 'delinquency-intervention',
      outcome: {
        metricName: '30+ DPD rate',
        metricUnit: '% of active accounts',
        direction: 'decrease',
        measurementWindow: '90-day portfolio cohort',
        baseline: { value: 12, label: 'Example baseline — replace before adoption' },
        target: { value: 9, label: 'Example target — approve before adoption' },
        measured: null,
        roi: {
          currency: 'USD',
          annualBenefit: 0,
          implementationCost: 0,
          annualOperatingCost: 0,
          rationale: 'Enter the institution-specific avoided-loss hypothesis before adoption.',
        },
      },
      proof: { status: 'unverified', summary: '', evidenceLinks: [] },
    },
  },
  {
    key: 'insurance-indemnity-fast-track',
    input: {
      title: 'Indemnity Claim Fast Track',
      summary:
        'Cross-check claim documents, policy and risk signals so eligible indemnity claims move faster without weakening review.',
      industry: 'Insurance',
      process: 'Claims · indemnity assessment',
      businessOwner: 'Chief Claims Officer',
      requiredDataDomains: ['claim documents', 'policies'],
      requiredCapabilities: ['grounded-inference', 'human-approval', 'report-output'],
      requiredPipelineName: 'Indemnity claims',
      sourceTemplateKey: 'indemnity-fast-track',
      outcome: {
        metricName: 'Claims processed per day',
        metricUnit: 'claims/day',
        direction: 'increase',
        measurementWindow: '30-day production average',
        baseline: { value: 500, label: 'Example baseline — replace before adoption' },
        target: { value: 5000, label: 'Example target — approve before adoption' },
        measured: null,
        roi: {
          currency: 'USD',
          annualBenefit: 0,
          implementationCost: 0,
          annualOperatingCost: 0,
          rationale:
            'Enter the insurer-specific capacity and settlement hypothesis before adoption.',
        },
      },
      proof: { status: 'unverified', summary: '', evidenceLinks: [] },
    },
  },
] as const;
