import type { AppSpecSeed } from '@/lib/tour-demo-seed';
import { BANK_APPS, INSURER_APPS } from '@/lib/tour-demo-seed';
import type { SolutionBlueprintInput } from '@/lib/solution-blueprints';

export interface SeededSolutionBlueprint {
  key: string;
  input: SolutionBlueprintInput;
}

function templateByKey(templates: readonly AppSpecSeed[], key: string): AppSpecSeed {
  const template = templates.find((candidate) => candidate.key === key);
  if (!template) throw new Error(`unknown app template: ${key}`);
  return template;
}

function requirementsFrom(template: AppSpecSeed): Pick<
  SolutionBlueprintInput,
  'requiredDataDomains' | 'requiredTools' | 'governedPipeline' | 'sourceTemplateKey'
> {
  const requiredDataDomains = Array.from(
    new Set(template.steps.flatMap((step) => (step.domain ? [step.domain] : []))),
  );
  const requiredTools = Array.from(
    new Set(
      template.steps.flatMap((step) => {
        if (step.kind === 'human') return ['human approval'];
        if (step.kind === 'output') return [`${step.sink ?? 'report'} output`];
        if (step.kind === 'agent') return ['grounded inference'];
        return [];
      }),
    ),
  );
  return {
    requiredDataDomains,
    requiredTools,
    governedPipeline: template.pipelineName,
    sourceTemplateKey: template.key,
  };
}

function fromTemplate(
  key: string,
  template: AppSpecSeed,
  business: Omit<SolutionBlueprintInput, keyof ReturnType<typeof requirementsFrom>>,
): SeededSolutionBlueprint {
  return { key, input: { ...business, ...requirementsFrom(template) } };
}

const delinquencyTemplate = templateByKey(BANK_APPS, 'loan-underwriting');
const indemnityTemplate = templateByKey(INSURER_APPS, 'claims-triage');

export const SEEDED_SOLUTION_BLUEPRINTS: readonly SeededSolutionBlueprint[] = [
  fromTemplate('lending-delinquency-intervention', delinquencyTemplate, {
    title: 'Delinquency Intervention',
    summary:
      'Prioritise borrowers before they roll into later delinquency buckets, with governed outreach and human approval.',
    industry: 'Lending',
    process: 'Collections · early delinquency',
    businessOwner: 'Head of Collections',
    outcome: {
      metricName: '30+ DPD rate',
      metricUnit: '% of active accounts',
      direction: 'decrease',
      measurementWindow: '90-day portfolio cohort',
      baseline: { value: 12, label: 'Current 30+ DPD rate' },
      target: { value: 9, label: 'Target 30+ DPD rate' },
      measured: null,
      roi: {
        currency: 'USD',
        annualBenefit: 800_000,
        implementationCost: 120_000,
        annualOperatingCost: 80_000,
        rationale: 'Avoided credit loss and more collector capacity from earlier prioritisation.',
      },
    },
    proof: {
      version: '2.1',
      provenDeployments: 4,
      summary: 'Benchmark pattern validated across four retail-lending portfolios.',
      evidenceLinks: ['/governance/evidence'],
    },
  }),
  fromTemplate('insurance-indemnity-fast-track', indemnityTemplate, {
    title: 'Indemnity Claim Fast Track',
    summary:
      'Cross-check claim documents, policy and risk signals so genuine indemnity claims move faster without weakening review.',
    industry: 'Insurance',
    process: 'Claims · indemnity assessment',
    businessOwner: 'Chief Claims Officer',
    outcome: {
      metricName: 'Claims processed per day',
      metricUnit: 'claims/day',
      direction: 'increase',
      measurementWindow: '30-day production average',
      baseline: { value: 500, label: 'Current manual throughput' },
      target: { value: 5000, label: 'Target governed throughput' },
      measured: null,
      roi: {
        currency: 'USD',
        annualBenefit: 1_500_000,
        implementationCost: 180_000,
        annualOperatingCost: 120_000,
        rationale: 'Tenfold capacity with the same claims workforce and shorter settlement time.',
      },
    },
    proof: {
      version: '3.0',
      provenDeployments: 6,
      summary: 'Claims assessment controls reused across six insurer deployments.',
      evidenceLinks: ['/governance/evidence'],
    },
  }),
] as const;
