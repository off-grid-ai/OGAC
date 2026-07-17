import type { OutcomeContract } from '@/lib/outcome-contract';
import { validateOutcomeContract } from '@/lib/outcome-contract';

export interface BlueprintProof {
  version: string;
  provenDeployments: number;
  summary: string;
  evidenceLinks: string[];
}

export interface SolutionBlueprint {
  id: string;
  orgId: string;
  title: string;
  summary: string;
  industry: string;
  process: string;
  businessOwner: string;
  requiredDataDomains: string[];
  requiredTools: string[];
  governedPipeline: string;
  sourceTemplateKey: string;
  outcome: OutcomeContract;
  proof: BlueprintProof;
  createdAt: Date;
  updatedAt: Date;
}

export type SolutionBlueprintInput = Omit<
  SolutionBlueprint,
  'id' | 'orgId' | 'createdAt' | 'updatedAt'
>;

export interface SolutionDeployment {
  id: string;
  orgId: string;
  blueprintId: string;
  appId: string;
  status: 'active' | 'paused' | 'retired';
  evidenceLinks: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type SolutionDeploymentInput = Pick<
  SolutionDeployment,
  'blueprintId' | 'appId' | 'status' | 'evidenceLinks'
>;

function nonEmptyList(values: string[]): boolean {
  return values.length > 0 && values.every((value) => value.trim().length > 0);
}

function validEvidenceLinks(links: string[]): boolean {
  return links.every((link) => link.startsWith('/') || /^https?:\/\//.test(link));
}

export function validateBlueprint(input: SolutionBlueprintInput): string[] {
  const errors: string[] = [];
  const required = [
    ['title', input.title],
    ['summary', input.summary],
    ['industry', input.industry],
    ['process', input.process],
    ['business owner', input.businessOwner],
    ['governed pipeline', input.governedPipeline],
    ['source template key', input.sourceTemplateKey],
    ['proof version', input.proof.version],
    ['proof summary', input.proof.summary],
  ] as const;
  for (const [label, value] of required) if (!value.trim()) errors.push(`${label} is required`);
  if (!nonEmptyList(input.requiredDataDomains)) errors.push('at least one data domain is required');
  if (!nonEmptyList(input.requiredTools)) errors.push('at least one tool is required');
  if (!Number.isInteger(input.proof.provenDeployments) || input.proof.provenDeployments < 0) {
    errors.push('proven deployments must be a non-negative integer');
  }
  if (!validEvidenceLinks(input.proof.evidenceLinks))
    errors.push('evidence links must be relative or HTTP URLs');
  return [...errors, ...validateOutcomeContract(input.outcome)];
}

export function validateDeployment(input: SolutionDeploymentInput): string[] {
  const errors: string[] = [];
  if (!input.blueprintId.trim()) errors.push('blueprint is required');
  if (!input.appId.trim()) errors.push('app is required');
  if (!['active', 'paused', 'retired'].includes(input.status))
    errors.push('invalid deployment status');
  if (!validEvidenceLinks(input.evidenceLinks))
    errors.push('evidence links must be relative or HTTP URLs');
  return errors;
}

export function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}
