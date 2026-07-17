import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  deleteMaterializedAgents,
  materializedAgentIds,
  syncMaterializedAgentOwnership,
} from '../src/lib/app-agent-ownership.ts';
import { defaultDeps } from '../src/lib/app-run.ts';
import {
  createApp,
  deleteApp,
  findAppByAgentId,
  getApp,
  updateApp,
} from '../src/lib/apps-store.ts';
import { createPipeline, deletePipeline } from '../src/lib/pipelines.ts';
import { getCustomAgent } from '../src/lib/store.ts';
// @ts-expect-error shared JS reachability helper
import { dbAvailable } from './helpers/db-available.mjs';

const available = await dbAvailable();
const skip = available.ok ? undefined : available.reason;

describe('AppSpec owns materialized runtime agents (real Postgres)', { skip }, () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const orgId = `app_agent_owner_${suffix}`;
  const owner = `owner_${suffix}@test.local`;
  const pipelineA = `pl_owner_a_${suffix}`;
  const pipelineB = `pl_owner_b_${suffix}`;
  let appId = '';
  let runtimeAgentId = '';

  before(async () => {
    await createPipeline({ id: pipelineA, name: 'Claims A', status: 'published' }, owner, orgId);
    await createPipeline({ id: pipelineB, name: 'Claims B', status: 'published' }, owner, orgId);
  });

  after(async () => {
    if (appId) await deleteApp(appId, orgId).catch(() => {});
    if (runtimeAgentId)
      await deleteMaterializedAgents(
        {
          id: 'cleanup',
          orgId,
          ownerId: owner,
          title: 'cleanup',
          summary: '',
          visibility: 'private',
          published: false,
          trigger: { kind: 'on-demand' },
          edges: [],
          steps: [
            {
              id: 'agent',
              label: 'agent',
              kind: 'agent',
              agentId: runtimeAgentId,
              inlineAgent: { systemPrompt: 'x' },
            },
          ],
        },
        orgId,
      ).catch(() => {});
    await deletePipeline(pipelineA, orgId).catch(() => {});
    await deletePipeline(pipelineB, orgId).catch(() => {});
  });

  test('materialization, binding edits, tenant lookup, and deletion follow the owning app', async () => {
    const created = await createApp(orgId, owner, {
      title: 'Claims decision agent',
      summary: '',
      visibility: 'private',
      trigger: { kind: 'on-demand' },
      pipelineId: pipelineA,
      steps: [
        {
          id: 'agent',
          label: 'Decide claim',
          kind: 'agent',
          inlineAgent: { systemPrompt: 'Decide this claim.', grounded: false },
        },
      ],
      edges: [],
    });
    appId = created.id;

    const step = created.steps[0];
    assert.equal(step.kind, 'agent');
    if (step.kind !== 'agent') throw new Error('expected agent step');
    runtimeAgentId = await defaultDeps().materializeAgent(created, step, orgId);

    const materializedApp = await getApp(appId, orgId);
    assert.ok(materializedApp);
    assert.deepEqual(materializedAgentIds(materializedApp), [runtimeAgentId]);
    assert.equal((await getCustomAgent(runtimeAgentId, orgId))?.pipelineId, pipelineA);
    assert.equal((await findAppByAgentId(runtimeAgentId, orgId))?.id, appId);
    assert.equal(await findAppByAgentId(runtimeAgentId, `other_${orgId}`), null);

    const rebound = await updateApp(appId, orgId, { pipelineId: pipelineB });
    assert.ok(rebound);
    await syncMaterializedAgentOwnership(materializedApp, rebound, orgId);
    assert.equal((await getCustomAgent(runtimeAgentId, orgId))?.pipelineId, pipelineB);

    await deleteMaterializedAgents(rebound, orgId);
    assert.equal(await getCustomAgent(runtimeAgentId, orgId), undefined);
    runtimeAgentId = '';
  });
});
