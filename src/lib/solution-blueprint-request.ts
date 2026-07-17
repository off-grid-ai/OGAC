import type { OutcomeContract } from '@/lib/outcome-contract';
import type {
  BlueprintCapability,
  BlueprintProof,
  SolutionBlueprintInput,
  SolutionDeploymentInput,
  SolutionObservationInput,
} from '@/lib/solution-blueprints';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const number = (value: unknown): number =>
  typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function reading(value: unknown): { value: number; label: string } {
  const row = object(value) ?? {};
  return { value: number(row.value), label: text(row.label) };
}

function outcome(value: unknown): OutcomeContract {
  const row = object(value) ?? {};
  const roi = object(row.roi) ?? {};
  return {
    metricName: text(row.metricName),
    metricUnit: text(row.metricUnit),
    // Preserve invalid input so validation rejects it. Never default a typo to an active meaning.
    direction: text(row.direction) as OutcomeContract['direction'],
    measurementWindow: text(row.measurementWindow),
    baseline: reading(row.baseline),
    target: reading(row.target),
    measured: row.measured == null ? null : reading(row.measured),
    roi: {
      currency: text(roi.currency),
      annualBenefit: number(roi.annualBenefit),
      implementationCost: number(roi.implementationCost),
      annualOperatingCost: number(roi.annualOperatingCost),
      rationale: text(roi.rationale),
    },
  };
}

function proof(value: unknown): BlueprintProof {
  const row = object(value) ?? {};
  return {
    status: text(row.status) as BlueprintProof['status'],
    summary: text(row.summary),
    evidenceLinks: list(row.evidenceLinks),
  };
}

export function parseBlueprintInput(value: unknown): SolutionBlueprintInput | null {
  const body = object(value);
  if (!body) return null;
  return {
    title: text(body.title),
    summary: text(body.summary),
    industry: text(body.industry),
    process: text(body.process),
    businessOwner: text(body.businessOwner),
    requiredDataDomains: list(body.requiredDataDomains),
    requiredCapabilities: list(body.requiredCapabilities) as BlueprintCapability[],
    requiredPipelineName: text(body.requiredPipelineName),
    sourceTemplateKey: text(body.sourceTemplateKey),
    outcome: outcome(body.outcome),
    proof: proof(body.proof),
  };
}

export function parseBlueprintPatch(value: unknown): Partial<SolutionBlueprintInput> | null {
  const body = object(value);
  if (!body) return null;
  const patch: Partial<SolutionBlueprintInput> = {};
  for (const key of [
    'title',
    'summary',
    'industry',
    'process',
    'businessOwner',
    'requiredPipelineName',
    'sourceTemplateKey',
  ] as const) {
    if (key in body) patch[key] = text(body[key]);
  }
  if ('requiredDataDomains' in body) patch.requiredDataDomains = list(body.requiredDataDomains);
  if ('requiredCapabilities' in body) {
    patch.requiredCapabilities = list(body.requiredCapabilities) as BlueprintCapability[];
  }
  if ('outcome' in body) patch.outcome = outcome(body.outcome);
  if ('proof' in body) patch.proof = proof(body.proof);
  return patch;
}

export function parseDeploymentInput(value: unknown): SolutionDeploymentInput | null {
  const body = object(value);
  if (!body) return null;
  return {
    blueprintId: text(body.blueprintId),
    blueprintVersion: number(body.blueprintVersion),
    appId: text(body.appId),
    status: text(body.status) as SolutionDeploymentInput['status'],
  };
}

export function parseObservationInput(value: unknown): SolutionObservationInput | null {
  const body = object(value);
  if (!body) return null;
  return {
    windowStart: new Date(text(body.windowStart)),
    windowEnd: new Date(text(body.windowEnd)),
    metricValue: number(body.metricValue),
    metricLabel: text(body.metricLabel),
    runsCompleted: number(body.runsCompleted),
    minutesSavedPerRun: number(body.minutesSavedPerRun),
    loadedCostPerHour: number(body.loadedCostPerHour),
    actualAiCost: number(body.actualAiCost),
    evidenceLinks: list(body.evidenceLinks),
  };
}
