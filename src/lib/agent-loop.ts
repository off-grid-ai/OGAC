// ─── ReAct agent loop — PURE, zero-IO reasoning/tool-use core (Agentic Epic) ─────────────────────
//
// The BRAIN of a framework-grade smart agent (CrewAI / LangChain / Agno / AutoGen-class): a
// plan → act → observe → iterate loop. Given a goal, the tools the agent may use, and the trajectory
// so far (past tool calls + their observations), it asks the injected model for the NEXT action —
// either "call tool X with args" or "finish with this answer" — enforces a hard max-iterations
// budget, and detects loops / no-progress so a confused agent halts instead of spinning.
//
// PURITY (the whole point — see tenancy-policy.ts / agent-run-context.ts): this module performs NO
// I/O. The two effectful capabilities — asking the model to plan, and executing a tool — are INJECTED
// as async functions (`planNext`, `callTool`). That makes every decision here exhaustively
// unit-testable with fake deps and no mocks, and — critically — means the loop CANNOT reach the
// gateway or a tool except through the deps the caller (agentrun.ts) wires to the GOVERNED path
// (guardrails/PII on the model call, the audited tool primitives on the tool call). Governance is
// enforced by construction: the loop can only ever call a tool the caller listed in `tools` and only
// through the `callTool` the caller injected.

// ─── AgentTool — one tool the planner may choose, as the loop sees it ─────────────────────────────
// A pure descriptor: a stable ref (the pipeline's tool-ref space — `prim:<id>` / `app:<id>` /
// `tool:<id>`), a human name + description for the planner's prompt, and the param keys it accepts.
export interface AgentTool {
  ref: string;
  name: string;
  description: string;
  /** Parameter keys the tool accepts (used only to describe the tool to the planner). */
  paramKeys?: string[];
}

// ─── AgentAction — the planner's decision for one turn (a discriminated union) ────────────────────
export type AgentAction =
  | { kind: 'tool'; ref: string; args: Record<string, unknown>; thought?: string }
  | { kind: 'finish'; answer: string; thought?: string };

// ─── ToolObservation — the recorded result of executing one tool call ─────────────────────────────
export interface ToolObservation {
  ref: string;
  args: Record<string, unknown>;
  /** Did the tool run successfully? A failed/blocked/disabled tool still records an observation. */
  ok: boolean;
  /** The observation text the model sees on the next turn (tool output or an honest failure note). */
  observation: string;
}

// ─── LoopStepKind — how each entry of the trajectory is classified for provenance ────────────────
export type LoopStepKind = 'plan' | 'tool' | 'finish' | 'halt';

// ─── LoopStep — one entry of the agent's trajectory (fed back to the planner + recorded) ─────────
export interface LoopStep {
  kind: LoopStepKind;
  /** The model's reasoning for this turn, when it supplied one. */
  thought?: string;
  /** For a tool step: the tool ref + args + its observation. */
  tool?: ToolObservation;
  /** For a finish step: the final answer. */
  answer?: string;
  /** For a halt step: why the loop stopped (budget / no-progress / no tools). */
  haltReason?: string;
}

// ─── HaltReason — why a loop terminated WITHOUT the model choosing to finish ──────────────────────
export type HaltReason =
  | 'budget-exhausted' // hit the max-iterations (or max-tool-calls) ceiling
  | 'no-progress' // the model repeated an identical tool call whose observation didn't change
  | 'unknown-tool' // the model asked for a tool not in the allowed set (governance stop)
  | 'planner-error'; // the injected planner threw / returned an unparseable action

// ─── LoopResult — the terminal outcome of the whole loop ──────────────────────────────────────────
export interface LoopResult {
  /** The answer the agent settled on. Present whether it finished cleanly or was forced to halt
   *  (on a halt we surface the best answer we have, or an honest "could not complete" note). */
  answer: string;
  /** True iff the model chose to finish; false when the loop was force-halted (budget/no-progress/…). */
  finished: boolean;
  /** Populated when finished === false. */
  haltReason: HaltReason | null;
  /** The full trajectory — every plan/tool/finish/halt step, in order, for provenance. */
  trajectory: LoopStep[];
  /** How many planning iterations the loop actually ran (≤ maxIterations). */
  iterations: number;
  /** How many tool calls were dispatched. */
  toolCalls: number;
}

// ─── The injected effectful dependencies ──────────────────────────────────────────────────────────
export interface PlanInput {
  goal: string;
  tools: AgentTool[];
  /** The trajectory so far (past tool calls + observations). Empty on the first turn. */
  history: LoopStep[];
  /** 0-based iteration index (so the planner can be told how much budget remains). */
  iteration: number;
  /** The hard ceiling — the planner is told to wrap up as it approaches this. */
  maxIterations: number;
}

/** Ask the model for the next action. Injected → routes through the GOVERNED gateway path in prod,
 *  a deterministic fake in tests. MUST resolve to a valid AgentAction; if it throws, the loop
 *  catches it and halts with 'planner-error'. */
export type PlanNext = (input: PlanInput) => Promise<AgentAction>;

/** Execute one tool call. Injected → routes through the GOVERNED, audited tool path
 *  (maybeRunComposableTool / sandbox) in prod, a fake in tests. MUST NOT throw — a failure is
 *  reported as { ok:false, observation } so the loop can let the model react to it. */
export type CallTool = (ref: string, args: Record<string, unknown>) => Promise<ToolObservation>;

export interface AgentLoopConfig {
  goal: string;
  tools: AgentTool[];
  planNext: PlanNext;
  callTool: CallTool;
  /** Hard ceiling on planning iterations. Must be ≥ 1; defaults to 6. Clamped to [1, 20]. */
  maxIterations?: number;
  /** Optional cap on total tool calls (defence-in-depth alongside maxIterations). Defaults to
   *  maxIterations. */
  maxToolCalls?: number;
}

const DEFAULT_MAX_ITERATIONS = 6;
const MAX_ITERATIONS_CEILING = 20;

export function clampIterations(n: number | undefined): number {
  const v = Math.floor(n ?? DEFAULT_MAX_ITERATIONS);
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(v, MAX_ITERATIONS_CEILING);
}

// A stable signature for a tool call, used for no-progress detection: the same ref + same args
// yielding the same observation twice means the agent is stuck repeating itself.
function callSignature(ref: string, args: Record<string, unknown>): string {
  // Deterministic key regardless of arg insertion order.
  const keys = Object.keys(args).sort();
  const norm = keys.map((k) => `${k}=${JSON.stringify(args[k])}`).join('&');
  return `${ref}?${norm}`;
}

// ─── runAgentLoop — the pure ReAct executor ───────────────────────────────────────────────────────
// Runs plan → act → observe until the model FINISHES or a stop condition trips:
//   • budget-exhausted — reached maxIterations (or maxToolCalls) without finishing;
//   • no-progress — the model repeated a tool call it already made AND the observation was identical
//     (a genuine loop); a repeat that yields a NEW observation is allowed (legit retry/pagination);
//   • unknown-tool — the model asked for a tool outside the allowed set (governance: refuse, halt);
//   • planner-error — the injected planner threw or returned garbage.
// On any halt we still return the best answer we have (the last finish-intent text, else an honest
// "could not complete within N steps" note) so the caller always has something to persist + sign.
export async function runAgentLoop(config: AgentLoopConfig): Promise<LoopResult> {
  const maxIterations = clampIterations(config.maxIterations);
  const maxToolCalls = clampIterations(config.maxToolCalls ?? maxIterations);
  const allowed = new Set(config.tools.map((t) => t.ref));
  const trajectory: LoopStep[] = [];
  const seen = new Map<string, string>(); // callSignature → last observation
  let toolCalls = 0;
  let iteration = 0;

  const halt = (reason: HaltReason, answer: string): LoopResult => {
    trajectory.push({ kind: 'halt', haltReason: reason });
    return { answer, finished: false, haltReason: reason, trajectory, iterations: iteration, toolCalls };
  };

  while (iteration < maxIterations) {
    // 1. PLAN — ask the model for the next action. Any failure → halt honestly (don't spin).
    let action: AgentAction;
    try {
      action = await config.planNext({
        goal: config.goal,
        tools: config.tools,
        history: trajectory,
        iteration,
        maxIterations,
      });
    } catch (err) {
      return halt(
        'planner-error',
        `Agent could not plan the next step: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    iteration += 1;

    // 2a. FINISH — the model decided it's done. Record + return the answer.
    if (action.kind === 'finish') {
      trajectory.push({ kind: 'finish', thought: action.thought, answer: action.answer });
      return {
        answer: action.answer,
        finished: true,
        haltReason: null,
        trajectory,
        iterations: iteration,
        toolCalls,
      };
    }

    // 2b. TOOL — the model wants to call a tool.
    // Governance stop: the loop can ONLY call a tool the caller declared. An unknown ref is refused
    // (the caller's `tools` is the pipeline-allowed set) rather than dispatched.
    if (!allowed.has(action.ref)) {
      trajectory.push({ kind: 'plan', thought: action.thought });
      return halt('unknown-tool', `Agent requested a tool it is not permitted to use: "${action.ref}".`);
    }

    // Tool-call budget (defence-in-depth): if we've already spent the tool budget, stop rather than
    // exceed it even if planning iterations remain.
    if (toolCalls >= maxToolCalls) {
      return halt('budget-exhausted', bestEffortAnswer(trajectory, maxIterations));
    }

    // 3. ACT + OBSERVE — execute the tool through the injected (governed) path. It never throws.
    const obs = await config.callTool(action.ref, action.args);
    toolCalls += 1;
    trajectory.push({ kind: 'tool', thought: action.thought, tool: obs });

    // 4. NO-PROGRESS detection — if this exact call was made before AND the observation is identical,
    // the agent is stuck in a loop. Halt with the best answer we have. A repeat that produced a NEW
    // observation is legitimate (retry / next page) and allowed to continue.
    const sig = callSignature(action.ref, action.args);
    const prior = seen.get(sig);
    if (prior !== undefined && prior === obs.observation) {
      return halt('no-progress', bestEffortAnswer(trajectory, maxIterations));
    }
    seen.set(sig, obs.observation);
  }

  // Ran out of iterations without the model finishing.
  return halt('budget-exhausted', bestEffortAnswer(trajectory, maxIterations));
}

// The answer to surface when the loop is force-halted: prefer the most recent successful tool
// observation (the agent's best evidence), else an honest note. Never fabricate a conclusion.
function bestEffortAnswer(trajectory: LoopStep[], maxIterations: number): string {
  for (let i = trajectory.length - 1; i >= 0; i--) {
    const step = trajectory[i];
    if (step.kind === 'tool' && step.tool?.ok && step.tool.observation.trim()) {
      return `Agent did not reach a final answer within its step budget (${maxIterations} steps). Latest finding: ${step.tool.observation.trim()}`;
    }
  }
  return `Agent did not reach a final answer within its step budget (${maxIterations} steps).`;
}

// ─── parseAgentAction — tolerant parser from a model's JSON reply to an AgentAction (PURE) ───────
// The governed planner (agentrun.ts) prompts the model to answer with a compact JSON object; models
// wrap JSON in prose or fences, so this extracts the first JSON object and maps it to an action.
// Returns null when no valid action can be recovered — the caller decides whether to retry or finish.
export function parseAgentAction(raw: string): AgentAction | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;

  const act = typeof o.action === 'string' ? o.action.toLowerCase() : '';
  const thought = typeof o.thought === 'string' ? o.thought : undefined;

  // finish: { action: "finish", answer: "..." } (also accept { finish: "..." } / a bare answer).
  if (act === 'finish' || typeof o.answer === 'string' || typeof o.finish === 'string') {
    const answer =
      typeof o.answer === 'string'
        ? o.answer
        : typeof o.finish === 'string'
          ? o.finish
          : '';
    if (answer.trim()) return { kind: 'finish', answer: answer.trim(), thought };
  }

  // tool: { action: "tool", tool|ref: "prim:web_search", args: {...} }
  let ref: string | undefined;
  if (typeof o.tool === 'string') ref = o.tool;
  else if (typeof o.ref === 'string') ref = o.ref;
  if ((act === 'tool' || ref) && ref) {
    const args =
      o.args && typeof o.args === 'object' && !Array.isArray(o.args)
        ? (o.args as Record<string, unknown>)
        : {};
    return { kind: 'tool', ref, args, thought };
  }
  return null;
}

// Extract the first balanced {...} JSON object from arbitrary model text (handles code fences +
// surrounding prose). Brace-counting, string-aware so a `}` inside a string doesn't close early.
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ─── buildPlannerPrompt — the PURE prompt builder for the governed planner (no I/O) ──────────────
// Renders the ReAct instruction the model sees each turn: the goal, the tool catalog, the trajectory
// so far, and the remaining budget, with a strict "reply with ONE JSON action" contract. Kept pure so
// the exact prompt is unit-testable and stable. agentrun.ts feeds this to the GOVERNED gateway call.
export function buildPlannerPrompt(input: PlanInput): string {
  const remaining = input.maxIterations - input.iteration;
  const toolLines = input.tools.length
    ? input.tools
        .map(
          (t) =>
            `  - ${t.ref} (${t.name}): ${t.description}${
              t.paramKeys?.length ? ` [args: ${t.paramKeys.join(', ')}]` : ''
            }`,
        )
        .join('\n')
    : '  (no tools available — you must finish from what you know)';

  const historyLines = input.history
    .filter((s) => s.kind === 'tool' && s.tool)
    .map((s, i) => {
      const tool = s.tool!;
      const args = JSON.stringify(tool.args);
      return `  ${i + 1}. called ${tool.ref} ${args} → ${tool.ok ? '' : '[failed] '}${tool.observation.slice(0, 500)}`;
    })
    .join('\n');

  return [
    `You are an autonomous agent working toward a goal. Think step by step, use tools when they help, and finish when you can answer.`,
    ``,
    `GOAL: ${input.goal}`,
    ``,
    `TOOLS YOU MAY USE:`,
    toolLines,
    ``,
    historyLines ? `WHAT YOU HAVE DONE SO FAR:\n${historyLines}\n` : `You have not taken any actions yet.\n`,
    `You have ${remaining} step(s) of budget left. When the budget is low, finish with your best answer rather than calling another tool.`,
    ``,
    `Reply with EXACTLY ONE JSON object and nothing else:`,
    `  - To use a tool: {"action":"tool","tool":"<tool-ref>","args":{...},"thought":"why"}`,
    `  - To finish:     {"action":"finish","answer":"<your final answer>","thought":"why"}`,
  ].join('\n');
}
