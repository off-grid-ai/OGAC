import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp, deleteApp, updateApp } from '../src/lib/apps-store.ts';
import { createProject, deleteProject } from '../src/lib/chat.ts';
import { listPipelineConsumers } from '../src/lib/pipeline-consumers.ts';
import { transitionPipeline } from '../src/lib/pipeline-lifecycle.ts';
import { deleteUnusedPipeline } from '../src/lib/pipeline-retirement.ts';
import { createPipeline, deletePipeline } from '../src/lib/pipelines.ts';
import { createCustomAgent, deleteCustomAgent } from '../src/lib/store.ts';
// @ts-expect-error plain JS reachability helper
import { dbAvailable } from './helpers/db-available.mjs';

const available = await dbAvailable();
const skip = available.ok ? undefined : available.reason;

describe('pipeline retirement is consumer-aware (real Postgres)', { skip }, () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const orgId = `retire_${suffix}`;
  const owner = `owner_${suffix}@test.local`;
  const pipelineId = `pl_retire_${suffix}`;
  let appId = '';
  let agentId = '';
  let projectId = '';

  before(async () => {
    await createPipeline(
      { id: pipelineId, name: 'Claims pipeline', status: 'published' },
      owner,
      orgId,
    );
    const app = await createApp(orgId, owner, {
      title: 'Claims agent',
      summary: '',
      visibility: 'private',
      trigger: { kind: 'on-demand' },
      steps: [
        {
          id: 'agent',
          label: 'Decide claim',
          kind: 'agent',
          inlineAgent: { systemPrompt: 'Decide this claim.' },
        },
      ],
      edges: [],
      pipelineId,
    });
    appId = app.id;
    const agent = await createCustomAgent(
      { name: 'Claims runtime', systemPrompt: 'Decide this claim.', pipelineId },
      orgId,
    );
    agentId = agent.id;
    projectId = await createProject(owner, orgId, 'Claims chat', '', pipelineId);
  });

  after(async () => {
    if (appId) await deleteApp(appId, orgId).catch(() => {});
    if (agentId) await deleteCustomAgent(agentId, orgId).catch(() => {});
    if (projectId) await deleteProject(owner, projectId).catch(() => {});
    await deletePipeline(pipelineId, orgId).catch(() => {});
  });

  test('inventory is org-scoped and covers app, runtime agent, and chat project', async () => {
    const consumers = await listPipelineConsumers(pipelineId, orgId);
    assert.deepEqual(
      new Set(consumers.map((consumer) => consumer.kind)),
      new Set(['app', 'runtime_agent', 'chat_project']),
    );
    assert.deepEqual(await listPipelineConsumers(pipelineId, `other_${orgId}`), []);
  });

  test('deprecate and delete refuse while any consumer remains', async () => {
    const transitioned = await transitionPipeline(
      pipelineId,
      'deprecate',
      { email: owner, role: 'admin' },
      { orgId },
    );
    assert.equal(transitioned.ok, false);
    assert.equal(transitioned.blocked, true);
    assert.equal(transitioned.consumers?.length, 3);

    const deleted = await deleteUnusedPipeline(pipelineId, orgId);
    assert.equal(deleted.ok, false);
    assert.equal(deleted.reason, 'in_use');
  });

  test('deletion succeeds only after every consumer is explicitly detached', async () => {
    await updateApp(appId, orgId, { pipelineId: null });
    await deleteCustomAgent(agentId, orgId);
    agentId = '';
    await deleteProject(owner, projectId);
    projectId = '';
    assert.deepEqual(await listPipelineConsumers(pipelineId, orgId), []);
    const deleted = await deleteUnusedPipeline(pipelineId, orgId);
    assert.deepEqual(deleted, { ok: true, deleted: true, consumers: [] });
  });
});
