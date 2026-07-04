import { randomUUID } from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuns } from '@/db/schema';
import {
  getFlags,
  getGrounding,
  getLineage,
  getPolicy,
  getSandbox,
  getSigning,
} from '@/lib/adapters/registry';
import { type AgentDef, resolveAgent } from '@/lib/agents';
import { cacheLookup, cacheStore } from '@/lib/cache';
import { type CheckResult, outcomeFromChecks, runChecks } from '@/lib/checks';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { emitSpan } from '@/lib/otel';
import { scoreInteraction } from '@/lib/qa/scoring';
import { route } from '@/lib/retrieval/router';
import type { RetrievalHit } from '@/lib/retrieval/types';
import { listTools } from '@/lib/store';

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
): Promise<AgentRun | null> {
  const agent = await resolveAgent(agentId);
  if (!agent) return null;
  const runId = `run_${randomUUID().slice(0, 8)}`;
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
    return persist(runId, {
      agentId, query, answer: '', status: 'denied', steps, citations: [],
      checks: [{ name: 'policy', verdict: 'blocked' as const, detail: decision.reason }], provenance: null,
    }, orgId);
  }

  mark('plan', agent.name, query, [], Date.now());

  // 2. Guardrails (input) — PII + injection on the query. A 'blocked' verdict refuses the run.
  t = Date.now();
  const preChecks = await runChecks('pre', { phase: 'pre', input: query, model: ANSWER_MODEL });
  mark('guard', 'pre', preChecks.map((c) => `${c.name}:${c.verdict}`).join(' '), [], t);
  if (outcomeFromChecks(preChecks) === 'blocked') {
    return persist(runId, {
      agentId, query, answer: '', status: 'blocked', steps, citations: [],
      checks: preChecks, provenance: null,
    }, orgId);
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
  }

  // 4. Answer — composed from the retrieved sources (cached).
  t = Date.now();
  const answer = await compose(query, routed.hits, agent, caller);
  mark('answer', 'compose', answer.slice(0, 120), [], t);

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
  const provenance: Provenance = {
    signature: signing.sign({ agentId, query, answer, refs: citations.map((c) => c.ref) }),
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
  }, orgId);

  // 8. Lineage — record source→answer (best-effort, never blocks the response).
  void getLineage()
    .emit({ job: `agent:${agentId}`, run: runId, status: 'COMPLETE', inputs: citations.map((c) => c.ref), outputs: [runId] })
    .catch(() => {});

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
      traceId: run.id.replace(/[^a-z0-9]/gi, ''),
    });
  } catch {
    /* best-effort online scoring */
  }
}
