import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { materializedAgentIds } from '../src/lib/app-agent-ownership.ts';
import { defaultDeps } from '../src/lib/app-run.ts';
import {
  AppAgentOwnershipError,
  createApp,
  deleteApp,
  findAppByAgentId,
  getApp,
  updateApp,
} from '../src/lib/apps-store.ts';
import { createPipeline, deletePipeline } from '../src/lib/pipelines.ts';
import { listPipelineConsumers } from '../src/lib/pipeline-consumers.ts';
import { getCustomAgent, listCustomAgents } from '../src/lib/store.ts';
// @ts-expect-error shared JS reachability helper
import { dbAvailable } from './helpers/db-available.mjs';

const available = await dbAvailable();
const skip = available.ok ? undefined : available.reason;

describe(
  'AppSpec owns materialized runtime agents transactionally (real Postgres)',
  { skip },
  () => {
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const orgId = `app_agent_owner_${suffix}`;
    const owner = `owner_${suffix}@test.local`;
    const pipelineA = `pl_owner_a_${suffix}`;
    const pipelineB = `pl_owner_b_${suffix}`;
    const appIds: string[] = [];

    before(async () => {
      await createPipeline({ id: pipelineA, name: 'Claims A', status: 'published' }, owner, orgId);
      await createPipeline({ id: pipelineB, name: 'Claims B', status: 'published' }, owner, orgId);
    });

    after(async () => {
      await Promise.all(appIds.map((id) => deleteApp(id, orgId).catch(() => {})));
      await deletePipeline(pipelineA, orgId).catch(() => {});
      await deletePipeline(pipelineB, orgId).catch(() => {});
    });

    async function createInlineApp(title: string, pipelineId = pipelineA) {
      const app = await createApp(orgId, owner, {
        title,
        summary: '',
        visibility: 'private',
        trigger: { kind: 'on-demand' },
        pipelineId,
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
      appIds.push(app.id);
      return app;
    }

    test('concurrent first runs materialize exactly one owned runtime agent', async () => {
      const created = await createInlineApp('Concurrent claims decision');
      const copies = await Promise.all(Array.from({ length: 8 }, () => getApp(created.id, orgId)));
      const ids = await Promise.all(
        copies.map(async (copy) => {
          assert.ok(copy);
          const step = copy.steps[0];
          assert.equal(step.kind, 'agent');
          if (step.kind !== 'agent') throw new Error('expected agent step');
          return defaultDeps().materializeAgent(copy, step, orgId);
        }),
      );

      assert.equal(new Set(ids).size, 1);
      const runtimeAgentId = ids[0];
      const stored = await getApp(created.id, orgId);
      assert.ok(stored);
      assert.deepEqual(materializedAgentIds(stored), [runtimeAgentId]);
      const runtime = await getCustomAgent(runtimeAgentId, orgId);
      assert.equal(runtime?.ownerAppId, created.id);
      assert.equal(runtime?.pipelineId, pipelineA);
      assert.equal((await findAppByAgentId(runtimeAgentId, orgId))?.id, created.id);

      const sameOwnerRows = (await listCustomAgents(orgId)).filter(
        (agent) => agent.ownerAppId === created.id,
      );
      assert.equal(sameOwnerRows.length, 1);

      const consumers = await listPipelineConsumers(pipelineA, orgId);
      assert.deepEqual(
        consumers.filter((consumer) => ['app', 'runtime_agent'].includes(consumer.kind)),
        [
          { kind: 'app', id: created.id, label: 'Concurrent claims decision' },
          {
            kind: 'runtime_agent',
            id: runtimeAgentId,
            label: 'Concurrent claims decision · Decide claim',
            ownerAppId: created.id,
          },
        ],
        'retirement inventory exposes both the authored App and its runtime dependency',
      );
    });

    test('binding edits sync atomically and App deletion cascades the runtime row', async () => {
      const created = await createInlineApp('Rebound claims decision');
      const step = created.steps[0];
      if (step.kind !== 'agent') throw new Error('expected agent step');
      const runtimeAgentId = await defaultDeps().materializeAgent(created, step, orgId);

      const rebound = await updateApp(created.id, orgId, { pipelineId: pipelineB });
      assert.equal(rebound?.pipelineId, pipelineB);
      assert.equal((await getCustomAgent(runtimeAgentId, orgId))?.pipelineId, pipelineB);

      await deleteApp(created.id, orgId);
      assert.equal(await getCustomAgent(runtimeAgentId, orgId), undefined);
      appIds.splice(appIds.indexOf(created.id), 1);
    });

    test('ownership conflicts roll back the entire App edit', async () => {
      const appA = await createInlineApp('Owner A');
      const stepA = appA.steps[0];
      if (stepA.kind !== 'agent') throw new Error('expected agent step');
      const runtimeAgentId = await defaultDeps().materializeAgent(appA, stepA, orgId);

      const appB = await createInlineApp('Owner B');
      const before = await getApp(appB.id, orgId);
      assert.ok(before);
      const conflictingSteps = structuredClone(before.steps);
      const stepB = conflictingSteps[0];
      if (stepB.kind !== 'agent') throw new Error('expected agent step');
      stepB.agentId = runtimeAgentId;

      await assert.rejects(
        () => updateApp(appB.id, orgId, { title: 'Must roll back', steps: conflictingSteps }),
        (error) => error instanceof AppAgentOwnershipError,
      );
      const afterRollback = await getApp(appB.id, orgId);
      assert.equal(afterRollback?.title, 'Owner B');
      assert.deepEqual(afterRollback?.steps, before.steps);
      assert.equal((await getCustomAgent(runtimeAgentId, orgId))?.ownerAppId, appA.id);
    });
  },
);
