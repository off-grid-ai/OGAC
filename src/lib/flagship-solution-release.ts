import type { AppSpec } from '@/lib/app-model';
import type { DataDomain } from '@/lib/data-domains';
import type { PipelineView } from '@/lib/pipelines';
import { SEEDED_SOLUTION_BLUEPRINTS } from '@/lib/solution-blueprint-seeds';
import { evaluateSolutionRuntimeBinding, type SolutionBlueprint } from '@/lib/solution-blueprints';
import { BANK_APPS, INSURER_APPS, type AppSpecSeed } from '@/lib/tour-demo-seed';

export interface FlagshipSolutionTarget {
  orgId: 'org_bharat' | 'org_suraksha';
  blueprintKey:
    'lending-delinquency-intervention' | 'insurance-indemnity-fast-track' | 'bank-rm-cross-sell';
  appKey: 'delinquency-intervention' | 'indemnity-fast-track' | 'cross-sell';
  pipelineKey: 'collections-intervention' | 'indemnity-claims' | 'rm-cross-sell';
}

export const FLAGSHIP_SOLUTION_TARGETS: readonly FlagshipSolutionTarget[] = [
  {
    orgId: 'org_bharat',
    blueprintKey: 'lending-delinquency-intervention',
    appKey: 'delinquency-intervention',
    pipelineKey: 'collections-intervention',
  },
  {
    orgId: 'org_bharat',
    blueprintKey: 'bank-rm-cross-sell',
    appKey: 'cross-sell',
    pipelineKey: 'rm-cross-sell',
  },
  {
    orgId: 'org_suraksha',
    blueprintKey: 'insurance-indemnity-fast-track',
    appKey: 'indemnity-fast-track',
    pipelineKey: 'indemnity-claims',
  },
] as const;

export interface FlagshipDefinition extends FlagshipSolutionTarget {
  app: AppSpecSeed;
  blueprint: (typeof SEEDED_SOLUTION_BLUEPRINTS)[number];
}

/** Resolve the canonical catalog + App definitions without duplicating either contract. */
export function flagshipDefinition(target: FlagshipSolutionTarget): FlagshipDefinition {
  const apps = target.orgId === 'org_bharat' ? BANK_APPS : INSURER_APPS;
  const app = apps.find((candidate) => candidate.key === target.appKey);
  const blueprint = SEEDED_SOLUTION_BLUEPRINTS.find(
    (candidate) => candidate.key === target.blueprintKey,
  );
  if (!app || !blueprint) throw new Error(`missing flagship definition: ${target.blueprintKey}`);
  if (app.pipelineName !== blueprint.input.requiredPipelineName) {
    throw new Error(`${target.blueprintKey} App and Blueprint pipelines differ`);
  }
  return { ...target, app, blueprint };
}

export interface TenantFlagshipState {
  blueprints: readonly SolutionBlueprint[];
  apps: readonly Pick<AppSpec, 'pipelineId' | 'published' | 'steps'>[];
  pipelines: readonly Pick<PipelineView, 'id' | 'name' | 'status' | 'dataAllowlist'>[];
  domains: readonly Pick<DataDomain, 'label'>[];
}

export interface TenantFlagshipVerification {
  orgId: FlagshipSolutionTarget['orgId'];
  readiness: Record<string, boolean>;
  errors: string[];
}

/**
 * Independently recompute all three catalog contracts for one tenant. The persisted `adoptable`
 * result is checked against the graph instead of trusted, and cross-tenant contracts must remain
 * unavailable.
 */
export function verifyTenantFlagshipState(
  orgId: FlagshipSolutionTarget['orgId'],
  state: TenantFlagshipState,
): TenantFlagshipVerification {
  const errors: string[] = [];
  const domainLabels = state.domains.map((domain) => domain.label);
  const readiness: Record<string, boolean> = {};
  for (const seed of SEEDED_SOLUTION_BLUEPRINTS) {
    const blueprint = state.blueprints.find((candidate) => candidate.sourceCatalogKey === seed.key);
    if (!blueprint) {
      readiness[seed.key] = false;
      errors.push(`${orgId}: missing Blueprint ${seed.key}`);
      continue;
    }
    const compatible = state.apps.some((app) => {
      const pipeline = app.pipelineId
        ? (state.pipelines.find((candidate) => candidate.id === app.pipelineId) ?? null)
        : null;
      return evaluateSolutionRuntimeBinding(blueprint, app, pipeline, domainLabels).compatible;
    });
    readiness[seed.key] = compatible;
    if (blueprint.adoptable !== compatible) {
      errors.push(`${orgId}: ${seed.key} persisted readiness disagrees with its runtime graph`);
    }
  }

  const expected = new Set(
    FLAGSHIP_SOLUTION_TARGETS.filter((target) => target.orgId === orgId).map(
      (target) => target.blueprintKey,
    ),
  );
  for (const key of expected) {
    if (!readiness[key]) errors.push(`${orgId}: required flagship ${key} is not ready`);
  }
  return { orgId, readiness, errors };
}

/** The live apply command is deliberately gated on an explicit SHA observed after deployment. */
export function validateDeployedSha(localSha: string, deployedSha: string | undefined): string[] {
  const local = localSha.trim().toLowerCase();
  const deployed = (deployedSha ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(local)) return ['local Console SHA must be a full 40-character SHA'];
  if (!deployed) return ['OFFGRID_DEPLOYED_CONSOLE_SHA is required for --apply'];
  if (!/^[0-9a-f]{40}$/.test(deployed)) {
    return ['OFFGRID_DEPLOYED_CONSOLE_SHA must be a full 40-character SHA'];
  }
  return local === deployed
    ? []
    : [`deployed Console SHA ${deployed} does not match local ${local}`];
}
