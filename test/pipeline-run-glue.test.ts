import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PipelineView } from '@/lib/pipelines';
import {
  type ChatBindingIO,
  isAgentPipelineBindingValid,
  resolveAgentBinding,
  resolveChatBinding,
} from '@/lib/pipeline-run-glue';

// PA-16b — the I/O glue that resolves the enforceable contract for the agent + chat run paths. These
// exercise the REAL pure binding resolution (explicit agent binding / resolveChatPipeline). DB reads
// are injected only at their external boundary. The point they prove: an agent never inherits chat,
// contract lookup remains org-scoped, and a no-binding run degrades to a null contract.

test('resolveAgentBinding — no agent binding means no contract (never inherits chat default)', async () => {
  let requested: string | null | undefined = 'not-called';
  const r = await resolveAgentBinding(null, 'org_a', async (pipelineId, orgId) => {
    requested = pipelineId;
    assert.equal(orgId, 'org_a');
    return null;
  });
  assert.equal(r.pipelineId, null);
  assert.equal(r.contract, null);
  assert.equal(requested, null);
});

test('resolveAgentBinding — explicit agent binding is loaded within the run org', async () => {
  const r = await resolveAgentBinding('pl_agent', 'org_a', async (pipelineId, orgId) => {
    assert.equal(pipelineId, 'pl_agent');
    assert.equal(orgId, 'org_a');
    return null;
  });
  assert.equal(r.pipelineId, 'pl_agent');
});

test('agent binding validation is org-scoped and null is deliberately valid', async () => {
  let lookups = 0;
  const lookup = async (id: string, orgId: string) => {
    lookups += 1;
    assert.equal(id, 'pl_a');
    assert.equal(orgId, 'org_a');
    return { id, status: 'published' } as PipelineView;
  };
  assert.equal(await isAgentPipelineBindingValid(null, 'org_a', lookup), true);
  assert.equal(lookups, 0);
  assert.equal(await isAgentPipelineBindingValid('pl_a', 'org_a', lookup), true);
  assert.equal(lookups, 1);
  assert.equal(await isAgentPipelineBindingValid('pl_b', 'org_a', async () => null), false);
  assert.equal(
    await isAgentPipelineBindingValid(
      'pl_draft',
      'org_a',
      async () => ({ id: 'pl_draft', status: 'draft' }) as PipelineView,
    ),
    false,
  );
});

function chatIO(over: Partial<ChatBindingIO> = {}): ChatBindingIO {
  return {
    async getProjectBinding() {
      return { pipelineId: null };
    },
    async getChatBindingGovernance() {
      return { defaultChatPipelineId: null, allowlist: [] };
    },
    ...over,
  };
}

test('resolveChatBinding — no project binding + no org default ⇒ null (legacy behaviour)', async () => {
  const r = await resolveChatBinding('proj1', 'default', chatIO());
  assert.equal(r.pipelineId, null);
  assert.equal(r.contract, null);
});

test('resolveChatBinding — inherits the org default when the project pins nothing', async () => {
  const r = await resolveChatBinding(
    'proj1',
    'default',
    chatIO({
      async getChatBindingGovernance() {
        return { defaultChatPipelineId: 'pl_org', allowlist: [] };
      },
    }),
  );
  assert.equal(r.pipelineId, 'pl_org');
});

test('resolveChatBinding — a project override IN the available set wins over the org default', async () => {
  const r = await resolveChatBinding(
    'proj1',
    'default',
    chatIO({
      async getProjectBinding() {
        return { pipelineId: 'pl_proj' };
      },
      async getChatBindingGovernance() {
        return { defaultChatPipelineId: 'pl_org', allowlist: ['pl_proj'] };
      },
    }),
  );
  assert.equal(r.pipelineId, 'pl_proj');
});

test('resolveChatBinding — a project override NOT in the available set falls back to the org default (governance)', async () => {
  const r = await resolveChatBinding(
    'proj1',
    'default',
    chatIO({
      async getProjectBinding() {
        return { pipelineId: 'pl_removed' };
      },
      async getChatBindingGovernance() {
        return { defaultChatPipelineId: 'pl_org', allowlist: [] };
      },
    }),
  );
  // pl_removed is not in {default, allowlist} ⇒ resolveChatPipeline drops it → org default.
  assert.equal(r.pipelineId, 'pl_org');
});
