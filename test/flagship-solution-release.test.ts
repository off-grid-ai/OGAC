import assert from 'node:assert/strict';
import test from 'node:test';
import { planSeedPipelines, samplePipelineId } from '../src/lib/pipelines-seed.ts';
import {
  FLAGSHIP_SOLUTION_TARGETS,
  flagshipDefinition,
  validateDeployedSha,
  verifyTenantFlagshipState,
} from '../src/lib/flagship-solution-release.ts';
import { buildAppGraph } from '../src/lib/tour-demo-seed.ts';

function runtimeState(orgId: 'org_bharat' | 'org_suraksha') {
  const targets = FLAGSHIP_SOLUTION_TARGETS.filter((target) => target.orgId === orgId);
  const pipelines = planSeedPipelines(orgId).filter((pipeline) =>
    targets.some((target) => samplePipelineId(orgId, target.pipelineKey) === pipeline.id),
  );
  const apps = targets.map((target) => {
    const definition = flagshipDefinition(target);
    return {
      pipelineId: samplePipelineId(orgId, target.pipelineKey),
      published: true,
      steps: buildAppGraph(definition.app).steps,
    };
  });
  const domains = targets.flatMap((target) =>
    flagshipDefinition(target).blueprint.input.requiredDataDomains.map((label) => ({ label })),
  );
  const blueprints = FLAGSHIP_SOLUTION_TARGETS.map((target) => flagshipDefinition(target)).map(
    ({ blueprint }) => ({
      ...blueprint.input,
      id: `bp_${blueprint.key}`,
      blueprintId: `bp_${blueprint.key}`,
      orgId,
      version: 1,
      currentVersion: 1,
      sourceCatalogKey: blueprint.key,
      catalogVersion: 3,
      tombstonedAt: null,
      createdBy: 'system:solution-catalog',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      adoptable: targets.some((target) => target.blueprintKey === blueprint.key),
    }),
  );
  return { blueprints, apps, pipelines, domains };
}

test('canonical flagship definitions bind each Blueprint to its exact seeded App pipeline', () => {
  for (const target of FLAGSHIP_SOLUTION_TARGETS) {
    const definition = flagshipDefinition(target);
    assert.equal(definition.app.pipelineName, definition.blueprint.input.requiredPipelineName);
    assert.equal(definition.app.key, definition.blueprint.input.sourceTemplateKey);
  }
});

test('Bharat and Suraksha readiness are independently recomputed without cross-tenant bleed', () => {
  const bharat = verifyTenantFlagshipState('org_bharat', runtimeState('org_bharat'));
  assert.deepEqual(bharat.errors, []);
  assert.deepEqual(bharat.readiness, {
    'lending-delinquency-intervention': true,
    'insurance-indemnity-fast-track': false,
    'bank-rm-cross-sell': true,
  });

  const suraksha = verifyTenantFlagshipState('org_suraksha', runtimeState('org_suraksha'));
  assert.deepEqual(suraksha.errors, []);
  assert.deepEqual(suraksha.readiness, {
    'lending-delinquency-intervention': false,
    'insurance-indemnity-fast-track': true,
    'bank-rm-cross-sell': false,
  });
});

test('verification fails closed when a required tenant domain is absent', () => {
  const state = runtimeState('org_bharat');
  state.domains = state.domains.filter((domain) => domain.label !== 'repayment history');
  const result = verifyTenantFlagshipState('org_bharat', state);
  assert.equal(result.readiness['lending-delinquency-intervention'], false);
  assert.match(result.errors.join('\n'), /lending-delinquency-intervention/);
});

test('live apply requires an exact deployed full SHA', () => {
  const sha = 'a'.repeat(40);
  assert.deepEqual(validateDeployedSha(sha, sha), []);
  assert.match(validateDeployedSha(sha, undefined).join('\n'), /required/);
  assert.match(validateDeployedSha(sha, 'b'.repeat(40)).join('\n'), /does not match/);
  assert.match(validateDeployedSha('abc', sha).join('\n'), /local Console SHA/);
});
