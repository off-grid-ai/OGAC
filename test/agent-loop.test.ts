import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type AgentAction,
  type AgentTool,
  type PlanInput,
  type ToolObservation,
  buildPlannerPrompt,
  clampIterations,
  parseAgentAction,
  runAgentLoop,
} from '../src/lib/agent-loop.ts';

// PURE unit tests for the ReAct agent loop (Agentic Epic). No I/O — the model (planNext) and the
// tool (callTool) are injected fakes, so every planning/budget/halt/dispatch decision is exercised
// with real functions and no mocking framework.

const TOOLS: AgentTool[] = [
  { ref: 'prim:web_search', name: 'Web search', description: 'search the web', paramKeys: ['query'] },
  { ref: 'prim:read_url', name: 'Read URL', description: 'read a page', paramKeys: ['url'] },
];

function okObs(ref: string, args: Record<string, unknown>, observation: string): ToolObservation {
  return { ref, args, ok: true, observation };
}

// A planner driven by a fixed script of actions (advances one per call).
function scriptedPlanner(script: AgentAction[]) {
  let i = 0;
  return async (_input: PlanInput): Promise<AgentAction> => {
    const a = script[Math.min(i, script.length - 1)];
    i += 1;
    return a;
  };
}

test('plan→act→observe→finish: dispatches the chosen tool, then returns the finish answer', async () => {
  const calls: { ref: string; args: Record<string, unknown> }[] = [];
  const result = await runAgentLoop({
    goal: 'find the capital of France',
    tools: TOOLS,
    planNext: scriptedPlanner([
      { kind: 'tool', ref: 'prim:web_search', args: { query: 'capital of France' } },
      { kind: 'finish', answer: 'Paris' },
    ]),
    callTool: async (ref, args) => {
      calls.push({ ref, args });
      return okObs(ref, args, 'Paris is the capital of France');
    },
  });

  assert.equal(result.finished, true);
  assert.equal(result.haltReason, null);
  assert.equal(result.answer, 'Paris');
  assert.equal(result.toolCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ref, 'prim:web_search');
  // Trajectory records the tool step then the finish step.
  assert.equal(result.trajectory.filter((s) => s.kind === 'tool').length, 1);
  assert.equal(result.trajectory.at(-1)?.kind, 'finish');
});

test('BUDGET: a planner that never finishes halts at maxIterations (budget-exhausted)', async () => {
  let toolRuns = 0;
  const result = await runAgentLoop({
    goal: 'loop forever',
    tools: TOOLS,
    maxIterations: 3,
    // Each turn calls a tool with a DIFFERENT arg so no-progress never trips — only the budget stops it.
    planNext: async (input) => ({
      kind: 'tool',
      ref: 'prim:web_search',
      args: { query: `q${input.iteration}` },
    }),
    callTool: async (ref, args) => {
      toolRuns += 1;
      return okObs(ref, args, `result ${toolRuns}`);
    },
  });

  assert.equal(result.finished, false);
  assert.equal(result.haltReason, 'budget-exhausted');
  assert.equal(result.iterations, 3);
  assert.equal(toolRuns, 3);
  assert.match(result.answer, /step budget \(3 steps\)/);
  assert.match(result.answer, /Latest finding: result 3/);
});

test('NO-PROGRESS: identical tool call + identical observation halts (no-progress)', async () => {
  const result = await runAgentLoop({
    goal: 'stuck',
    tools: TOOLS,
    maxIterations: 10,
    // Always asks for the SAME call with the SAME args.
    planNext: async () => ({ kind: 'tool', ref: 'prim:web_search', args: { query: 'same' } }),
    callTool: async (ref, args) => okObs(ref, args, 'identical observation'),
  });

  assert.equal(result.finished, false);
  assert.equal(result.haltReason, 'no-progress');
  // First call establishes the signature; the second identical one trips the halt → 2 tool calls.
  assert.equal(result.toolCalls, 2);
});

test('NO-PROGRESS allows a legit retry: same call but a NEW observation continues', async () => {
  let n = 0;
  const result = await runAgentLoop({
    goal: 'paginate',
    tools: TOOLS,
    maxIterations: 5,
    planNext: scriptedPlanner([
      { kind: 'tool', ref: 'prim:web_search', args: { query: 'page' } },
      { kind: 'tool', ref: 'prim:web_search', args: { query: 'page' } },
      { kind: 'finish', answer: 'done' },
    ]),
    callTool: async (ref, args) => {
      n += 1;
      return okObs(ref, args, `page ${n}`); // observation changes each time → not a loop
    },
  });

  assert.equal(result.finished, true);
  assert.equal(result.answer, 'done');
  assert.equal(result.toolCalls, 2);
});

test('GOVERNANCE: requesting a tool outside the allowed set halts (unknown-tool), never dispatched', async () => {
  let dispatched = 0;
  const result = await runAgentLoop({
    goal: 'escape the sandbox',
    tools: TOOLS,
    planNext: async () => ({ kind: 'tool', ref: 'prim:http_fetch', args: { url: 'http://evil' } }),
    callTool: async (ref, args) => {
      dispatched += 1;
      return okObs(ref, args, 'should never run');
    },
  });

  assert.equal(dispatched, 0, 'a disallowed tool is never dispatched');
  assert.equal(result.finished, false);
  assert.equal(result.haltReason, 'unknown-tool');
  assert.match(result.answer, /not permitted to use/);
});

test('PLANNER-ERROR: a throwing planner halts honestly (planner-error), no spin', async () => {
  const result = await runAgentLoop({
    goal: 'boom',
    tools: TOOLS,
    planNext: async () => {
      throw new Error('gateway down');
    },
    callTool: async (ref, args) => okObs(ref, args, 'x'),
  });
  assert.equal(result.finished, false);
  assert.equal(result.haltReason, 'planner-error');
  assert.match(result.answer, /gateway down/);
});

test('a failed tool observation is fed back, not thrown — the model can react and finish', async () => {
  const seenHistory: number[] = [];
  const result = await runAgentLoop({
    goal: 'handle failure',
    tools: TOOLS,
    planNext: async (input) => {
      seenHistory.push(input.history.filter((s) => s.kind === 'tool').length);
      if (input.iteration === 0) {
        return { kind: 'tool', ref: 'prim:read_url', args: { url: 'http://x' } };
      }
      return { kind: 'finish', answer: 'gave up gracefully' };
    },
    callTool: async (ref, args) => ({ ref, args, ok: false, observation: 'read_url: 404' }),
  });

  assert.equal(result.finished, true);
  assert.equal(result.answer, 'gave up gracefully');
  // On the second plan the failed tool step is present in history.
  assert.deepEqual(seenHistory, [0, 1]);
  const toolStep = result.trajectory.find((s) => s.kind === 'tool');
  assert.equal(toolStep?.tool?.ok, false);
});

test('clampIterations bounds the budget to [1,20] and defaults to 6', () => {
  assert.equal(clampIterations(undefined), 6);
  assert.equal(clampIterations(0), 1);
  assert.equal(clampIterations(-5), 1);
  assert.equal(clampIterations(100), 20);
  assert.equal(clampIterations(4), 4);
  assert.equal(clampIterations(NaN), 1);
});

// ─── parseAgentAction — the tolerant JSON→action parser ──────────────────────────────────────────
test('parseAgentAction reads a tool action, incl. inside prose + code fences', () => {
  const a = parseAgentAction('Sure! ```json\n{"action":"tool","tool":"prim:web_search","args":{"query":"x"}}\n```');
  assert.deepEqual(a, { kind: 'tool', ref: 'prim:web_search', args: { query: 'x' }, thought: undefined });
});

test('parseAgentAction reads a finish action (action:finish and bare answer)', () => {
  assert.deepEqual(parseAgentAction('{"action":"finish","answer":"done"}'), {
    kind: 'finish',
    answer: 'done',
    thought: undefined,
  });
  assert.deepEqual(parseAgentAction('{"answer":"just this"}'), {
    kind: 'finish',
    answer: 'just this',
    thought: undefined,
  });
});

test('parseAgentAction returns null for junk / no JSON', () => {
  assert.equal(parseAgentAction('no json here'), null);
  assert.equal(parseAgentAction('{not valid'), null);
});

test('parseAgentAction handles a } inside a string value without closing early', () => {
  const a = parseAgentAction('{"action":"finish","answer":"use } braces"}');
  assert.deepEqual(a, { kind: 'finish', answer: 'use } braces', thought: undefined });
});

test('buildPlannerPrompt lists tools, the budget, and the JSON contract', () => {
  const prompt = buildPlannerPrompt({
    goal: 'test goal',
    tools: TOOLS,
    history: [
      { kind: 'tool', tool: { ref: 'prim:web_search', args: { query: 'x' }, ok: true, observation: 'found it' } },
    ],
    iteration: 1,
    maxIterations: 6,
  });
  assert.match(prompt, /GOAL: test goal/);
  assert.match(prompt, /prim:web_search/);
  assert.match(prompt, /5 step\(s\) of budget left/); // 6 - 1
  assert.match(prompt, /"action":"finish"/);
  assert.match(prompt, /called prim:web_search .* found it/);
});
