import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  PipelineBindingError,
  resolveExplicitPipelineBinding,
} from '../src/lib/pipeline-run-glue.ts';
import { createPipeline, deletePipeline, updatePipeline } from '../src/lib/pipelines.ts';
import { resolveContractActivity } from '../src/worker/app-run.activities.ts';
// @ts-expect-error shared JS reachability helper
import { dbAvailable } from './helpers/db-available.mjs';

const available = await dbAvailable();
const skip = available.ok ? undefined : available.reason;

describe('canonical App-as-agent binding fails closed (real Postgres)', { skip }, () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const orgId = `app_binding_${suffix}`;
  const otherOrgId = `other_${orgId}`;
  const owner = `owner_${suffix}@test.local`;
  const pipelineId = `pl_app_binding_${suffix}`;

  after(async () => {
    await deletePipeline(pipelineId, orgId).catch(() => {});
  });

  test('dispatch and Temporal re-resolution reject stale or cross-org explicit bindings', async () => {
    await createPipeline(
      { id: pipelineId, name: 'Canonical app binding', status: 'published' },
      owner,
      orgId,
    );

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

    await deletePipeline(pipelineId, orgId);
    const deleted = await resolveExplicitPipelineBinding(pipelineId, orgId);
    assert.equal(deleted.state, 'invalid');
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
