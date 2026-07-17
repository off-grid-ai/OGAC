import type { OutcomeContract } from '@/lib/outcome-contract';
import type {
  BlueprintProof,
  SolutionBlueprintInput,
  SolutionDeploymentInput,
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
  const measured = row.measured === null || row.measured === undefined ? null : reading(row.measured);
  return {
    metricName: text(row.metricName),
    metricUnit: text(row.metricUnit),
    direction: row.direction === 'decrease' ? 'decrease' : 'increase',
    measurementWindow: text(row.measurementWindow),
    baseline: reading(row.baseline),
    target: reading(row.target),
    measured,
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
    version: text(row.version),
    provenDeployments: number(row.provenDeployments),
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
    requiredTools: list(body.requiredTools),
    governedPipeline: text(body.governedPipeline),
    sourceTemplateKey: text(body.sourceTemplateKey),
    outcome: outcome(body.outcome),
    proof: proof(body.proof),
  };
}

export function parseBlueprintPatch(value: unknown): Partial<SolutionBlueprintInput> | null {
  const body = object(value);
  if (!body) return null;
  const patch: Partial<SolutionBlueprintInput> = {};
  for (const key of ['title', 'summary', 'industry', 'process', 'businessOwner', 'governedPipeline', 'sourceTemplateKey'] as const) {
    if (key in body) patch[key] = text(body[key]);
  }
  if ('requiredDataDomains' in body) patch.requiredDataDomains = list(body.requiredDataDomains);
  if ('requiredTools' in body) patch.requiredTools = list(body.requiredTools);
  if ('outcome' in body) patch.outcome = outcome(body.outcome);
  if ('proof' in body) patch.proof = proof(body.proof);
  return patch;
}

export function parseDeploymentInput(value: unknown): SolutionDeploymentInput | null {
  const body = object(value);
  if (!body) return null;
  const status = body.status === 'paused' || body.status === 'retired' ? body.status : 'active';
  return {
    blueprintId: text(body.blueprintId),
    appId: text(body.appId),
    status,
    evidenceLinks: list(body.evidenceLinks),
  };
}
