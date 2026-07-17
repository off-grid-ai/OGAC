import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
// @ts-expect-error shared JS reachability helper
import { dbAvailable } from './helpers/db-available.mjs';
import { prepareSolutionSchema } from './support/solution-schema.mjs';

const available = await dbAvailable();
const skip = available.ok ? undefined : available.reason;
const previousDatabaseUrl = process.env.DATABASE_URL;
const prepared = available.ok ? await prepareSolutionSchema('app_binding_runtime') : null;
if (prepared) process.env.DATABASE_URL = prepared.databaseUrl;

const { submitAppRun } = await import('../src/lib/adapters/apprun.ts');
const { createApp, deleteApp } = await import('../src/lib/apps-store.ts');
const { resolveContractStrict } = await import('../src/lib/pipeline-contract.ts');
const { PipelineBindingError, resolveExplicitPipelineBinding } =
  await import('../src/lib/pipeline-run-glue.ts');
const { createPipeline, deletePipeline, updatePipeline } = await import('../src/lib/pipelines.ts');
const { resolveContractActivity } = await import('../src/worker/app-run.activities.ts');

after(async () => {
  await prepared?.cleanup();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

describe('canonical App-as-agent binding fails closed (real Postgres)', { skip }, () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const orgId = `app_binding_${suffix}`;
  const otherOrgId = `other_${orgId}`;
  const owner = `owner_${suffix}@test.local`;
  const pipelineId = `pl_app_binding_${suffix}`;
  const alternatePipelineId = `pl_app_binding_alt_${suffix}`;
  let appId = '';

  after(async () => {
    if (appId) await deleteApp(appId, orgId).catch(() => {});
    await deletePipeline(pipelineId, orgId).catch(() => {});
    await deletePipeline(alternatePipelineId, orgId).catch(() => {});
  });

  test('dispatch and Temporal re-resolution reject stale or cross-org explicit bindings', async () => {
    await createPipeline(
      { id: pipelineId, name: 'Canonical app binding', status: 'published' },
      owner,
      orgId,
    );
    await createPipeline(
      { id: alternatePipelineId, name: 'Forged caller binding', status: 'published' },
      owner,
      orgId,
    );
    const app = await createApp(orgId, owner, {
      title: 'Bound claims dispatch',
      summary: '',
      visibility: 'private',
      pipelineId,
      trigger: { kind: 'on-demand' },
      steps: [{ id: 'output', label: 'Return result', kind: 'output', sink: 'console' }],
      edges: [],
    });
    appId = app.id;

    const atDispatch = await resolveExplicitPipelineBinding(pipelineId, orgId);
    assert.equal(atDispatch.state, 'bound');
    assert.equal(
      await resolveContractActivity(pipelineId, orgId).then((c) => c?.pipelineId),
      pipelineId,
    );

    const crossOrg = await resolveExplicitPipelineBinding(pipelineId, otherOrgId);
    assert.equal(crossOrg.state, 'invalid');
    await assert.rejects(
      () => resolveContractActivity(pipelineId, otherOrgId),
      (error) =>
        error instanceof PipelineBindingError && error.binding.code === 'pipeline_unavailable',
    );

    await updatePipeline(pipelineId, { status: 'deprecated' }, orgId, owner);
    const deprecated = await resolveExplicitPipelineBinding(pipelineId, orgId);
    assert.equal(deprecated.state, 'invalid');
    await assert.rejects(
      () => resolveContractActivity(pipelineId, orgId),
      (error) =>
        error instanceof PipelineBindingError && error.binding.code === 'pipeline_unavailable',
    );

    const forgedContract = await resolveContractStrict(alternatePipelineId, orgId);
    assert.ok(forgedContract);
    await assert.rejects(
      () =>
        submitAppRun(
          app,
          {},
          {
            orgId,
            actor: owner,
            runId: `forged_${suffix}`,
            pipelineId: alternatePipelineId,
            contract: forgedContract,
          },
        ),
      (error) =>
        error instanceof PipelineBindingError && error.binding.code === 'pipeline_unavailable',
      'the saved App binding wins; a caller-supplied valid contract cannot bypass it',
    );

    await assert.rejects(
      () => deletePipeline(pipelineId, orgId),
      (error) => (error as Error & { cause?: { code?: string } }).cause?.code === '23503',
      'the database prevents a direct/legacy caller from retiring a bound pipeline',
    );
  });

  test('deliberately unbound apps remain runnable without a contract', async () => {
    assert.deepEqual(await resolveExplicitPipelineBinding(null, orgId), {
      state: 'unbound',
      pipelineId: null,
      contract: null,
    });
    assert.equal(await resolveContractActivity(null, orgId), null);
  });
});
