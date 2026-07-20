import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createApp, listApps, updateApp } from '../src/lib/apps-store.ts';
import { createDomain, listDomains } from '../src/lib/data-domains-store.ts';
import { domainsFor, identity } from '../src/lib/demo/seed-guard.ts';
import {
  FLAGSHIP_SOLUTION_TARGETS,
  flagshipDefinition,
  validateDeployedSha,
  verifyTenantFlagshipState,
  type FlagshipSolutionTarget,
} from '../src/lib/flagship-solution-release.ts';
import {
  createPipeline,
  getPipeline,
  listPipelines,
  updatePipeline,
  type PipelineView,
} from '../src/lib/pipelines.ts';
import { planSeedPipelines, samplePipelineId } from '../src/lib/pipelines-seed.ts';
import {
  listPersistedSolutionBlueprints,
  listSolutionBlueprints,
} from '../src/lib/solution-blueprints-store.ts';
import { listConnectors } from '../src/lib/store.ts';
import {
  BHARAT_PROFILE,
  SURAKSHA_PROFILE,
  buildAppGraph,
  type TenantProfile,
} from '../src/lib/tour-demo-seed.ts';

const PROFILES: Readonly<Record<FlagshipSolutionTarget['orgId'], TenantProfile>> = {
  org_bharat: BHARAT_PROFILE,
  org_suraksha: SURAKSHA_PROFILE,
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${key}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function pipelineMatches(
  current: PipelineView,
  planned: ReturnType<typeof planSeedPipelines>[number],
) {
  return (
    current.name === planned.name &&
    current.description === planned.description &&
    current.gatewayId === planned.gatewayId &&
    current.status === planned.status &&
    current.isTemplate === planned.isTemplate &&
    canonical(current.dataAllowlist) === canonical(planned.dataAllowlist) &&
    canonical(current.routing) === canonical(planned.routing) &&
    canonical(current.policyOverlay) === canonical(planned.policyOverlay) &&
    canonical(current.guardrailOverlay) === canonical(planned.guardrailOverlay)
  );
}

async function applyDomain(profile: TenantProfile, label: string): Promise<void> {
  const planned = domainsFor(profile).find(
    (candidate) => candidate.label.trim().toLowerCase() === label.trim().toLowerCase(),
  );
  if (!planned) throw new Error(`${profile.orgId}: no canonical domain definition for ${label}`);
  const connectorName = identity(profile).connectors.find(
    (connector) => connector.id === planned.connectorId,
  )?.name;
  if (!connectorName) throw new Error(`${profile.orgId}: no connector contract for ${label}`);
  const connectors = (await listConnectors(profile.orgId)).filter(
    (connector) => connector.name.trim().toLowerCase() === connectorName.trim().toLowerCase(),
  );
  if (connectors.length !== 1) {
    throw new Error(
      `${profile.orgId}: ${label} requires exactly one existing ${connectorName} connector; found ${connectors.length}`,
    );
  }
  const existing = (await listDomains(profile.orgId)).filter(
    (domain) => domain.label.trim().toLowerCase() === label.trim().toLowerCase(),
  );
  if (existing.length > 1) throw new Error(`${profile.orgId}: ambiguous domain label ${label}`);
  if (existing[0]) {
    if (existing[0].connectorId !== connectors[0].id || existing[0].resource !== planned.resource) {
      throw new Error(
        `${profile.orgId}: operator-owned domain ${label} conflicts with the contract`,
      );
    }
    return;
  }
  await createDomain(
    {
      label: planned.label,
      aliases: planned.aliases,
      connectorId: connectors[0].id,
      resource: planned.resource,
      opHints: planned.opHints,
    },
    profile.orgId,
  );
}

async function applyPipeline(
  target: FlagshipSolutionTarget,
  profile: TenantProfile,
): Promise<string> {
  const id = samplePipelineId(profile.orgId, target.pipelineKey);
  const planned = planSeedPipelines(profile.orgId).find((candidate) => candidate.id === id);
  if (!planned) throw new Error(`${profile.orgId}: missing pipeline plan ${target.pipelineKey}`);
  const current = await getPipeline(id, profile.orgId);
  if (!current) {
    const created = await createPipeline(
      { ...planned, visibility: 'org' },
      profile.viewerEmail,
      profile.orgId,
    );
    if (created.id !== id) throw new Error(`${profile.orgId}: deterministic pipeline id collision`);
    return created.id;
  }
  if (!pipelineMatches(current, planned)) {
    await updatePipeline(
      id,
      {
        name: planned.name,
        description: planned.description,
        gatewayId: planned.gatewayId,
        dataAllowlist: planned.dataAllowlist,
        routing: planned.routing,
        policyOverlay: planned.policyOverlay,
        guardrailOverlay: planned.guardrailOverlay,
        status: planned.status,
        isTemplate: planned.isTemplate,
      },
      profile.orgId,
      'system:flagship-solution-release',
    );
  }
  return id;
}

async function applyApp(
  target: FlagshipSolutionTarget,
  profile: TenantProfile,
  pipelineId: string,
): Promise<void> {
  const definition = flagshipDefinition(target);
  const expectedGraph = buildAppGraph(definition.app);
  const matches = (await listApps(profile.orgId)).filter(
    (app) => app.title.trim().toLowerCase() === definition.app.title.trim().toLowerCase(),
  );
  if (matches.length > 1)
    throw new Error(`${profile.orgId}: ambiguous App ${definition.app.title}`);
  const expected = {
    title: definition.app.title,
    summary: definition.app.summary,
    visibility: 'org' as const,
    published: true,
    pipelineId,
    steps: expectedGraph.steps,
    edges: expectedGraph.edges,
  };
  if (!matches[0]) {
    await createApp(profile.orgId, profile.viewerEmail, expected);
    return;
  }
  const current = matches[0];
  if (current.ownerId !== profile.viewerEmail) {
    throw new Error(`${profile.orgId}: operator-owned App conflicts with ${definition.app.title}`);
  }
  const differs =
    current.summary !== expected.summary ||
    current.visibility !== expected.visibility ||
    current.published !== expected.published ||
    current.pipelineId !== expected.pipelineId ||
    canonical(current.steps) !== canonical(expected.steps) ||
    canonical(current.edges) !== canonical(expected.edges);
  if (differs) await updateApp(current.id, profile.orgId, expected);
}

export async function applyFlagshipSolutionContracts(): Promise<void> {
  for (const target of FLAGSHIP_SOLUTION_TARGETS) {
    const profile = PROFILES[target.orgId];
    const definition = flagshipDefinition(target);
    for (const label of definition.blueprint.input.requiredDataDomains) {
      await applyDomain(profile, label);
    }
    const pipelineId = await applyPipeline(target, profile);
    await applyApp(target, profile, pipelineId);
  }
  // Reading the versioned catalog applies only the catalog's idempotent v3 seed rows.
  await Promise.all(Object.keys(PROFILES).map((orgId) => listSolutionBlueprints(orgId)));
}

export async function verifyFlagshipSolutionContracts() {
  const results = [];
  for (const orgId of Object.keys(PROFILES) as FlagshipSolutionTarget['orgId'][]) {
    const [blueprints, apps, pipelines, domains] = await Promise.all([
      listPersistedSolutionBlueprints(orgId),
      listApps(orgId),
      listPipelines(orgId),
      listDomains(orgId),
    ]);
    results.push(verifyTenantFlagshipState(orgId, { blueprints, apps, pipelines, domains }));
  }
  return results;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (apply) {
    const localSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
    const shaErrors = validateDeployedSha(localSha, process.env.OFFGRID_DEPLOYED_CONSOLE_SHA);
    if (shaErrors.length) throw new Error(shaErrors.join('; '));
    await applyFlagshipSolutionContracts();
  }
  const results = await verifyFlagshipSolutionContracts();
  console.log(
    JSON.stringify({ mode: apply ? 'apply-and-verify' : 'verify-only', results }, null, 2),
  );
  const errors = results.flatMap((result) => result.errors);
  if (errors.length) throw new Error(errors.join('; '));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
