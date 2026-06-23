import { randomUUID } from 'crypto';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuns } from '@/db/schema';
import { getGrounding } from '@/lib/adapters/registry';
import { AGENTS } from '@/lib/agents';
import { emitSpan } from '@/lib/otel';
import { route } from '@/lib/retrieval/router';
import type { RetrievalHit } from '@/lib/retrieval/types';

// Execute an agent over a query and record a full trace: plan → retrieve (provenance) → handoff →
// ground (citations) → answer. Reuses the router (provenance refs) and grounding (verified
// citations) so every run is traceable to its sources. Emits a span per step.
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

export interface AgentRun {
  id: string;
  agentId: string;
  query: string;
  answer: string;
  status: string;
  steps: RunStep[];
  citations: Citation[];
  startedAt: string;
}

// Compose an answer from retrieved context via the gateway; fall back to the top snippet so a
// run always completes even if the gateway is down.
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
  const answer = await gatewayAnswer(query, context);
  if (answer) return answer;
  return hits[0] ? `Based on ${hits.length} source(s): ${hits[0].snippet}` : 'No sources found.';
}

export async function listAgentRuns(limit = 15): Promise<AgentRun[]> {
  const rows = await db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    query: r.query,
    answer: r.answer,
    status: r.status,
    steps: r.steps ?? [],
    citations: r.citations ?? [],
    startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt),
  }));
}

export async function runAgent(agentId: string, query: string): Promise<AgentRun | null> {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) return null;
  const steps: RunStep[] = [];
  const mark = (kind: string, label: string, detail: string, refs: string[], start: number) => {
    const step = { kind, label, detail, refs, ms: Date.now() - start };
    steps.push(step);
    emitSpan(`agent.${kind}`, { agentId, label, ms: step.ms });
  };

  let t = Date.now();
  mark('plan', agent.name, query, [], t);

  // Retrieve — provenance refs come straight off the router's hits.
  t = Date.now();
  const routed = await route(query, 6);
  mark(
    'retrieve',
    'router',
    `intent ${routed.decision.intent.join(', ')}`,
    routed.hits.map((h) => h.ref),
    t,
  );

  // Handoff — if the router picked a tool, record the agent→tool handoff.
  const toolHit = routed.hits.find((h) => h.sourceKind === 'tool');
  if (toolHit) mark('handoff', 'tool', toolHit.title, [toolHit.ref], Date.now());

  // Answer — composed from the retrieved sources.
  t = Date.now();
  const answer = await compose(query, routed.hits);
  mark('answer', 'compose', answer.slice(0, 120), [], t);

  // Ground — verify the answer against the retrieved sources → citations.
  t = Date.now();
  const grounded = await getGrounding().verify(
    answer,
    routed.hits.map((h) => ({ id: h.ref, text: h.snippet })),
  );
  const citations: Citation[] = routed.hits.map((h) => ({
    ref: h.ref,
    title: h.title,
    snippet: h.snippet,
    score: h.score,
    supported: grounded.score >= 50,
  }));
  mark(
    'ground',
    'grounding',
    `${grounded.verdicts.filter((v) => v.supported).length}/${grounded.verdicts.length} claims grounded (${grounded.score}%)`,
    citations.map((c) => c.ref),
    t,
  );

  const [row] = await db
    .insert(agentRuns)
    .values({
      id: `run_${randomUUID().slice(0, 8)}`,
      agentId,
      query,
      answer,
      status: 'done',
      steps,
      citations,
    })
    .returning();
  return {
    id: row.id,
    agentId,
    query,
    answer,
    status: 'done',
    steps,
    citations,
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt),
  };
}
