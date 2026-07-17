import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { apps, customAgents } from '../src/db/schema.ts';
import {
  backfillAppOwnedRuntimeAgents,
  createApp,
  deleteApp,
  getApp,
} from '../src/lib/apps-store.ts';
import {
  resolveExplicitPipelineBinding,
  resolveAgentRunBinding,
} from '../src/lib/pipeline-run-glue.ts';
import { createPipeline, deletePipeline } from '../src/lib/pipelines.ts';
import { createCustomAgent, getCustomAgent } from '../src/lib/store.ts';
// @ts-expect-error shared JS reachability helper
import { dbAvailable } from './helpers/db-available.mjs';

const available = await dbAvailable();
const skip = available.ok ? undefined : available.reason;

describe('App-owned runtime upgrade and database invariants (real Postgres)', { skip }, () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const orgId = `app_upgrade_${suffix}`;
  const owner = `owner_${suffix}@test.local`;
  const pipelineA = `pl_upgrade_a_${suffix}`;
  const pipelineB = `pl_upgrade_b_${suffix}`;
  let appId = '';
  let agentId = '';

  after(async () => {
    if (appId) await deleteApp(appId, orgId).catch(() => {});
    await deletePipeline(pipelineA, orgId).catch(() => {});
    await deletePipeline(pipelineB, orgId).catch(() => {});
  });

  test('idempotent backfill repairs ownership and one DB owner protects every run entry point', async () => {
    await createPipeline(
      { id: pipelineA, name: 'Before upgrade', status: 'published' },
      owner,
      orgId,
    );
    await createPipeline(
      { id: pipelineB, name: 'After upgrade', status: 'published' },
      owner,
      orgId,
    );
    const legacy = await createCustomAgent(
      { name: 'Legacy App runtime', systemPrompt: 'Handle claims.', pipelineId: null },
      orgId,
    );
    agentId = legacy.id;
    const app = await createApp(orgId, owner, {
      title: 'Claims decision',
      summary: '',
      visibility: 'private',
      pipelineId: pipelineA,
      trigger: { kind: 'schedule', config: { cron: '@daily' } },
      steps: [{ id: 'agent', label: 'Decide claim', kind: 'agent', agentId: legacy.id }],
      edges: [],
    });
    appId = app.id;
    assert.equal((await getCustomAgent(agentId, orgId))?.ownerAppId, null);

    await backfillAppOwnedRuntimeAgents();
    await backfillAppOwnedRuntimeAgents();
    assert.equal((await getCustomAgent(agentId, orgId))?.ownerAppId, appId);
    assert.equal((await getCustomAgent(agentId, orgId))?.pipelineId, pipelineA);

    // A legacy/direct writer cannot drift the runtime away from its App: the trigger restores the
    // aggregate's binding. Updating the App propagates atomically to the runtime row.
    await db
      .update(customAgents)
      .set({ pipelineId: pipelineB })
      .where(and(eq(customAgents.id, agentId), eq(customAgents.orgId, orgId)));
    assert.equal((await getCustomAgent(agentId, orgId))?.pipelineId, pipelineA);
    await db
      .update(apps)
      .set({ pipelineId: pipelineB })
      .where(and(eq(apps.id, appId), eq(apps.orgId, orgId)));
    assert.equal((await getCustomAgent(agentId, orgId))?.pipelineId, pipelineB);
    assert.equal((await getApp(appId, orgId))?.pipelineId, pipelineB);

    // Direct run, webhook/email trigger, and recurring schedule all enter dispatchAgentRun and use
    // resolveAgentRunBinding; the App path uses the same explicit resolver. Both see one binding.
    const directTriggerAndSchedule = await resolveAgentRunBinding(agentId, orgId);
    const appPath = await resolveExplicitPipelineBinding(
      (await getApp(appId, orgId))?.pipelineId,
      orgId,
    );
    assert.equal(directTriggerAndSchedule.state, 'bound');
    assert.equal(directTriggerAndSchedule.pipelineId, pipelineB);
    assert.equal(appPath.state, 'bound');
    assert.equal(appPath.pipelineId, pipelineB);

    await assert.rejects(
      () => deletePipeline(pipelineB, orgId),
      (error) => (error as Error & { cause?: { code?: string } }).cause?.code === '23503',
      'retirement is database-enforced even when a caller bypasses the lifecycle service',
    );
  });
});
