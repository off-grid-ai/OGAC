import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { dispatchAgentRun } from '../src/lib/agent-run-dispatch.ts';
import type { AgentRunWorkflowInput } from '../src/lib/agent-run-durable.ts';
import { AgentPipelineBindingError, resolveAgentRunBinding } from '../src/lib/pipeline-run-glue.ts';
import { createPipeline, deletePipeline, updatePipeline } from '../src/lib/pipelines.ts';
import { createCustomAgent, deleteCustomAgent, updateCustomAgent } from '../src/lib/store.ts';
import { runAgentPipeline } from '../src/worker/agent-run.activities.ts';
// @ts-expect-error shared JS reachability helper
import { dbAvailable } from './helpers/db-available.mjs';

const available = await dbAvailable();
const skip = available.ok ? undefined : available.reason;

describe('real sync dispatch and Temporal activity fail closed on stale bindings', { skip }, () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const orgId = `binding_runtime_${suffix}`;
  const owner = `owner_${suffix}@test.local`;
  const pipelineA = `pl_runtime_a_${suffix}`;
  const pipelineB = `pl_runtime_b_${suffix}`;
  let agentId = '';
  const oldQueue = process.env.OFFGRID_QUEUE_ENABLED;
  const oldAdapter = process.env.OFFGRID_ADAPTER_AGENTRUNTIME;

  before(async () => {
    delete process.env.OFFGRID_QUEUE_ENABLED;
    delete process.env.OFFGRID_ADAPTER_AGENTRUNTIME;
    await createPipeline({ id: pipelineA, name: 'Runtime A', status: 'published' }, owner, orgId);
    await createPipeline({ id: pipelineB, name: 'Runtime B', status: 'published' }, owner, orgId);
    const agent = await createCustomAgent(
      { name: 'Bound claims agent', systemPrompt: 'Decide the claim.', pipelineId: pipelineA },
      orgId,
    );
    agentId = agent.id;
  });

  after(async () => {
    if (oldQueue === undefined) delete process.env.OFFGRID_QUEUE_ENABLED;
    else process.env.OFFGRID_QUEUE_ENABLED = oldQueue;
    if (oldAdapter === undefined) delete process.env.OFFGRID_ADAPTER_AGENTRUNTIME;
    else process.env.OFFGRID_ADAPTER_AGENTRUNTIME = oldAdapter;
    if (agentId) await deleteCustomAgent(agentId, orgId).catch(() => {});
    await deletePipeline(pipelineA, orgId).catch(() => {});
    await deletePipeline(pipelineB, orgId).catch(() => {});
  });

  test('deprecated, changed, and deleted bindings stop before retrieval or model I/O', async () => {
    const dispatchBinding = await resolveAgentRunBinding(agentId, orgId);
    assert.equal(dispatchBinding.state, 'bound');

    // Simulate stale/corrupt state below the consumer-aware lifecycle service. The real sync
    // dispatcher must reject during binding resolution, before it can enter runAgent.
    await updatePipeline(pipelineA, { status: 'deprecated' }, orgId, owner);
    await assert.rejects(
      () =>
        dispatchAgentRun({
          agentId,
          query: 'decide claim 42',
          caller: owner,
          orgId,
          asker: { subject: owner, roles: ['admin'] },
        }),
      (error) =>
        error instanceof AgentPipelineBindingError && error.binding.code === 'pipeline_unavailable',
    );

    // Temporal runs carry the dispatch-time discriminated result and re-resolve at activity time.
    // A pipeline deprecated between those points is rejected by the real activity before runAgent.
    const workflowInput: AgentRunWorkflowInput = {
      agentId,
      query: 'decide claim 42',
      runId: `run_${suffix}`,
      caller: owner,
      orgId,
      asker: { subject: owner, roles: ['admin'] },
      binding: dispatchBinding,
    };
    await assert.rejects(
      () => runAgentPipeline(workflowInput),
      (error) =>
        error instanceof AgentPipelineBindingError && error.binding.code === 'pipeline_unavailable',
    );

    // Rebind after submission: both pipelines are valid, but the serialized binding no longer
    // matches the agent. The activity detects the race instead of silently switching contracts.
    await updatePipeline(pipelineA, { status: 'published' }, orgId, owner);
    await updateCustomAgent(agentId, { pipelineId: pipelineB }, orgId);
    await assert.rejects(
      () => runAgentPipeline(workflowInput),
      (error) =>
        error instanceof AgentPipelineBindingError && error.binding.code === 'binding_changed',
    );

    // A deleted explicit binding is also invalid on the direct sync entry point.
    await deletePipeline(pipelineB, orgId);
    await assert.rejects(
      () => dispatchAgentRun({ agentId, query: 'decide claim 43', caller: owner, orgId }),
      (error) =>
        error instanceof AgentPipelineBindingError && error.binding.code === 'pipeline_unavailable',
    );
  });
});
