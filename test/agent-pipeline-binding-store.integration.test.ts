import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { sql } from 'drizzle-orm';
// @ts-expect-error — shared JS reachability helper intentionally has no declaration file
import { dbAvailable } from './helpers/db-available.mjs';

const { ok, reason } = await dbAvailable();
const skip = ok ? undefined : reason;

describe('agent pipeline binding persistence + tenant isolation (real Postgres)', { skip }, () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const orgA = `agent_bind_a_${suffix}`;
  const orgB = `agent_bind_b_${suffix}`;
  const pipelineA = `pl_agent_a_${suffix}`;
  const pipelineB = `pl_agent_b_${suffix}`;
  let agentA = '';
  let agentB = '';
  let store: typeof import('../src/lib/store.ts');
  let pipelines: typeof import('../src/lib/pipelines.ts');
  let binding: typeof import('../src/lib/pipeline-run-glue.ts');
  let database: typeof import('../src/db/index.ts');

  before(async () => {
    store = await import('../src/lib/store.ts');
    pipelines = await import('../src/lib/pipelines.ts');
    binding = await import('../src/lib/pipeline-run-glue.ts');
    database = await import('../src/db/index.ts');

    // This is the live bootstrap path used on an upgraded database. It must add pipeline_id before
    // any agent read/write; asserting information_schema catches a schema.ts-only implementation.
    await store.ensureOrgSchema();
    const column = await database.db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'custom_agents' AND column_name = 'pipeline_id'
    `);
    assert.equal(column.rows.length, 1, 'ensureOrgSchema must bootstrap custom_agents.pipeline_id');

    await pipelines.createPipeline(
      { id: pipelineA, name: 'Agent A pipeline', status: 'published' },
      'owner_a',
      orgA,
    );
    await pipelines.createPipeline(
      { id: pipelineB, name: 'Agent B pipeline', status: 'published' },
      'owner_b',
      orgB,
    );
  });

  after(async () => {
    if (agentA) await store.deleteCustomAgent(agentA, orgA).catch(() => {});
    if (agentB) await store.deleteCustomAgent(agentB, orgB).catch(() => {});
    await pipelines.deletePipeline(pipelineA, orgA).catch(() => {});
    await pipelines.deletePipeline(pipelineB, orgB).catch(() => {});
  });

  test('create/read/update round-trips pipeline_id and null clears it', async () => {
    const created = await store.createCustomAgent(
      { name: 'A agent', systemPrompt: 'Help A', pipelineId: pipelineA },
      orgA,
    );
    agentA = created.id;
    assert.equal(created.pipelineId, pipelineA);
    assert.equal((await store.getCustomAgent(agentA, orgA))?.pipelineId, pipelineA);
    assert.equal(
      (await store.listCustomAgents(orgA)).find((agent) => agent.id === agentA)?.pipelineId,
      pipelineA,
    );

    assert.equal(
      (await store.updateCustomAgent(agentA, { pipelineId: null }, orgA))?.pipelineId,
      null,
    );
    assert.equal(
      (await store.updateCustomAgent(agentA, { pipelineId: pipelineA }, orgA))?.pipelineId,
      pipelineA,
    );
  });

  test('cross-org pipeline validation and agent reads reject tenant B state', async () => {
    const created = await store.createCustomAgent(
      { name: 'B agent', systemPrompt: 'Help B', pipelineId: pipelineB },
      orgB,
    );
    agentB = created.id;

    assert.equal(
      await binding.isAgentPipelineBindingValid(pipelineB, orgA),
      false,
      'org A cannot bind a pipeline owned by org B',
    );
    assert.equal(await binding.isAgentPipelineBindingValid(pipelineB, orgB), true);
    assert.equal(await store.getCustomAgent(agentB, orgA), undefined, 'org A cannot read B agent');
    assert.equal((await store.getCustomAgent(agentB, orgB))?.pipelineId, pipelineB);
  });
});
