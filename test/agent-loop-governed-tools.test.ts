import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAgentLoop, type ToolObservation } from '../src/lib/agent-loop.ts';
import { runPrimitive } from '../src/lib/adapters/tool-primitives.ts';

// INTEGRATION-ish: the pure loop dispatches tool calls through the REAL governed primitive path
// (runPrimitive), proving that autonomy stays inside governance by construction — the loop cannot
// reach the internet except through the air-gap gate + action-policy the adapter enforces. No mocks:
// runPrimitive is the real function; we only inject it as the loop's callTool (as agentrun.ts does
// via maybeRunComposableTool).

// Adapt the real governed primitive executor into the loop's CallTool signature.
async function governedCallTool(ref: string, args: Record<string, unknown>): Promise<ToolObservation> {
  const id = ref.replace(/^prim:/, '');
  // 'allow' policy + no egress env → the AIR-GAP gate must still refuse (disabled), honestly.
  const result = await runPrimitive(id, { policy: 'allow', params: args, env: {} });
  return { ref, args, ok: result.ok, observation: result.output ?? result.detail };
}

test('GOVERNED: a loop calling web_search through the real adapter is refused by the air-gap gate', async () => {
  const result = await runAgentLoop({
    goal: 'search the web for X',
    tools: [{ ref: 'prim:web_search', name: 'Web search', description: 'search', paramKeys: ['query'] }],
    maxIterations: 3,
    planNext: async (input) => {
      // First turn: try the tool. After observing the refusal, finish honestly.
      if (input.iteration === 0) return { kind: 'tool', ref: 'prim:web_search', args: { query: 'X' } };
      const lastObs = input.history.at(-1)?.tool?.observation ?? '';
      return { kind: 'finish', answer: `tool unavailable: ${lastObs}` };
    },
    callTool: governedCallTool,
  });

  assert.equal(result.toolCalls, 1);
  const toolStep = result.trajectory.find((s) => s.kind === 'tool');
  assert.equal(toolStep?.tool?.ok, false, 'the governed adapter refused the disabled internet primitive');
  assert.match(toolStep?.tool?.observation ?? '', /OFF on this deployment|opt in/i);
  // The loop fed the honest refusal back to the planner, which finished gracefully.
  assert.equal(result.finished, true);
  assert.match(result.answer, /tool unavailable/);
});

test('GOVERNED: an action-policy of "approval" is not run autonomously (deferred, not dispatched)', async () => {
  const result = await runAgentLoop({
    goal: 'do the thing',
    tools: [{ ref: 'prim:web_search', name: 'Web search', description: 'search', paramKeys: ['query'] }],
    maxIterations: 2,
    planNext: async (input) =>
      input.iteration === 0
        ? { kind: 'tool', ref: 'prim:web_search', args: { query: 'x' } }
        : { kind: 'finish', answer: 'done' },
    // The DEFAULT policy is 'approval' — the governed adapter must not execute it autonomously.
    callTool: async (ref, args) => {
      const id = ref.replace(/^prim:/, '');
      const result = await runPrimitive(id, { params: args, env: { OFFGRID_TOOL_EGRESS: '1' } });
      return { ref, args, ok: result.ok, observation: `${result.status}: ${result.detail}` };
    },
  });

  const toolStep = result.trajectory.find((s) => s.kind === 'tool');
  assert.equal(toolStep?.tool?.ok, false);
  assert.match(toolStep?.tool?.observation ?? '', /approval/);
});
