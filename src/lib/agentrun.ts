import { randomUUID } from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuns } from '@/db/schema';
import {
  getFlags,
  getGrounding,
  getLineage,
  getPii,
  getPolicy,
  getSandbox,
  getSigning,
} from '@/lib/adapters/registry';
import { maybeRunComposableTool } from '@/lib/adapters/tool-primitives';
import { type AgentDef, resolveAgent } from '@/lib/agents';
import { cacheLookup, cacheStore } from '@/lib/cache';
import { estimateTokens, projectBudget } from '@/lib/chat-governance';
import { costForTokens } from '@/lib/finops';
import { type CheckResult, outcomeFromChecks, runChecks } from '@/lib/checks';
import { emitRunTrace } from '@/lib/chat-trace';
import { correlationIds } from '@/lib/correlation';
import { shipRunAudit } from '@/lib/siem';
import { recordAudit } from '@/lib/store';
import { outcomeFromStatus } from '@/lib/audit-event';
import {
  effectiveRunId,
  type RunContext,
  resolveRunAttribution,
} from '@/lib/agent-run-context';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { emitSpan } from '@/lib/otel';
import { scoreInteraction } from '@/lib/qa/scoring';
import { route } from '@/lib/retrieval/router';
import type { RetrievalHit } from '@/lib/retrieval/types';
import { listTools } from '@/lib/store';
import { enforceDataAccess, enforceModelCall } from '@/lib/pipeline-enforcement';
import { auditEnforcement } from '@/lib/pipeline-contract';
import {
  type AgentTool,
  type LoopStep,
  type PlanInput,
  type ToolObservation,
  buildPlannerPrompt,
  parseAgentAction,
  runAgentLoop,
} from '@/lib/agent-loop';
import { buildAgentToolCatalog, isAutonomousAgent } from '@/lib/agent-tools-catalog';

// The canonical interaction pipeline. Every agent run flows through one ordered chain so that the
// platform's capabilities actually fire in-path, not just from admin endpoints:
//   policy gate → guardrails(in) → retrieve → answer (cache) → ground → guardrails(out)
//   → provenance-sign → persist → lineage (best-effort) → [async, sampled] online QA score.
// Safety checks run on every request; the LLM-as-judge score runs out-of-band (see scoreRun) so it
// never adds latency to the response.
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
const ANSWER_MODEL = process.env.OFFGRID_GROUNDING_MODEL ?? 'gemma-local';

export interface RunStep {
  kind: string;
  label: string;
  detail: string;
  refs: string[];
  ms: number;
}

export interface Citation {
  ref: string;
  title: string;
  snippet: string;
  score: number;
  supported: boolean;
}

export interface Provenance {
  signature: string;
  algorithm: string;
  publicKey: string | null;
  signedAt: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  query: string;
  answer: string;
  status: string;
  steps: RunStep[];
  citations: Citation[];
  checks: CheckResult[];
  provenance: Provenance | null;
  startedAt: string;
}

function extractText(data: unknown): string | null {
  const text = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message
    ?.content;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

// Compose the answer. `system` carries the agent's natural-language instruction (built-ins use a
// terse default); `model` lets a custom agent name a target, otherwise the gateway default applies
// (and the model-routing rules at the gateway still decide where it actually runs).
// Agent runs are the ASYNC inference path — when the Temporal queue is enabled
// (OFFGRID_QUEUE_ENABLED=1) they are ENQUEUED and drained at the worker's
// controlled rate, so a burst of agent runs can't overwhelm the nodes (there is
// no autoscale). Otherwise they hit the gateway directly. Dynamic import keeps
// @temporalio off the default path entirely.
const QUEUE_ENABLED = process.env.OFFGRID_QUEUE_ENABLED === '1';

// eslint-disable-next-line complexity
async function gatewayAnswer(
  query: string,
  context: string,
  system: string,
  model: string,
  caller?: string,
): Promise<string | null> {
  const body = {
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `SOURCES:\n${context}\n\nQUESTION: ${query}` },
    ],
    chat_template_kwargs: { enable_thinking: false },
  };

  if (QUEUE_ENABLED) {
    try {
      const { enqueueInference, getResult } = await import('@offgrid/gateway/queue');
      const cfg = {
        temporalAddress: process.env.OFFGRID_TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
        namespace: process.env.OFFGRID_TEMPORAL_NAMESPACE ?? 'default',
        taskQueue: process.env.OFFGRID_QUEUE_TASK_QUEUE ?? 'offgrid-inference',
        gatewayUrl: GATEWAY_URL,
      };
      const id = await enqueueInference({ body }, cfg);
      const res = await getResult(id, cfg);
      return res.status === 200 ? extractText(res.body) : null;
    } catch {
      /* queue unavailable — fall through to a direct call */
    }
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      // x-offgrid-user attributes the agent run's gateway spend to the invoking user (captured
      // as `caller` in the gateway's OpenSearch log) for per-user FinOps.
      headers: gatewayHeaders({
        'content-type': 'application/json',
        ...(caller ? { 'x-offgrid-user': caller } : {}),
      }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    return res.ok ? extractText(await res.json()) : null;
  } catch {
    return null;
  }
}

const DEFAULT_SYSTEM = 'Answer only from the provided sources, concisely.';
const UNGROUNDED_DEFAULT = 'You are a helpful assistant. Answer concisely.';

// Build the system prompt for a run. For a GROUNDED agent (the default) the grounding rule is
// always appended so it can't opt out of source-faithfulness. A non-grounded agent (grounded:false,
// e.g. a brainstorming/drafting assistant) answers from the model directly — no sources are
// retrieved for it, so forcing "answer only from sources" would make it uselessly refuse.
function systemFor(agent: AgentDef): string {
  const prompt = agent.systemPrompt?.trim();
  if (agent.grounded === false) return prompt || UNGROUNDED_DEFAULT;
  if (!prompt) return DEFAULT_SYSTEM;
  return `${prompt}\n\nGround every claim in the provided sources; if they don't cover the question, say so rather than inventing facts.`;
}

async function compose(
  query: string,
  hits: RetrievalHit[],
  agent: AgentDef,
  caller?: string,
): Promise<string> {
  const context = hits.map((h, i) => `[${i + 1}] ${h.title}: ${h.snippet}`).join('\n');
  const system = systemFor(agent);
  const model = agent.model || ANSWER_MODEL;
  // The system prompt + model are part of the cache key so different agents never collide.
  const cacheKey = `${model}\n${system}\n${query}\n${context}`;
  const cached = await cacheLookup(cacheKey);
  if (cached.hit && cached.answer) return cached.answer;
  const answer = await gatewayAnswer(query, context, system, model, caller);
  if (answer) {
    await cacheStore(cacheKey, answer);
    return answer;
  }
  return hits[0] ? `Based on ${hits.length} source(s): ${hits[0].snippet}` : 'No sources found.';
}

// Bound the ReAct step budget from env (OFFGRID_AGENT_MAX_ITERATIONS); the pure loop clamps to
// [1,20] regardless. Default 6.
function clampAgentIterations(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 20) : 6;
}

// ─── resolveAgentToolCatalog — I/O seam: an agent's declared refs → the planner's AgentTool[] ─────
// Reads the agent's tool refs (built-in tags are dropped by the pure catalog; only prim:/app:/tool:
// refs survive), resolves registry-tool + app-as-tool descriptors from the store (org-scoped), and
// applies the air-gap gate over primitives via the pure buildAgentToolCatalog. Best-effort: a store
// miss degrades to whatever resolved, never throws (an autonomous agent with an unresolvable tool
// simply doesn't expose it, and may fall back to the linear path).
async function resolveAgentToolCatalog(agent: AgentDef, orgId: string): Promise<AgentTool[]> {
  const refs = agent.tools ?? [];
  // Only touch the store if there are registry/app refs to resolve — built-ins (capability tags) and
  // primitive-only agents need no lookup.
  const appRefs = refs.filter((r) => r.startsWith('app:'));
  const registryRefs = refs.filter((r) => r.startsWith('tool:'));
  let registryTools: { ref: string; name: string; description: string }[] = [];
  let appTools: { ref: string; name: string; description: string }[] = [];
  try {
    if (registryRefs.length) {
      const tools = await listTools(orgId);
      registryTools = tools
        .filter((x) => registryRefs.includes(`tool:${x.id}`))
        .map((x) => ({ ref: `tool:${x.id}`, name: x.name, description: x.name }));
    }
    if (appRefs.length) {
      const { listApps } = await import('@/lib/apps-store');
      const apps = await listApps(orgId);
      appTools = apps
        .filter((a) => a.published && appRefs.includes(`app:${a.id}`))
        .map((a) => ({ ref: `app:${a.id}`, name: a.title, description: a.summary || a.title }));
    }
  } catch {
    /* best-effort — degrade to whatever resolved */
  }
  return buildAgentToolCatalog({
    refs,
    env: process.env as Record<string, string | undefined>,
    registryTools,
    appTools,
  });
}

// ─── The GOVERNED planner — the model call the pure agent-loop injects as `planNext` ─────────────
// The pure loop (agent-loop.ts) decides WHAT to do; this decides HOW the "what to do next" question
// reaches the model — through the SAME governed gateway path (gatewayAnswer → gateway + guardrails +
// FinOps attribution) as a normal answer. It builds the ReAct prompt (pure), calls the gateway, and
// parses the reply into an action. On an empty/unparseable reply it FINISHES with a best-effort note
// rather than looping blindly — the loop's budget still bounds it either way.
function makeGovernedPlanner(model: string, system: string, caller?: string) {
  return async (input: PlanInput) => {
    const prompt = buildPlannerPrompt(input);
    // The planner reply is NOT the final answer, so it must not be cached under the compose key;
    // call the gateway directly with the ReAct system + prompt.
    const reply = await gatewayAnswer(input.goal, prompt, system, model, caller);
    const action = reply ? parseAgentAction(reply) : null;
    if (action) return action;
    // No usable action — end the loop honestly with whatever the model said (or a fallback).
    return { kind: 'finish' as const, answer: reply?.trim() || 'Unable to determine a next step.' };
  };
}

// ─── The GOVERNED tool executor — the tool call the pure agent-loop injects as `callTool` ────────
// Every tool the planner chooses is dispatched through the EXISTING governed tool seam
// (maybeRunComposableTool: primitives re-check the air-gap gate + action-policy, apps run through the
// governed submitAppRun, all audited) or the sandbox path — never a raw fetch. `mark` records each
// dispatch as a run step so the trajectory shows up in the trace/provenance. NEVER throws: a failure
// becomes an honest observation the model can react to next turn.
function makeGovernedToolExecutor(
  orgId: string,
  agentId: string,
  caller: string | undefined,
  mark: Mark,
) {
  return async (ref: string, args: Record<string, unknown>): Promise<ToolObservation> => {
    try {
      // Sandbox registry tools (tool:<id>) run through the sandbox path; primitives/apps through the
      // composable seam. Both are governed + audited. The composable path returns a structured result.
      await maybeRunSandboxTool(ref, mark);
      const result = await maybeRunComposableTool(
        ref,
        { orgId, actor: caller, callerAppId: agentId },
        mark,
        typeof args.query === 'string' ? args.query : JSON.stringify(args),
      );
      if (result === null) {
        // A registry tool handled by the sandbox path (or an unknown ref) — report what we can.
        return { ref, args, ok: true, observation: `tool ${ref} dispatched` };
      }
      const output =
        'output' in result && typeof result.output === 'string' && result.output.trim()
          ? result.output.trim()
          : result.detail;
      return { ref, args, ok: result.ok, observation: output };
    } catch (err) {
      return {
        ref,
        args,
        ok: false,
        observation: `tool ${ref} error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}

// Fold the loop's trajectory into the run's step list so the plan→act→observe iterations are visible
// in the trace + signed into provenance. Each planner turn and tool dispatch is one step.
function recordTrajectory(trajectory: LoopStep[], mark: Mark): void {
  for (const step of trajectory) {
    if (step.kind === 'tool' && step.tool) continue; // already marked by the tool executor's `mark`
    if (step.kind === 'finish') {
      mark('loop', 'finish', (step.answer ?? '').slice(0, 120), [], Date.now());
    } else if (step.kind === 'halt') {
      mark('loop', 'halt', step.haltReason ?? 'halted', [], Date.now());
    } else if (step.kind === 'plan') {
      mark('loop', 'plan', step.thought?.slice(0, 120) ?? 'planning', [], Date.now());
    }
  }
}

function toRun(row: { id: string; startedAt: Date | string }, v: Omit<AgentRun, 'id' | 'startedAt'>): AgentRun {
  return {
    ...v,
    id: row.id,
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt),
  };
}

// Persist a run and return the API shape. Shared by the denied / blocked / done paths.
async function persist(
  id: string,
  v: Omit<AgentRun, 'id' | 'startedAt'>,
  orgId: string = DEFAULT_ORG,
): Promise<AgentRun> {
  const [row] = await db
    .insert(agentRuns)
    .values({
      id,
      orgId,
      agentId: v.agentId,
      query: v.query,
      answer: v.answer,
      status: v.status,
      steps: v.steps,
      citations: v.citations,
      checks: v.checks,
      provenance: v.provenance,
    })
    .returning();
  return toRun(row, v);
}

function rowToRun(r: typeof agentRuns.$inferSelect): AgentRun {
  return toRun(r, {
    agentId: r.agentId,
    query: r.query,
    answer: r.answer,
    status: r.status,
    steps: r.steps ?? [],
    citations: r.citations ?? [],
    checks: (r.checks ?? []) as CheckResult[],
    provenance: r.provenance ?? null,
  });
}

export async function listAgentRuns(limit = 15, orgId: string = DEFAULT_ORG): Promise<AgentRun[]> {
  const rows = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.orgId, orgId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(limit);
  return rows.map(rowToRun);
}

// Runs for one agent (its detail page + history).
export async function listAgentRunsByAgent(agentId: string, limit = 50): Promise<AgentRun[]> {
  const rows = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.agentId, agentId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(limit);
  return rows.map(rowToRun);
}

// A single run by id (the trace deep-dive page).
export async function getAgentRun(id: string): Promise<AgentRun | null> {
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
  return row ? rowToRun(row) : null;
}

// Delete a run record. Returns true if a row was removed. Management action (D): purge a run
// from the durable-execution history.
export async function deleteAgentRun(id: string): Promise<boolean> {
  const removed = await db
    .delete(agentRuns)
    .where(eq(agentRuns.id, id))
    .returning({ id: agentRuns.id });
  return removed.length > 0;
}

// Cancel an in-flight run (one held at pending_review) → terminal status 'cancelled', answer
// withheld. Returns the updated run, or null if the run doesn't exist. The caller (route) enforces
// the state-machine via lib/agent-run-actions before invoking this.
export async function cancelAgentRun(id: string): Promise<AgentRun | null> {
  const [row] = await db
    .update(agentRuns)
    .set({ status: 'cancelled', answer: '' })
    .where(eq(agentRuns.id, id))
    .returning();
  return row ? rowToRun(row) : null;
}

type Mark = (kind: string, label: string, detail: string, refs: string[], start: number) => void;

// Phase 3 — sandbox as an agent tool. If the routed tool is a `sandbox`-type tool and the
// agent-code-exec flag is on, execute its script through the active sandbox (Docker by default;
// the no-exec default refuses) and record a 'sandbox' step. Tool.endpoint holds the script.
async function maybeRunSandboxTool(ref: string, mark: Mark): Promise<void> {
  const tool = (await listTools()).find((t) => `tool:${t.id}` === ref);
  if (!tool || tool.type !== 'sandbox') return;
  if (!(await getFlags().isEnabled('agent-code-exec', false))) {
    mark('sandbox', 'gated', 'agent-code-exec flag off — execution skipped', [ref], Date.now());
    return;
  }
  const t = Date.now();
  const result = await getSandbox().run('python', tool.endpoint || 'print("ok")');
  const detail = result.refused
    ? result.refused
    : `${result.engine}: exit ${result.exitCode} ${result.ok ? 'ok' : 'fail'}${result.timedOut ? ' (timeout)' : ''}`;
  mark('sandbox', result.engine, detail, [ref], t);
}

export async function runAgent(
  agentId: string,
  query: string,
  caller?: string,
  requireReview = false,
  orgId: string = DEFAULT_ORG,
  // Optional resolved caller CONTEXT (C4). The DURABLE path (Temporal worker) has no request to
  // resolve identity from, so the route resolves {runId, actor, org, project} at submit time and
  // threads it here. When provided it is authoritative — the run's runId + attribution come from
  // it, so a durable run's four-plane fan-out is keyed/attributed IDENTICALLY to an inline run.
  // Absent (the inline path) → behavior is exactly as before: mint a runId, derive the actor from
  // `caller`, org from the orgId param, no project.
  context?: RunContext,
): Promise<AgentRun | null> {
  // Resolve within the run's org (context wins, else the orgId param) so a custom agent authored
  // in another tenant can never be invoked here.
  const agent = await resolveAgent(agentId, context?.org ?? orgId);
  if (!agent) return null;
  // Honor a context-supplied runId (durable: the id the workflow/dispatch already tracks) so the
  // persisted run + all four planes share the one correlation key; else mint one (inline).
  const runId = effectiveRunId(context?.runId, () => `run_${randomUUID().slice(0, 8)}`);
  const runModel = agent.model || ANSWER_MODEL;
  // Resolve the attribution ONCE (pure) — context wins (durable), else derive from caller/orgId
  // (inline), else a system machine actor for a caller-less scheduled/system run.
  const attribution = resolveRunAttribution({
    context,
    caller,
    orgId,
    machineFallback: { type: 'machine', id: 'system', label: 'system' },
  });
  // Canonical attributed audit (Phase 4.11): who ran which agent, its outcome/model, correlated by
  // runId. Emitted on EVERY terminal path (denied / blocked / done), best-effort. Actor/org/project
  // come from the resolved attribution so inline and durable emit an identical event.
  const auditRun = (status: string, tokens = 0): void => {
    recordAudit({
      actor: attribution.actor,
      org: attribution.org,
      project: attribution.project,
      action: 'agent.run',
      resource: `agent:${agentId}`,
      model: runModel,
      tokens: tokens ? { prompt: 0, completion: 0, total: tokens } : null,
      outcome: outcomeFromStatus(status),
      runId,
    });
  };
  const steps: RunStep[] = [];
  const mark = (kind: string, label: string, detail: string, refs: string[], start: number) => {
    const step = { kind, label, detail, refs, ms: Date.now() - start };
    steps.push(step);
    emitSpan(`agent.${kind}`, { agentId, label, ms: step.ms });
  };

  // 1. Policy gate — deny-overrides ABAC (or OPA). A denial short-circuits the run.
  let t = Date.now();
  const decision = await getPolicy().evaluate({
    role: process.env.OFFGRID_AGENT_ROLE ?? 'operator',
    resource: `agent:${agentId}`,
    attributes: {},
  });
  // Block only on an EXPLICIT deny (a deny rule matched). "No rule matched" is recorded but does
  // not fail the run closed — the run is already authenticated; admins add a deny rule to block.
  const explicitDeny = !decision.allow && /deny-overrides/.test(decision.reason);
  mark('policy', decision.engine, `${explicitDeny ? 'deny' : 'allow'} — ${decision.reason}`, [], t);
  if (explicitDeny) {
    auditRun('denied');
    return persist(runId, {
      agentId, query, answer: '', status: 'denied', steps, citations: [],
      checks: [{ name: 'policy', verdict: 'blocked' as const, detail: decision.reason }], provenance: null,
    }, attribution.org);
  }

  mark('plan', agent.name, query, [], Date.now());

  // 2. Guardrails (input) — PII + injection on the query. A 'blocked' verdict refuses the run.
  t = Date.now();
  const preChecks = await runChecks('pre', { phase: 'pre', input: query, model: ANSWER_MODEL });
  mark('guard', 'pre', preChecks.map((c) => `${c.name}:${c.verdict}`).join(' '), [], t);
  if (outcomeFromChecks(preChecks) === 'blocked') {
    auditRun('blocked');
    return persist(runId, {
      agentId, query, answer: '', status: 'blocked', steps, citations: [],
      checks: preChecks, provenance: null,
    }, attribution.org);
  }

  // 2b. Budget GATE — the hard stop before this run incurs cost (retrieve → compose → gateway).
  // Price what the answer WOULD cost at the run model's finops rate; ask the pure `checkBudget` gate
  // (via projectBudget, which honors the per-org enforce flag). Local ($0) models never exceed, so
  // on-prem runs are never blocked; only real cloud egress can be denied. On DENY → persist the run
  // as 'denied' + a budget.deny audit event (outcome=blocked), so the block is attributable.
  const estRunTokens = estimateTokens(query) + 2048; // prompt estimate + reply headroom
  const runCost = costForTokens(runModel, estRunTokens);
  const budget = await projectBudget(attribution.project ?? null, runCost, attribution.org);
  if (!budget.ok) {
    mark('budget', 'deny', `over budget — spent $${budget.spent.toFixed(4)} of $${budget.limit}`, [], Date.now());
    recordAudit({
      actor: attribution.actor,
      org: attribution.org,
      project: attribution.project,
      action: 'budget.deny',
      resource: `agent:${agentId}`,
      model: runModel,
      costUsd: runCost,
      outcome: 'blocked',
      runId,
    });
    return persist(runId, {
      agentId, query, answer: '', status: 'denied', steps, citations: [],
      checks: [{ name: 'budget', verdict: 'blocked' as const, detail: `project budget exceeded ($${budget.spent.toFixed(4)}/$${budget.limit})` }],
      provenance: null,
    }, attribution.org);
  }

  // PA-16b — bound-pipeline enforcement (ADDITIVE, mirrors the app-run reference path). The
  // route/dispatch resolves the contract once (resolveAgentBinding) and threads it via the context;
  // absent/null ⇒ the noPipeline verdict allows everything (legacy behaviour, proven by test). The
  // data-class the model sees is 'general' for a GROUNDED agent (it retrieves real org data into the
  // prompt) and 'none' for an ungrounded one (a pure prompt, no data leaves).
  const contract = context?.contract ?? null;
  const enforceCtx = { orgId: attribution.org, actor: caller, runId, contract };
  const dataClass = agent.grounded === false ? 'none' : 'general';

  // 2c. Data-access gate — the HARD allowlist ceiling BEFORE retrieval touches the knowledge base.
  // A grounded run reads org knowledge (the 'retrieval' data-domain); if the bound pipeline's
  // allowlist doesn't cover it, deny + audit and short-circuit (no data is read). Ungrounded runs
  // retrieve nothing, so there is nothing to gate.
  if (agent.grounded !== false) {
    const dataVerdict = enforceDataAccess(contract, 'retrieval');
    if (!dataVerdict.allow) {
      mark('data', 'deny', dataVerdict.reason, [], Date.now());
      auditEnforcement(enforceCtx, 'pipeline.data.deny', 'data:retrieval', 'blocked', dataVerdict.reason);
      auditRun('denied');
      return persist(runId, {
        agentId, query, answer: '', status: 'denied', steps, citations: [],
        checks: [{ name: 'pipeline-data', verdict: 'blocked' as const, detail: dataVerdict.reason }],
        provenance: null,
      }, attribution.org);
    }
  }

  // 3. Retrieve — provenance refs come straight off the router's hits. Skipped for a non-grounded
  // agent (it answers from the model, so there are no sources to retrieve or cite).
  t = Date.now();
  const routed =
    agent.grounded === false
      ? { hits: [] as RetrievalHit[], decision: { intent: ['ungrounded'] as string[] } }
      : await route(query, 6);
  mark(
    'retrieve',
    'router',
    agent.grounded === false ? 'skipped (ungrounded agent)' : `intent ${routed.decision.intent.join(', ')}`,
    routed.hits.map((h) => h.ref),
    t,
  );
  const toolHit = routed.hits.find((h) => h.sourceKind === 'tool');
  if (toolHit) {
    mark('handoff', 'tool', toolHit.title, [toolHit.ref], Date.now());
    await maybeRunSandboxTool(toolHit.ref, mark);
    // Composable tools: primitives (prim:web_search/read_url/http) + apps-as-tools (app:<id>).
    // No-ops for tool:<id> (sandbox path above owns those) + unknown refs; governed + cycle-safe.
    await maybeRunComposableTool(toolHit.ref, { orgId, actor: caller, callerAppId: agent.id }, mark, query);
  }

  // 3b. Model-call gate — the egress leash BEFORE the gateway call (compose → gatewayAnswer). A
  // 'block' verdict stops the call (deny + audit, governed refusal); the pipeline can only be MORE
  // restrictive than the routing leash, never less. No pipeline ⇒ the noPipeline verdict allows it
  // (legacy routing — the gateway's own model-routing rules still decide where it actually runs).
  // (PA-16c: the overlay's requirePiiMasking is APPLIED below — after this allow check, before
  // compose, the raw query is substituted with its PII-redacted form. See the mask step.)
  const modelVerdict = enforceModelCall(contract, dataClass);
  if (!modelVerdict.allow) {
    mark('egress', 'block', modelVerdict.reason, [], Date.now());
    auditEnforcement(enforceCtx, 'pipeline.egress.block', `model:agent:${agentId}`, 'blocked', modelVerdict.reason);
    auditRun('blocked');
    return persist(runId, {
      agentId, query, answer: '', status: 'blocked', steps, citations: [],
      checks: [{ name: 'pipeline-egress', verdict: 'blocked' as const, detail: modelVerdict.reason }],
      provenance: null,
    }, attribution.org);
  }

  // PA-16c — PII MASKING BEFORE THE MODEL. When the bound pipeline's guardrail overlay requires
  // masking (modelVerdict.requirePiiMasking), the raw query MUST be replaced with its PII-redacted
  // form BEFORE it leaves for the model. Previously requirePiiMasking was only surfaced by the
  // verdict and never applied — the raw PAN/email still reached the gateway. Here we actually
  // substitute: run the guardrails PII port (org-scoped), and if it found PII, compose from the
  // REDACTED query instead of the raw one. Best-effort — a detector outage leaves the query as-is
  // rather than failing the run (the egress leash/local-only guarantees still hold). Additive: with
  // no pipeline / masking not required, the query is untouched (legacy behaviour).
  let modelQuery = query;
  if (modelVerdict.requirePiiMasking) {
    t = Date.now();
    try {
      const scan = await getPii().scan(query, attribution.org);
      const { maskTextForModel } = await import('@/lib/guardrail-rules-runtime');
      const masked = maskTextForModel(query, scan);
      if (masked !== query) {
        modelQuery = masked;
        mark('mask', scan.engine, `masked ${scan.entities.join(', ')} before model`, [], t);
        auditEnforcement(
          enforceCtx,
          'pipeline.pii.mask',
          `model:agent:${agentId}`,
          'redacted',
          `masked ${scan.entities.join(', ')} (${scan.engine}) before model call`,
        );
      } else {
        mark('mask', scan.engine, 'no PII to mask', [], t);
      }
    } catch {
      mark('mask', 'skip', 'PII scan unavailable — query unmasked', [], t);
    }
  }

  // 4. Answer — either the AUTONOMOUS ReAct loop (agent has callable tools) or the LINEAR compose.
  //
  // Framework-grade agency: when the agent declares tools that resolve to a genuinely callable,
  // air-gap-permitted set (buildAgentToolCatalog applies the same gate the executor re-checks), run
  // the pure plan→act→observe→iterate loop with a hard step budget instead of a single compose pass.
  // The loop's model call is the governed planner (gateway + guardrails + FinOps) and its tool call
  // is the governed, audited tool seam — so autonomy stays inside the pipeline contract by
  // construction. Absent callable tools, the existing linear path (unchanged) composes the answer.
  t = Date.now();
  const toolCatalog = await resolveAgentToolCatalog(agent, orgId);
  let answer: string;
  if (isAutonomousAgent(toolCatalog)) {
    const loopModel = agent.model || ANSWER_MODEL;
    const loopSystem = systemFor(agent);
    const budget = clampAgentIterations(process.env.OFFGRID_AGENT_MAX_ITERATIONS);
    const context = routed.hits.length
      ? `\n\nKNOWN SOURCES:\n${routed.hits.map((h, i) => `[${i + 1}] ${h.title}: ${h.snippet}`).join('\n')}`
      : '';
    const loop = await runAgentLoop({
      goal: `${modelQuery}${context}`,
      tools: toolCatalog,
      planNext: makeGovernedPlanner(loopModel, loopSystem, caller),
      callTool: makeGovernedToolExecutor(orgId, agent.id, caller, mark),
      maxIterations: budget,
    });
    recordTrajectory(loop.trajectory, mark);
    answer = loop.answer;
    mark(
      'answer',
      loop.finished ? 'agent-loop' : `agent-loop:${loop.haltReason}`,
      `${loop.iterations} iter, ${loop.toolCalls} tool call(s): ${answer.slice(0, 100)}`,
      [],
      t,
    );
  } else {
    answer = await compose(modelQuery, routed.hits, agent, caller);
    mark('answer', 'compose', answer.slice(0, 120), [], t);
  }

  // 5. Ground — verify the answer against the sources → citations.
  t = Date.now();
  const grounded = await getGrounding().verify(
    answer,
    routed.hits.map((h) => ({ id: h.ref, text: h.snippet })),
  );
  const citations: Citation[] = routed.hits.map((h) => ({
    ref: h.ref, title: h.title, snippet: h.snippet, score: h.score, supported: grounded.score >= 50,
  }));
  mark('ground', 'grounding', `${grounded.verdicts.filter((v) => v.supported).length}/${grounded.verdicts.length} claims grounded (${grounded.score}%)`, citations.map((c) => c.ref), t);

  // 6. Guardrails (output) — scan the answer before it leaves (recorded, non-blocking).
  t = Date.now();
  const postChecks = await runChecks('post', { phase: 'post', output: answer, model: ANSWER_MODEL });
  mark('guard', 'post', postChecks.map((c) => `${c.name}:${c.verdict}`).join(' '), [], t);

  // 7. Provenance — sign the answer (ed25519 by default): tamper-evident, offline-verifiable.
  t = Date.now();
  const signing = getSigning();
  // The runId (as provenanceRef) is part of the signed payload, so the provenance record is bound to
  // — and correlated by — the same run id as the other three planes (C2).
  const provenance: Provenance = {
    signature: signing.sign({
      runId: correlationIds(runId).provenanceRef,
      agentId,
      query,
      answer,
      refs: citations.map((c) => c.ref),
    }),
    algorithm: signing.algorithm,
    publicKey: signing.publicKey(),
    signedAt: new Date().toISOString(),
  };
  mark('sign', signing.algorithm, 'answer signed', [], t);

  // Human-in-the-loop (S4): when the workflow has a Human block, the answer is HELD server-side
  // as pending_review (persisted, not delivered) until an approver releases it via the approve
  // endpoint. This is a real governance checkpoint, not a client toggle.
  const run = await persist(runId, {
    agentId, query, answer, status: requireReview ? 'pending_review' : 'done', steps, citations,
    checks: [...preChecks, ...postChecks], provenance,
  }, attribution.org);

  // 8. Observability fan-out — the SAME runId lands in all four planes, correlated by one key (C2).
  //    Every emission is best-effort / fire-and-forget: a plane being down never fails the run.
  const ids = correlationIds(runId);

  // 8a. Lineage — record source→answer under run.runId == runId, namespace offgrid-console.
  void getLineage()
    .emit({
      job: `agent:${agentId}`,
      run: ids.lineageRunId,
      status: 'COMPLETE',
      inputs: citations.map((c) => c.ref),
      outputs: [runId],
    })
    .catch(() => {});

  // 8b. Audit — TWO complementary docs to offgrid-audit, both keyed/correlated by runId:
  //   (i) the C2 governed-run doc (unchanged) so `_search?q=<runId>` and the four-plane harness hit;
  //  (ii) the Phase-4.11 canonical ATTRIBUTED event (actor + org + action) via recordAudit, which
  //       also lands in Postgres audit_events_v2. Both best-effort.
  shipRunAudit({
    runId,
    agentId,
    outcome: run.status,
    model: runModel,
    tokens: 0,
    caller,
  });
  auditRun(run.status);

  // 8c. Langfuse trace — emit a run trace whose id == normalize(runId) for every run (not just the
  //     sampled QA score), so the trace plane is reliably correlated. PA-12: stamp the bound pipeline
  //     (resolved once by the route → threaded on the context) at the SOURCE so per-pipeline + global
  //     Observability filter exactly; null when no pipeline governs this run (unchanged behaviour).
  emitRunTrace({
    runId,
    agentId,
    model: agent.model || ANSWER_MODEL,
    input: query,
    output: answer,
    caller,
    pipelineId: context?.pipelineId ?? null,
  });

  return run;
}

// Online QA score for a completed run — LLM-as-judge → Langfuse. Called OUT OF BAND (e.g. via
// next/server `after()`), gated by the `online-evals` flag and OFFGRID_QA_SAMPLE_RATE, so it never
// adds latency to the response. Best-effort: all failures are swallowed.
export async function scoreRun(run: AgentRun): Promise<void> {
  try {
    if (run.status !== 'done') return;
    if (!(await getFlags().isEnabled('online-evals', true))) return;
    const rate = Number(process.env.OFFGRID_QA_SAMPLE_RATE ?? '1');
    if (Number.isFinite(rate) && Math.random() > rate) return;
    await scoreInteraction({
      input: run.query,
      output: run.answer,
      sources: run.citations.map((c) => c.snippet),
      name: `agent:${run.agentId}`,
      traceId: correlationIds(run.id).traceId,
    });
  } catch {
    /* best-effort online scoring */
  }
}
