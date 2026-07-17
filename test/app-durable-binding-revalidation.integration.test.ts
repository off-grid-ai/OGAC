import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp, deleteApp, updateApp } from '../src/lib/apps-store.ts';
import { PipelineBindingError } from '../src/lib/pipeline-run-glue.ts';
import { createPipeline, deletePipeline, updatePipeline } from '../src/lib/pipelines.ts';
import { resolveAppRunContractActivity } from '../src/worker/app-run.activities.ts';
// @ts-expect-error shared JS reachability helper
import { dbAvailable } from './helpers/db-available.mjs';

const available = await dbAvailable();
const skip = available.ok ? undefined : available.reason;

describe('durable App binding revalidation (real Postgres)', { skip }, () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const orgId = `app_durable_binding_${suffix}`;
  const owner = `owner_${suffix}@test.local`;
  const pipelineA = `pl_app_durable_a_${suffix}`;
  const pipelineB = `pl_app_durable_b_${suffix}`;
  let appId = '';

  before(async () => {
    await createPipeline({ id: pipelineA, name: 'Claims A', status: 'published' }, owner, orgId);
    await createPipeline({ id: pipelineB, name: 'Claims B', status: 'published' }, owner, orgId);
    const app = await createApp(orgId, owner, {
      title: 'Scheduled claims decision',
      summary: '',
      visibility: 'private',
      pipelineId: pipelineA,
      trigger: { kind: 'schedule', config: { cron: '@daily' } },
      steps: [
        {
          id: 'decide',
          label: 'Decide claim',
          kind: 'agent',
          inlineAgent: { systemPrompt: 'Decide the claim.', grounded: false },
        },
      ],
      edges: [],
    });
    appId = app.id;
  });

  after(async () => {
    if (appId) await deleteApp(appId, orgId).catch(() => {});
    await deletePipeline(pipelineA, orgId).catch(() => {});
    await deletePipeline(pipelineB, orgId).catch(() => {});
  });

  test('a queued/scheduled snapshot cannot survive binding changes or pipeline retirement', async () => {
    const initial = await resolveAppRunContractActivity(appId, pipelineA, orgId);
    assert.equal(initial?.pipelineId, pipelineA);

    await updateApp(appId, orgId, { pipelineId: pipelineB });
    await assert.rejects(
      () => resolveAppRunContractActivity(appId, pipelineA, orgId),
      (error) => error instanceof PipelineBindingError && error.binding.code === 'binding_changed',
    );

    assert.equal(
      (await resolveAppRunContractActivity(appId, pipelineB, orgId))?.pipelineId,
      pipelineB,
    );
    await updatePipeline(pipelineB, { status: 'deprecated' }, orgId, owner);
    await assert.rejects(
      () => resolveAppRunContractActivity(appId, pipelineB, orgId),
      (error) =>
        error instanceof PipelineBindingError && error.binding.code === 'pipeline_unavailable',
    );
  });

  test('null is an explicit unbound snapshot and is revalidated exactly like a bound id', async () => {
    await updateApp(appId, orgId, { pipelineId: null });
    assert.equal(await resolveAppRunContractActivity(appId, null, orgId), null);
    await assert.rejects(
      () => resolveAppRunContractActivity(appId, pipelineA, orgId),
      (error) => error instanceof PipelineBindingError && error.binding.code === 'binding_changed',
    );
  });
});
