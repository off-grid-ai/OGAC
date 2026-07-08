import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ChatBindingIO,
  resolveAgentBinding,
  resolveChatBinding,
} from '@/lib/pipeline-run-glue';

// PA-16b — the I/O glue that resolves the enforceable contract for the agent + chat run paths. These
// exercise the REAL pure binding resolution (resolveConsumerPipeline / resolveChatPipeline) and the
// REAL resolveContract loader; only the DB reads are injected (chat) / naturally null (agent, since
// resolveContract fails open to null when it can't load — no DB in node:test). The point they prove:
// the binding is resolved most-specific-wins and a NO-binding run degrades to a null contract
// (legacy behaviour — the ADDITIVE guarantee).

test('resolveAgentBinding — no agent binding + no org default ⇒ pipelineId null, contract null (legacy)', async () => {
  const r = await resolveAgentBinding(null, null, 'default');
  assert.equal(r.pipelineId, null);
  assert.equal(r.contract, null);
});

test('resolveAgentBinding — org default wins when the agent has no own binding', async () => {
  // resolveConsumerPipeline(null, 'pl_org') === 'pl_org'; resolveContract fails open to null with no
  // DB, but the RESOLVED pipeline id proves the most-specific-wins fallback picked the org default.
  const r = await resolveAgentBinding(null, 'pl_org', 'default');
  assert.equal(r.pipelineId, 'pl_org');
});

test('resolveAgentBinding — the agent own binding beats the org default', async () => {
  const r = await resolveAgentBinding('pl_agent', 'pl_org', 'default');
  assert.equal(r.pipelineId, 'pl_agent');
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
