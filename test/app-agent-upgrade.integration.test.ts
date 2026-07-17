import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { apps, customAgents } from '../src/db/schema.ts';
import {
  backfillAppOwnedRuntimeAgents,
  createApp,
  deleteApp,
  ensureAppsSchema,
  getApp,
} from '../src/lib/apps-store.ts';
import {
  resolveExplicitPipelineBinding,
  resolveAgentRunBinding,
} from '../src/lib/pipeline-run-glue.ts';
import { createPipeline, deletePipeline } from '../src/lib/pipelines.ts';
import { listOperatorPipelineConsumers } from '../src/lib/pipeline-consumers.ts';
import { createCustomAgent, deleteCustomAgent, getCustomAgent } from '../src/lib/store.ts';
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
  const appIds: string[] = [];
  let agentId = '';
  let reusableAgentId = '';

  after(async () => {
    await Promise.all(appIds.map((id) => deleteApp(id, orgId).catch(() => {})));
    if (reusableAgentId) await deleteCustomAgent(reusableAgentId, orgId).catch(() => {});
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
      steps: [
        {
          id: 'agent',
          label: 'Decide claim',
          kind: 'agent',
          agentId: legacy.id,
          inlineAgent: { systemPrompt: 'Handle claims.', grounded: true },
        },
      ],
      edges: [],
    });
    appIds.push(app.id);
    assert.equal((await getCustomAgent(agentId, orgId))?.ownerAppId, null);

    await backfillAppOwnedRuntimeAgents();
    await backfillAppOwnedRuntimeAgents();
    assert.equal((await getCustomAgent(agentId, orgId))?.ownerAppId, app.id);
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
      .where(and(eq(apps.id, app.id), eq(apps.orgId, orgId)));
    assert.equal((await getCustomAgent(agentId, orgId))?.pipelineId, pipelineB);
    assert.equal((await getApp(app.id, orgId))?.pipelineId, pipelineB);

    // Direct run, webhook/email trigger, and recurring schedule all enter dispatchAgentRun and use
    // resolveAgentRunBinding; the App path uses the same explicit resolver. Both see one binding.
    const directTriggerAndSchedule = await resolveAgentRunBinding(agentId, orgId);
    const appPath = await resolveExplicitPipelineBinding(
      (await getApp(app.id, orgId))?.pipelineId,
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

  test('one or many Apps referencing a reusable agent never acquire its lifecycle', async () => {
    const reusable = await createCustomAgent(
      {
        name: 'Reusable fraud analyst',
        systemPrompt: 'Assess suspicious transactions.',
        pipelineId: pipelineA,
      },
      orgId,
    );
    reusableAgentId = reusable.id;
    const referencedStep = {
      id: 'agent',
      label: 'Use reusable analyst',
      kind: 'agent' as const,
      agentId: reusable.id,
    };
    const first = await createApp(orgId, owner, {
      title: 'First reusable-agent App',
      summary: '',
      visibility: 'private',
      pipelineId: pipelineB,
      trigger: { kind: 'on-demand' },
      steps: [referencedStep],
      edges: [],
    });
    appIds.push(first.id);

    await backfillAppOwnedRuntimeAgents();
    assert.deepEqual(
      await getCustomAgent(reusable.id, orgId),
      reusable,
      'one reference must not claim or rebind a reusable agent',
    );

    const second = await createApp(orgId, owner, {
      title: 'Second reusable-agent App',
      summary: '',
      visibility: 'private',
      pipelineId: pipelineB,
      trigger: { kind: 'on-demand' },
      steps: [referencedStep],
      edges: [],
    });
    appIds.push(second.id);

    await ensureAppsSchema();
    await backfillAppOwnedRuntimeAgents();
    assert.deepEqual(
      await getCustomAgent(reusable.id, orgId),
      reusable,
      'multiple references must remain valid and leave reusable ownership unchanged',
    );
    assert.ok(
      (await listOperatorPipelineConsumers(pipelineA, orgId)).some(
        (consumer) =>
          consumer.kind === 'runtime_agent' &&
          consumer.id === reusable.id &&
          consumer.ownerAppId === null,
      ),
      'the independent reusable agent remains visible to operators',
    );

    await deleteApp(first.id, orgId);
    await deleteApp(second.id, orgId);
    appIds.splice(appIds.indexOf(first.id), 1);
    appIds.splice(appIds.indexOf(second.id), 1);
    assert.deepEqual(
      await getCustomAgent(reusable.id, orgId),
      reusable,
      'deleting referencing Apps must not cascade-delete a reusable agent',
    );
  });
});
