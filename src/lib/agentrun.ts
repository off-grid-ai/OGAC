import { randomUUID } from 'crypto';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuns } from '@/db/schema';
import { getFlags, getGrounding, getLineage, getPolicy, getSigning } from '@/lib/adapters/registry';
import { AGENTS } from '@/lib/agents';
import { cacheLookup, cacheStore } from '@/lib/cache';
import { type CheckResult, outcomeFromChecks, runChecks } from '@/lib/checks';
import { emitSpan } from '@/lib/otel';
import { scoreInteraction } from '@/lib/qa/scoring';
import { route } from '@/lib/retrieval/router';
import type { RetrievalHit } from '@/lib/retrieval/types';

// The canonical interaction pipeline. Every agent run flows through one ordered chain so that the
// platform's capabilities actually fire in-path, not just from admin endpoints:
//   policy gate → guardrails(in) → retrieve → answer (cache) → ground → guardrails(out)
//   → provenance-sign → persist → lineage (best-effort) → [async, sampled] online QA score.
// Safety checks run on every request; the LLM-as-judge score runs out-of-band (see scoreRun) so it
// never adds latency to the response.
const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';
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

async function gatewayAnswer(query: string, context: string): Promise<string | null> {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ANSWER_MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: 'Answer only from the provided sources, concisely.' },
          { role: 'user', content: `SOURCES:\n${context}\n\nQUESTION: ${query}` },
        ],
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(20000),
    });
    return res.ok ? extractText(await res.json()) : null;
  } catch {
    return null;
  }
}

async function compose(query: string, hits: RetrievalHit[]): Promise<string> {
  const context = hits.map((h, i) => `[${i + 1}] ${h.title}: ${h.snippet}`).join('\n');
  const cacheKey = `${query}\n${context}`;
  const cached = await cacheLookup(cacheKey);
  if (cached.hit && cached.answer) return cached.answer;
  const answer = await gatewayAnswer(query, context);
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
): Promise<AgentRun> {
  const [row] = await db
    .insert(agentRuns)
    .values({
      id,
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

export async function listAgentRuns(limit = 15): Promise<AgentRun[]> {
  const rows = await db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(limit);
  return rows.map((r) =>
    toRun(r, {
      agentId: r.agentId,
      query: r.query,
      answer: r.answer,
      status: r.status,
      steps: r.steps ?? [],
      citations: r.citations ?? [],
      checks: (r.checks ?? []) as CheckResult[],
      provenance: r.provenance ?? null,
    }),
  );
}

export async function runAgent(agentId: string, query: string): Promise<AgentRun | null> {
  const agent = AGENTS.find((a) => a.id === agentId);
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
    });
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
    });
  }

  // 3. Retrieve — provenance refs come straight off the router's hits.
  t = Date.now();
  const routed = await route(query, 6);
  mark('retrieve', 'router', `intent ${routed.decision.intent.join(', ')}`, routed.hits.map((h) => h.ref), t);
  const toolHit = routed.hits.find((h) => h.sourceKind === 'tool');
  if (toolHit) mark('handoff', 'tool', toolHit.title, [toolHit.ref], Date.now());

  // 4. Answer — composed from the retrieved sources (cached).
  t = Date.now();
  const answer = await compose(query, routed.hits);
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

  const run = await persist(runId, {
    agentId, query, answer, status: 'done', steps, citations,
    checks: [...preChecks, ...postChecks], provenance,
  });

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
